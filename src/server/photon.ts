import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR, now, q, q1, run, type Row } from "./db.ts";
import { createMessage, serializeMessage } from "./store.ts";
import { broadcastToChannel } from "./events.ts";
import { agentForChannel, ensureThread, refreshThreadSummary } from "./agents.ts";

const CREDENTIAL_FILE = join(DATA_DIR, "photon-credentials.json");
const SIDECAR = new URL("./photon-sidecar.mjs", import.meta.url);
const E164 = /^\+\d{6,15}$/;
type PhotonCredential = { project_id: string; project_secret: string; operator_phone: string; assigned_phone: string; dashboard_token?: string; configured_at: number };
type PhotonEvent = { id: string; space_id: string; space_type: string; sender: string; text: string; timestamp: string };
type PhotonDispatch = (bot: Row, channelId: number, triggerId: number, threadRootId: number) => Promise<void>;

let child: ChildProcess | null = null;
let base = "";
let token = "";
let desired = false;
let consuming = false;
let restartTimer: NodeJS.Timeout | null = null;
let dispatchInbound: PhotonDispatch | null = null;

/** Registered by the control plane to keep the connector independent of the bot runtime. */
export function registerPhotonDispatcher(dispatcher: PhotonDispatch): void { dispatchInbound = dispatcher; }

const credentials = (): PhotonCredential | null => {
  try { return JSON.parse(readFileSync(CREDENTIAL_FILE, "utf8")) as PhotonCredential; } catch { return null; }
};
const hidden = (value: string): string => value ? `${value.slice(0, 4)}…${value.slice(-2)}` : "";
export function photonStatus(): Record<string, unknown> {
  const value = credentials();
  return {
    configured: Boolean(value?.project_id && value?.project_secret),
    connected: Boolean(child && child.exitCode == null && base),
    project_id: value?.project_id || "",
    operator_phone: value?.operator_phone || "",
    assigned_phone: value?.assigned_phone || "",
    secret: value?.project_secret ? "stored" : "missing",
    mappings: q("SELECT pcm.*,c.name channel_name,a.name agent_name FROM photon_channel_mappings pcm JOIN channels c ON c.id=pcm.channel_id LEFT JOIN agent_channels ac ON ac.channel_id=c.id LEFT JOIN agents a ON a.id=ac.agent_id ORDER BY pcm.created"),
  };
}

