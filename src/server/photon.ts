import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR, now, q, q1, run, type Row } from "./db.ts";
import { createMessage, serializeMessage } from "./store.ts";
import { broadcastToChannel, sendToUsers } from "./events.ts";
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
  const main = photonMainChannel();
  return {
    configured: Boolean(value?.project_id && value?.project_secret),
    connected: Boolean(child && child.exitCode == null && base),
    project_id: value?.project_id || "",
    operator_phone: value?.operator_phone || "",
    assigned_phone: value?.assigned_phone || "",
    secret: value?.project_secret ? "stored" : "missing",
    thread_count: main ? Number(q1("SELECT COUNT(*) n FROM photon_conversations WHERE channel_id=?", main.id)?.n || 0) : 0,
  };
}

function photonMainChannel(): Row | undefined {
  return q1(`SELECT c.*,u.id owner_user_id FROM channels c JOIN users u ON u.id=c.personal_main_owner_id
    WHERE c.kind='channel' AND c.name='main' AND c.status='active' AND u.is_admin=1
    ORDER BY c.id LIMIT 1`);
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
  return photonStatus();
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

export function photonConversations(ownerUserId: number): Record<string, unknown>[] {
  const main = photonMainChannel();
  if (!main || Number(main.personal_main_owner_id) !== ownerUserId) return [];
  return q(`SELECT pc.id,pc.sender,pc.space_id,pc.root_message_id,pc.thread_id,pc.active,pc.started,pc.updated,pc.closed,
      t.title,t.summary,t.status,
      (SELECT COALESCE((SELECT pm.body FROM photon_messages pm WHERE pm.message_id=m.id ORDER BY pm.id DESC LIMIT 1),m.body)
        FROM messages m WHERE m.photon_conversation_id=pc.id AND trim(m.body)<>'' AND m.body<>'_Working…_' ORDER BY m.id DESC LIMIT 1) last_body,
      (SELECT COUNT(*) FROM messages WHERE photon_conversation_id=pc.id AND trim(body)<>'' AND body<>'_Working…_') message_count
    FROM photon_conversations pc JOIN threads t ON t.id=pc.thread_id
    WHERE pc.channel_id=? ORDER BY pc.updated DESC,pc.id DESC`, main.id).map((conversation) => ({
      ...conversation,
      title: /^\[?Photon\b|^Photon message from\b/i.test(String(conversation.title || "")) ? "Text with Skipper" : conversation.title,
    }));
}

export function photonConversation(ownerUserId: number, conversationId: number): Record<string, unknown> | null {
  const main = photonMainChannel();
  if (!main || Number(main.personal_main_owner_id) !== ownerUserId) return null;
  const conversation = q1(`SELECT pc.*,t.title,t.summary,t.status FROM photon_conversations pc
    JOIN threads t ON t.id=pc.thread_id WHERE pc.id=? AND pc.channel_id=?`, conversationId, main.id);
  if (!conversation) return null;
  const messages = q("SELECT id FROM messages WHERE photon_conversation_id=? ORDER BY id", conversationId).map((row) => {
    const message = serializeMessage(Number(row.id));
    if (!message || String(message.body) === "_Working…_") return null;
    const transport = q1("SELECT direction,body FROM photon_messages WHERE message_id=? ORDER BY id DESC LIMIT 1", row.id);
    return { ...message, body: transport?.body ? String(transport.body) : message.body, transport: transport?.direction ? String(transport.direction) : "app" };
  }).filter(Boolean);
  return { ...conversation, messages };
}

/** Continue any saved Texts thread from the desktop. It uses the same Skipper
 * context but deliberately does not mirror the exchange back to the phone. */
export async function continuePhotonConversation(ownerUserId: number, conversationId: number, text: string): Promise<Record<string, unknown>> {
  const main = photonMainChannel();
  if (!main || Number(main.personal_main_owner_id) !== ownerUserId) throw new Error("Texts are available only in your private #main.");
  const conversation = q1("SELECT * FROM photon_conversations WHERE id=? AND channel_id=?", conversationId, main.id);
  if (!conversation) throw new Error("Text thread not found.");
  const body = String(text || "").trim();
  if (!body) throw new Error("Write a message to Skipper.");
  if (body.length > 50_000) throw new Error("Messages are limited to 50,000 characters.");
  const timestamp = now();
  // Sending from a saved conversation resumes that exact context everywhere.
  // Any previously current thread is retained in history but stops receiving
  // phone messages, so the next phone turn continues the desktop selection.
  run("UPDATE photon_conversations SET active=0,closed=COALESCE(closed,?) WHERE sender=? AND active=1 AND id<>?", timestamp, conversation.sender, conversationId);
  run("UPDATE photon_conversations SET active=1,closed=NULL,updated=? WHERE id=?", timestamp, conversationId);
  const messageId = createMessage({ channelId: Number(main.id), parentId: Number(conversation.root_message_id), userId: ownerUserId, body });
  run("UPDATE messages SET photon_conversation_id=? WHERE id=?", conversationId, messageId);
  run("UPDATE threads SET status='open',updated_at=? WHERE id=?", timestamp, conversation.thread_id);
  refreshThreadSummary(Number(conversation.root_message_id));
  sendToUsers([ownerUserId], { type: "photon_update", conversationId, message: serializeMessage(messageId) });
  const skipper = agentForChannel(Number(main.id));
  const bot = skipper?.bot_id ? q1("SELECT * FROM bots WHERE id=?", skipper.bot_id) : undefined;
  if (bot && dispatchInbound) {
    void dispatchInbound(bot, Number(main.id), messageId, Number(conversation.root_message_id))
      .then(() => sendToUsers([ownerUserId], { type: "photon_update", conversationId }))
      .catch((error) => sendToUsers([ownerUserId], { type: "photon_update", conversationId, error: (error as Error).message }));
  }
  return photonConversation(ownerUserId, conversationId)!;
}

function recoverInterruptedPhotonDeliveries(): void {
  for (const delivery of q("SELECT * FROM connector_deliveries WHERE connector='photon' AND state='attempting' ORDER BY id")) {
    run("UPDATE connector_deliveries SET state='uncertain',error='1Helm restarted after handing this reply to Photon; delivery cannot be replayed safely',updated=? WHERE id=? AND state='attempting'", now(), delivery.id);
    run(`INSERT INTO channel_activity (channel_id,kind,summary,status,actor_type,created)
      VALUES (?,'connector',?,'failed','system',?)`, delivery.channel_id,
    `Photon reply delivery is uncertain after a restart. 1Helm did not resend it because that could duplicate the message.`, now());
  }
}

function queuePhotonDelivery(channelId: number, destination: string, body: string, sourceMessageId: number | null, key: string): void {
  run(`INSERT OR IGNORE INTO connector_deliveries
    (connector,idempotency_key,channel_id,destination,body,source_message_id,state,created,updated)
    VALUES ('photon',?,?,?,?,?,'pending',?,?)`, key, channelId, destination, body.slice(0, 50_000), sourceMessageId, now(), now());
}

function activePhotonConversation(sender: string): Row | undefined {
  return q1(`SELECT pc.* FROM photon_conversations pc
    JOIN messages root ON root.id=pc.root_message_id AND root.channel_id=pc.channel_id AND root.parent_id IS NULL
    JOIN threads t ON t.id=pc.thread_id AND t.root_message_id=pc.root_message_id AND t.channel_id=pc.channel_id
    WHERE pc.sender=? AND pc.active=1
    ORDER BY pc.updated DESC,pc.id DESC LIMIT 1`, sender);
}

function closePhotonConversation(channelId: number, sender: string, spaceId: string, event: PhotonEvent): number | null {
  const conversation = activePhotonConversation(sender);
  const timestamp = Date.parse(event.timestamp) || now();
  run("INSERT INTO photon_messages (channel_id,external_id,space_id,sender,direction,body,received_at,message_id) VALUES (?,?,?,?, 'inbound',?,?,NULL)",
    channelId, event.id, spaceId, sender, event.text.slice(0, 50_000), timestamp);
  if (!conversation) return null;
  run("UPDATE photon_conversations SET active=0,space_id=?,updated=?,closed=? WHERE id=? AND active=1", spaceId, timestamp, timestamp, conversation.id);
  run("UPDATE threads SET status='resolved',updated_at=? WHERE id=?", timestamp, conversation.thread_id);
  const noteId = createMessage({ channelId, parentId: Number(conversation.root_message_id), botId: null, body: "Photon conversation closed with /new. The next text starts a new thread." });
  run("UPDATE messages SET system_message=1 WHERE id=?", noteId);
  run("UPDATE messages SET photon_conversation_id=? WHERE id=?", conversation.id, noteId);
  run("INSERT INTO channel_activity (channel_id,thread_id,kind,summary,actor_type,created) VALUES (?,?,'connector',?,'system',?)",
    channelId, conversation.thread_id, `Photon closed the active conversation for ${sender}; the next text will start a new thread.`, timestamp);
  broadcastToChannel(channelId, { type: "message", message: serializeMessage(noteId), parent: serializeMessage(Number(conversation.root_message_id)) });
  sendToUsers([Number(q1("SELECT personal_main_owner_id owner FROM channels WHERE id=?", channelId)?.owner || 0)], { type: "photon_update", conversationId: conversation.id });
  refreshThreadSummary(Number(conversation.root_message_id));
  return noteId;
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
  const main = photonMainChannel();
  if (!main) return false;
  const configured = credentials();
  if (!configured?.operator_phone || event.sender !== configured.operator_phone) return false;
  const channelId = Number(main.id);
  const resident = agentForChannel(channelId);
  if (!resident?.bot_id || resident.kind !== "skipper") return false;
  const timestamp = Date.parse(event.timestamp) || now();
  if (event.text.trim().toLowerCase() === "/new") {
    const noteId = closePhotonConversation(channelId, event.sender, event.space_id, event);
    queuePhotonDelivery(channelId, event.space_id,
      noteId ? "Started fresh. Your next text will open a new 1Helm thread." : "No conversation was open. Your next text will start a new 1Helm thread.",
      noteId, `photon:event:${event.id}:new`);
    await drainPhotonDeliveries();
    return true;
  }
  let conversation = activePhotonConversation(event.sender);
  let rootMessageId = Number(conversation?.root_message_id || 0);
  // Source/direction/sender already live in photon_messages. Keep the visible
  // transcript human and avoid repeating a robotic transport label + phone number.
  const body = event.text;
  const messageId = createMessage({ channelId, parentId: rootMessageId || null, botId: null, body });
  run("UPDATE messages SET system_message=1 WHERE id=?", messageId);
  if (!rootMessageId) {
    rootMessageId = messageId;
    const threadId = ensureThread(rootMessageId, channelId);
    const conversationId = run(`INSERT INTO photon_conversations
      (channel_id,sender,space_id,root_message_id,thread_id,active,started,updated)
      VALUES (?,?,?,?,?,1,?,?)`, channelId, event.sender, event.space_id, rootMessageId, threadId, timestamp, timestamp).lastInsertRowid;
    conversation = q1("SELECT * FROM photon_conversations WHERE id=?", conversationId);
    run("UPDATE messages SET photon_conversation_id=? WHERE id=?", conversationId, messageId);
  } else {
    run("UPDATE photon_conversations SET space_id=?,updated=? WHERE id=? AND active=1", event.space_id, timestamp, conversation!.id);
    run("UPDATE messages SET photon_conversation_id=? WHERE id=?", conversation!.id, messageId);
  }
  const threadId = Number(conversation!.thread_id);
  run("UPDATE threads SET status='open',updated_at=? WHERE id=?", timestamp, threadId);
  run("INSERT INTO photon_messages (channel_id,external_id,space_id,sender,direction,body,received_at,message_id) VALUES (?,?,?,?, 'inbound',?,?,?)", channelId, event.id, event.space_id, event.sender, event.text.slice(0, 50_000), Date.parse(event.timestamp) || now(), messageId);
  run("INSERT INTO channel_activity (channel_id,thread_id,kind,summary,actor_type,created) VALUES (?,?,'connector',?,'system',?)", channelId, threadId, `Photon delivered an iMessage from ${event.sender}.`, now());
  broadcastToChannel(channelId, { type: "message", message: serializeMessage(messageId), parent: rootMessageId === messageId ? null : serializeMessage(rootMessageId) });
  sendToUsers([Number(main.owner_user_id)], { type: "photon_update", conversationId: conversation!.id });
  refreshThreadSummary(rootMessageId);
  const bot = q1("SELECT * FROM bots WHERE id=?", resident.bot_id);
  if (bot && dispatchInbound) {
    try {
      const outboundBefore = Number(q1("SELECT COALESCE(MAX(id),0) id FROM photon_messages WHERE channel_id=? AND space_id=? AND direction='outbound'", channelId, event.space_id)?.id || 0);
      const replyBefore = Number(q1("SELECT COALESCE(MAX(id),0) id FROM messages WHERE channel_id=?", channelId)?.id || 0);
      await dispatchInbound(bot, channelId, messageId, rootMessageId);
      const reply = q1(`SELECT id,body FROM messages WHERE channel_id=? AND parent_id=? AND bot_id=?
        AND id>? AND trim(body)<>'' AND body<>'_Working…_' ORDER BY id DESC LIMIT 1`, channelId, rootMessageId, bot.id, replyBefore);
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