export async function configurePhoton(input: { project_id: string; project_secret: string; operator_phone: string; assigned_phone?: string; dashboard_token?: string }): Promise<Record<string, unknown>> {
  const projectId = String(input.project_id || "").trim();
  const projectSecret = String(input.project_secret || "").trim();
  const operatorPhone = String(input.operator_phone || "").trim();
  const assignedPhone = String(input.assigned_phone || "").trim();
  if (!projectId || projectSecret.length < 12) throw new Error("Photon project id and project secret are required.");
  if (!E164.test(operatorPhone)) throw new Error("Use the operator phone in E.164 format, for example +15551234567.");
  if (assignedPhone && !E164.test(assignedPhone)) throw new Error("Use the assigned Photon line in E.164 format.");
  await validateSpectrumCredentials(projectId, projectSecret);
  const previous = existsSync(CREDENTIAL_FILE) ? readFileSync(CREDENTIAL_FILE) : null;
  const temporary = `${CREDENTIAL_FILE}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify({ project_id: projectId, project_secret: projectSecret, operator_phone: operatorPhone, assigned_phone: assignedPhone, dashboard_token: String(input.dashboard_token || ""), configured_at: now() }), { mode: 0o600 });
  renameSync(temporary, CREDENTIAL_FILE);
  try {
    await restartPhotonConnector();
  } catch (error) {
    if (previous) writeFileSync(CREDENTIAL_FILE, previous, { mode: 0o600 });
    else if (existsSync(CREDENTIAL_FILE)) unlinkSync(CREDENTIAL_FILE);
    await restartPhotonConnector().catch(() => undefined);
    throw error;
  }
  if (!q1("SELECT 1 FROM photon_channel_mappings LIMIT 1")) {
    const main = q1(`SELECT c.id FROM channels c JOIN users u ON u.id=c.personal_main_owner_id
      WHERE c.kind='channel' AND c.name='main' AND c.status='active' AND u.is_admin=1 ORDER BY c.id LIMIT 1`);
    if (main?.id) mapPhotonChannel(Number(main.id), [operatorPhone]);
  }
  return photonStatus();
}

export function mapPhotonChannel(channelId: number, allowedUsers?: string[]): Record<string, unknown> {
  const channel = q1("SELECT id,name,status FROM channels WHERE id=? AND kind='channel' AND status='active'", channelId);
  const resident = agentForChannel(channelId);
  if (!channel || !resident?.id || !["channel", "skipper"].includes(String(resident.kind))) throw new Error("Choose an active agent channel, including your #main Skipper channel.");
  const configured = credentials();
  const users = (allowedUsers?.length ? allowedUsers : configured?.operator_phone ? [configured.operator_phone] : [])
    .map((value) => String(value).trim()).filter((value) => E164.test(value));
  if (!users.length) throw new Error("At least one allowed E.164 sender is required.");
  run(`INSERT INTO photon_channel_mappings (channel_id,allowed_users,created,updated) VALUES (?,?,?,?)
    ON CONFLICT(channel_id) DO UPDATE SET allowed_users=excluded.allowed_users,updated=excluded.updated`, channelId, JSON.stringify([...new Set(users)]), now(), now());
  run(`INSERT INTO agent_capabilities (agent_id,capability,config,created) VALUES (?,'photon',?,?)
    ON CONFLICT(agent_id,capability) DO UPDATE SET config=excluded.config`, resident.id, JSON.stringify({ can_read: true, can_draft: true, can_reply: true, can_send: false, allowed_users: users }), now());
  return photonStatus();
}

export function grantPhotonToResident(channelId: number, canSend = false): string {
  const resident = agentForChannel(channelId);
  const mapping = q1("SELECT allowed_users FROM photon_channel_mappings WHERE channel_id=?", channelId);
  if (!resident?.id || !mapping) return "Error: configure and map Photon to this channel in Settings first.";
  run(`INSERT INTO agent_capabilities (agent_id,capability,config,created) VALUES (?,'photon',?,?)
    ON CONFLICT(agent_id,capability) DO UPDATE SET config=excluded.config`, resident.id, JSON.stringify({ can_read: true, can_draft: true, can_reply: true, can_send: Boolean(canSend), allowed_users: JSON.parse(String(mapping.allowed_users || "[]")) }), now());
  return `Granted @${resident.name} Photon iMessage read, draft, and authorized-conversation reply access${canSend ? " plus new outbound sending" : " (new outbound conversations remain disabled)"}. Credentials remain host-scoped.`;
}

const spectrumHost = (): string => String(process.env.PHOTON_SPECTRUM_HOST || "https://spectrum.photon.codes").replace(/\/+$/, "");
async function validateSpectrumCredentials(projectId: string, projectSecret: string): Promise<void> {
  const authorization = Buffer.from(`${projectId}:${projectSecret}`).toString("base64");
  const response = await fetch(`${spectrumHost()}/projects/${encodeURIComponent(projectId)}/users/`, {
    headers: { authorization: `Basic ${authorization}`, accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Photon rejected the project credentials (HTTP ${response.status}). Nothing was saved.`);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; server.close(() => resolve(port)); });
  });
}
const headers = (): Record<string, string> => ({ "x-1helm-photon-token": token, "content-type": "application/json" });
async function sidecar(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  if (!base) throw new Error("Photon is not connected.");
  const response = await fetch(`${base}${path}`, { ...init, headers: { ...headers(), ...(init.headers || {}) }, signal: AbortSignal.timeout(30_000) });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || result.ok === false) throw new Error(String(result.error || `Photon HTTP ${response.status}`));
  return result;
}

export async function photonMessages(channelId: number, query = "", limit = 20): Promise<unknown> {
  const text = String(query || "").toLowerCase();
  const rows = q(`SELECT id,external_id,space_id,sender,body,received_at FROM photon_messages WHERE channel_id=?
    AND (?='' OR lower(body) LIKE '%'||?||'%' OR lower(sender) LIKE '%'||?||'%') ORDER BY received_at DESC LIMIT ?`, channelId, text, text, text, Math.max(1, Math.min(50, limit)));
  return { query, messages: rows };
}

export async function sendPhoton(channelId: number, spaceId: string, text: string): Promise<unknown> {
  const mapping = q1("SELECT 1 FROM photon_channel_mappings WHERE channel_id=?", channelId);
  if (!mapping) throw new Error("Photon is not mapped to this channel.");
  const destination = String(spaceId || "").trim();
  if (!destination || !String(text || "").trim()) throw new Error("Photon destination and message text are required.");
  const resident = agentForChannel(channelId);
  const capability = resident?.id ? q1("SELECT config FROM agent_capabilities WHERE agent_id=? AND capability='photon'", resident.id) : undefined;
  let permissions: Record<string, unknown> = {};
  try { permissions = JSON.parse(String(capability?.config || "{}")); } catch { /* fail closed below */ }
  const replying = Boolean(q1("SELECT 1 FROM photon_messages WHERE channel_id=? AND direction='inbound' AND space_id=?", channelId, destination));
  if (!permissions.can_send && !(permissions.can_reply && replying)) {
    throw new Error("Photon can reply only to an authorized conversation already delivered to this channel. Skipper must grant new outbound sending for any other destination.");
  }
  const result = await sidecar("/send", { method: "POST", body: JSON.stringify({ space_id: destination, text: String(text).slice(0, 50_000) }) });
  run("INSERT INTO photon_messages (channel_id,external_id,space_id,sender,direction,body,received_at) VALUES (?,?,?,?, 'outbound',?,?)", channelId, String(result.message_id || ""), destination, "1Helm", String(text).slice(0, 50_000), now());
  return { status: "sent", destination, message_id: result.message_id || "" };
}

function recoverInterruptedPhotonDeliveries(): void {
  for (const delivery of q("SELECT * FROM connector_deliveries WHERE connector='photon' AND state='attempting' ORDER BY id")) {
    run("UPDATE connector_deliveries SET state='uncertain',error='1Helm restarted after handing this reply to Photon; delivery cannot be replayed safely',updated=? WHERE id=? AND state='attempting'", now(), delivery.id);
    run(`INSERT INTO channel_activity (channel_id,kind,summary,status,actor_type,created)
      VALUES (?,'connector',?,'failed','system',?)`, delivery.channel_id,
    `Photon reply delivery is uncertain after a restart. 1Helm did not resend it because that could duplicate the message.`, now());
  }
}

function queuePhotonDelivery(channelId: number, destination: string, body: string, sourceMessageId: number, key: string): void {
  run(`INSERT OR IGNORE INTO connector_deliveries
    (connector,idempotency_key,channel_id,destination,body,source_message_id,state,created,updated)
    VALUES ('photon',?,?,?,?,?,'pending',?,?)`, key, channelId, destination, body.slice(0, 50_000), sourceMessageId, now(), now());
}

/** Drain durable reply obligations. The attempt is persisted before crossing
 * the external boundary. A crash after that point is reported as uncertain on
 * restart and is never silently replayed into a duplicate iMessage. */
export async function drainPhotonDeliveries(): Promise<void> {
  if (!base) return;
  for (const delivery of q("SELECT * FROM connector_deliveries WHERE connector='photon' AND state='pending' ORDER BY created,id")) {
    const claimed = run(`UPDATE connector_deliveries SET state='attempting',attempt_count=attempt_count+1,error='',updated=?
      WHERE id=? AND state='pending'`, now(), delivery.id);
    if (!claimed.changes) continue;
    try {
      const result = await sidecar("/send", { method: "POST", body: JSON.stringify({ space_id: String(delivery.destination), text: String(delivery.body).slice(0, 50_000) }) });
      const externalId = String(result.message_id || "");
      run("INSERT INTO photon_messages (channel_id,external_id,space_id,sender,direction,body,received_at,message_id) VALUES (?,?,?,?, 'outbound',?,?,?)",
        delivery.channel_id, externalId, delivery.destination, "1Helm", String(delivery.body), now(), delivery.source_message_id);
      run("UPDATE connector_deliveries SET state='delivered',external_id=?,error='',updated=? WHERE id=? AND state='attempting'", externalId, now(), delivery.id);
    } catch (error) {
      const detail = String((error as Error).message || error).slice(0, 500);
      run("UPDATE connector_deliveries SET state='failed',error=?,updated=? WHERE id=? AND state='attempting'", detail, now(), delivery.id);
      run(`INSERT INTO channel_activity (channel_id,kind,summary,status,actor_type,created)
        VALUES (?,'connector',?,'failed','system',?)`, delivery.channel_id, `Photon could not return the 1Helm reply: ${detail}`.slice(0, 500), now());
    }
  }
}

export async function deliverPhotonEvent(event: PhotonEvent): Promise<boolean> {
  if (!event.id || !event.space_id || !event.text) return false;
  if (q1("SELECT 1 FROM photon_messages WHERE external_id=?", event.id)) return false;
  const mappings = q("SELECT * FROM photon_channel_mappings ORDER BY created");
  const mapping = mappings.find((row) => {
    try { return (JSON.parse(String(row.allowed_users || "[]")) as string[]).includes(event.sender); } catch { return false; }
  });
  if (!mapping) return false;
  const channelId = Number(mapping.channel_id);
  const resident = agentForChannel(channelId);
  if (!resident?.bot_id) return false;
  const body = `[Photon iMessage from ${event.sender}; conversation ${event.space_id}]\n${event.text}`;
  const messageId = createMessage({ channelId, parentId: null, botId: null, body });
  run("UPDATE messages SET system_message=1 WHERE id=?", messageId);
  const threadId = ensureThread(messageId, channelId);
  run("INSERT INTO photon_messages (channel_id,external_id,space_id,sender,direction,body,received_at,message_id) VALUES (?,?,?,?, 'inbound',?,?,?)", channelId, event.id, event.space_id, event.sender, event.text.slice(0, 50_000), Date.parse(event.timestamp) || now(), messageId);
  run("INSERT INTO channel_activity (channel_id,thread_id,kind,summary,actor_type,created) VALUES (?,?,'connector',?,'system',?)", channelId, threadId, `Photon delivered an iMessage from ${event.sender}.`, now());
  broadcastToChannel(channelId, { type: "message", message: serializeMessage(messageId) });
  refreshThreadSummary(messageId);
  const bot = q1("SELECT * FROM bots WHERE id=?", resident.bot_id);
  if (bot && dispatchInbound) {
    try {
      const outboundBefore = Number(q1("SELECT COALESCE(MAX(id),0) id FROM photon_messages WHERE channel_id=? AND space_id=? AND direction='outbound'", channelId, event.space_id)?.id || 0);
      await dispatchInbound(bot, channelId, messageId, messageId);
      const reply = q1(`SELECT id,body FROM messages WHERE channel_id=? AND parent_id=? AND bot_id=?
        AND trim(body)<>'' AND body<>'_Working…_' ORDER BY id DESC LIMIT 1`, channelId, messageId, bot.id);
      const alreadyReturned = q1("SELECT 1 FROM photon_messages WHERE channel_id=? AND space_id=? AND direction='outbound' AND id>? LIMIT 1", channelId, event.space_id, outboundBefore);
      const alreadyQueued = reply?.id ? q1("SELECT 1 FROM connector_deliveries WHERE connector='photon' AND source_message_id=? LIMIT 1", reply.id) : undefined;
      if (reply?.body && !alreadyReturned && !alreadyQueued) queuePhotonDelivery(channelId, event.space_id, String(reply.body), Number(reply.id), `photon:event:${event.id}:final`);
      await drainPhotonDeliveries();
    } catch (error) {
      run("INSERT INTO channel_activity (channel_id,thread_id,kind,summary,status,actor_type,created) VALUES (?,?,'connector',?,'failed','system',?)",
        channelId, threadId, `Photon could not return the 1Helm reply to iMessage: ${(error as Error).message}`.slice(0, 500), now());
    }
  }
  return true;
}

async function consume(): Promise<void> {
  if (consuming) return; consuming = true;
  let retryDelay = 250;
  try {
    while (desired && child?.exitCode == null && base) {
      try {
        await drainPhotonDeliveries();
        const result = await sidecar("/next", { method: "GET" });
        retryDelay = 250;
        if (result.event) await deliverPhotonEvent(result.event as PhotonEvent);
      } catch {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        retryDelay = Math.min(5000, retryDelay * 2);
      }
    }
  } finally { consuming = false; }
}

export async function startPhotonConnector(): Promise<void> {
  desired = true;
  recoverInterruptedPhotonDeliveries();
  const value = credentials();
  if (!value?.project_id || !value.project_secret || child?.exitCode == null && child) return;
  const port = await freePort(); token = randomBytes(32).toString("hex"); base = `http://127.0.0.1:${port}`;
  const sidecarPath = String(process.env.PHOTON_SIDECAR_PATH || fileURLToPath(SIDECAR));
  const sidecarProcess: ChildProcess = spawn(process.execPath, [sidecarPath], {
    stdio: ["pipe", "ignore", "pipe"],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PHOTON_PROJECT_ID: value.project_id, PHOTON_PROJECT_SECRET: value.project_secret, PHOTON_SIDECAR_TOKEN: token, PHOTON_SIDECAR_PORT: String(port) },
  });
  child = sidecarProcess;
  sidecarProcess.stderr?.on("data", (chunk: Buffer) => { const line = String(chunk).trim(); if (line) console.warn(line.slice(-1000)); });
  sidecarProcess.once("exit", () => {
    if (child === sidecarProcess) { child = null; base = ""; token = ""; }
    if (desired && !restartTimer) { restartTimer = setTimeout(() => { restartTimer = null; void startPhotonConnector(); }, 5000); restartTimer.unref(); }
  });
  const deadline = now() + 20_000;
  while (now() < deadline) {
    try {
      await sidecar("/health", { method: "POST", body: "{}" });
      await drainPhotonDeliveries();
      void consume(); return;
    } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  sidecarProcess.kill("SIGTERM"); throw new Error(`Photon sidecar did not become ready for project ${hidden(value.project_id)}.`);
}

export async function stopPhotonConnector(): Promise<void> {
  desired = false;
  if (restartTimer) clearTimeout(restartTimer); restartTimer = null;
  const sidecarProcess = child;
  if (!sidecarProcess) return;
  await sidecar("/shutdown", { method: "POST", body: "{}" }).catch(() => undefined);
  sidecarProcess.stdin?.end();
  setTimeout(() => { if (sidecarProcess.exitCode == null) sidecarProcess.kill("SIGTERM"); }, 2000).unref();
  child = null; base = ""; token = "";
}

export async function restartPhotonConnector(): Promise<void> { await stopPhotonConnector(); await startPhotonConnector(); }
