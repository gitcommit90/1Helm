import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { join, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { db, q, q1, run, now, hashPassword, verifyPassword, newToken, seed, DATA_DIR, UPLOAD_DIR, type Row } from "./db.ts";
import { createMessage, deleteMessage, serializeMessage, setModelPref, setModelPolicy, resolvedModelPolicy, botView, providerView, botEndpoint, botsInChannel, botIsInChannel, addBotToChannel, findMentionedBots } from "./store.ts";
import { computerRowView, fetchModels } from "./computer.ts";
import { cancelChannelTurns, runBot } from "./bots.ts";
import { register, unregister, broadcastToChannel, broadcastAll, sendToUsers } from "./events.ts";
import { openSession, attachClient, listSessions, closeChannelSessions, closeSession } from "./terms.ts";
import { startAgent } from "./agent.ts";
import {
  agentForBot,
  agentForChannel,
  agentViewForChannel,
  archiveChannel,
  channelWorkspace,
  deleteChannelWorld,
  ensureChannelWorkspace,
  ensureThread,
  importAttachment,
  listWorkspaceFiles,
  normalizeChannelName,
  provisionChannel,
  recordMemory,
  refreshThreadSummary,
  renameChannel,
  resolveWorldFile,
  restoreChannel,
  syncWorkspaceArtifacts,
  threadIdForRoot,
  updateChannelPurpose,
} from "./agents.ts";
import { CHATGPT_KIND, bindChatGPTProviderFromCookie, chatgptSessionStatus, chatgptWebResponse, disconnectChatGPTProvider, listChatGPTModels, writeChatGPTWebResponse } from "./chatgpt.ts";
import { completeSetup, setupStatus, workspaceView } from "./setup.ts";
import { connectCloudflareDomain, domainsView } from "./cloudflare.ts";
import { listSkills, listTemplates, provisionSkill, skillsForAgent } from "./skills.ts";
import { ensureAgentMemory, mnemosyneAvailable, prepareMnemosyneRuntime } from "./memory.ts";
import { runImprovementPass, scheduleAgentReview, startImprovementLoop } from "./improvements.ts";
import { runThreadAuditPass, startThreadAuditLoop } from "./thread-audit.ts";
import { startFollowupLoop, threadFollowupView, bumpThreadFollowup } from "./followups.ts";
import {
  internalRoutingProviderId,
  isInternalRoutingProvider,
  proxyRoutingRequest,
  routingInvoke,
  routingCredentials,
  routingModels,
  routingState,
  startRoutingEngine,
  stopRoutingEngine,
} from "./routing.ts";

const PORT = Number(process.env.PORT || 8123);
const PUBLIC = join(process.cwd(), "public");
const JSON_BODY_LIMIT = 1024 * 1024;
const UPLOAD_BODY_LIMIT = 25 * 1024 * 1024;
const WORKSPACE_PHOTO = join(DATA_DIR, "workspace-photo");
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

seed();

// ---- helpers ----
// TLS is terminated by the deployment's reverse proxy. Do not advertise an
// HTTPS-only policy here: local and first-run HTTP deployments must still load
// their relative JS and CSS assets.
const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};
const json = (res: ServerResponse, code: number, body: unknown): void => {
  const s = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", ...SECURITY_HEADERS });
  res.end(s);
};
const body = (req: IncomingMessage, limit = JSON_BODY_LIMIT): Promise<Buffer> => new Promise((resolve, reject) => {
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > limit) { const error = new Error(`Request exceeds the ${Math.floor(limit / 1024 / 1024)} MB limit.`); error.name = "PayloadTooLargeError"; reject(error); return; }
  const chunks: Buffer[] = [];
  let received = 0;
  let oversized = false;
  req.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > limit) { oversized = true; chunks.length = 0; }
    else if (!oversized) chunks.push(chunk);
  });
  req.on("end", () => {
    if (oversized) { const error = new Error(`Request exceeds the ${Math.floor(limit / 1024 / 1024)} MB limit.`); error.name = "PayloadTooLargeError"; reject(error); }
    else resolve(Buffer.concat(chunks));
  });
  req.on("error", reject);
});
const jbody = async (req: IncomingMessage): Promise<Record<string, unknown>> => { const raw = await body(req); try { return JSON.parse(raw.toString() || "{}"); } catch { return {}; } };

const userFromToken = (token: string | null): Row | undefined => {
  if (!token) return undefined;
  const s = q1("SELECT user_id, created FROM sessions WHERE token=?", token);
  if (s && Number(s.created || 0) < now() - SESSION_MAX_AGE_MS) { run("DELETE FROM sessions WHERE token=?", token); return undefined; }
  return s ? q1("SELECT * FROM users WHERE id=?", s.user_id) : undefined;
};
const authUser = (req: IncomingMessage): Row | undefined => {
  const h = req.headers["authorization"];
  if (h && h.startsWith("Bearer ")) return userFromToken(h.slice(7));
  try {
    const u = new URL(req.url || "/", "http://localhost");
    const qToken = u.searchParams.get("token");
    if (qToken) return userFromToken(qToken);
  } catch { /* ignore */ }
  return undefined;
};

const canSee = (user: Row, channelId: number): boolean => {
  const ch = q1("SELECT kind FROM channels WHERE id=?", channelId);
  if (!ch) return false;
  if (ch.kind === "channel") return true;
  return !!q1("SELECT 1 FROM members WHERE channel_id=? AND user_id=?", channelId, user.id);
};

const publicUser = (r: Row): Record<string, unknown> => ({ id: r.id, username: r.username, display: r.display, is_admin: Boolean(r.is_admin) });

/** Shared channel fields for live fan-out — never includes per-user unread. */
function channelMetaView(c: Row, viewer?: Row | null): Record<string, unknown> {
  let name = c.name as string;
  if (c.kind === "dm" && viewer) {
    const other = q1("SELECT u.* FROM members m JOIN users u ON u.id=m.user_id WHERE m.channel_id=? AND m.user_id<>?", c.id, viewer.id);
    name = other ? (other.display as string) : "Direct message";
  }
  return {
    id: c.id,
    name,
    slug: c.slug || String(c.id),
    kind: c.kind,
    topic: c.topic,
    purpose: c.purpose || c.topic,
    status: c.status || "active",
    agent: c.kind === "channel" ? agentViewForChannel(Number(c.id)) : null,
  };
}

/** True when a message is durable activity the Captain should see as unread.
 *  Agent turns reuse one row: create `_Working…_` then stream into the same id.
 *  Marking that placeholder as last_read made finished turns invisible forever. */
function messageIsSettledSql(alias = "m"): string {
  return `(
    ${alias}.user_id IS NOT NULL
    OR (
      trim(coalesce(${alias}.body,'')) <> ''
      AND ${alias}.body <> '_Working…_'
      AND ${alias}.body NOT LIKE '[scheduled-followup%'
      AND ${alias}.body NOT LIKE '⟦followup⟧%'
      AND NOT EXISTS (
        SELECT 1 FROM agent_progress ap
        WHERE ap.message_id = ${alias}.id AND ap.status = 'running'
      )
    )
  )`;
}

function maxSettledMessageId(channelId: number): number {
  return Number(q1(
    `SELECT MAX(m.id) x FROM messages m
     WHERE m.channel_id=? AND ${messageIsSettledSql("m")}`,
    channelId,
  )?.x || 0);
}

function channelUnreadCount(userId: number, channelId: number, lastRead: number): number {
  return Number(q1(
    `SELECT COUNT(*) n FROM messages m
     WHERE m.channel_id=? AND m.id>? AND (m.user_id IS NULL OR m.user_id<>?)
       AND ${messageIsSettledSql("m")}`,
    channelId, lastRead, userId,
  )?.n || 0);
}

function channelView(user: Row, c: Row): Record<string, unknown> {
  const lastRead = Number(q1("SELECT last_read FROM members WHERE channel_id=? AND user_id=?", c.id, user.id)?.last_read || 0);
  // Settled roots + replies only — never count in-flight Working placeholders.
  const unread = channelUnreadCount(Number(user.id), Number(c.id), lastRead);
  return { ...channelMetaView(c, user), unread };
}

function broadcastChannelMeta(channelId: number, type: "channel_update" | "channel_new" = "channel_update"): void {
  const row = q1("SELECT * FROM channels WHERE id=?", channelId);
  if (!row) return;
  // Public agent channels: one shared payload. DMs keep membership-scoped name resolution.
  if (row.kind === "channel") {
    broadcastToChannel(channelId, { type, channel: channelMetaView(row) });
    return;
  }
  for (const member of q("SELECT user_id FROM members WHERE channel_id=?", channelId)) {
    const viewer = q1("SELECT * FROM users WHERE id=?", member.user_id);
    if (!viewer) continue;
    sendToUsers([Number(member.user_id)], { type, channel: channelMetaView(row, viewer) });
  }
}

function visibleChannels(user: Row): Row[] {
  return q(`SELECT * FROM (
              SELECT * FROM channels WHERE kind='channel' AND status<>'deleted'
              UNION SELECT c.* FROM channels c JOIN members m ON m.channel_id=c.id WHERE m.user_id=? AND c.kind<>'channel' AND c.status<>'deleted'
            ) ORDER BY CASE WHEN status='archived' THEN 1 ELSE 0 END, kind, name`, user.id);
}

/** Fire the bound resident or workspace-wide Skipper mentioned in a message. */
function triggerBots(channelId: number, msg: Row, authorId: number): void {
  const fresh = msg.parent_id == null;
  const threadRootId = Number(msg.parent_id ?? msg.id);
  const mentioned = findMentionedBots(String(msg.body));
  if (!mentioned.length && msg.parent_id != null) {
    const participant = conversationalAgent(channelId, threadRootId, Number(msg.id));
    if (participant?.automatic) {
      void launchBot(participant.bot, channelId, msg, authorId, threadRootId, false);
      return;
    }
    if (participant && !q1("SELECT muted FROM thread_mention_preferences WHERE thread_id=? AND user_id=? AND muted=1", participant.threadId, authorId)) {
      sendToUsers([authorId], {
        type: "mention_confirmation", channelId, messageId: msg.id, threadRootId,
        botId: participant.bot.id, botName: participant.bot.name,
      });
    }
    return;
  }
  // Skipper owns an explicitly escalated request. Other @mentions in that
  // request identify collaborators/context; they must not launch competing
  // agent turns and duplicate the work.
  const skipper = mentioned.find((bot) => agentForBot(Number(bot.id))?.kind === "skipper");
  for (const bot of skipper ? [skipper] : mentioned) void launchBot(bot, channelId, msg, authorId, threadRootId, fresh);
}

function launchBot(bot: Row, channelId: number, msg: Row, authorId: number, threadRootId: number, fresh: boolean): void {
  const agent = agentForBot(Number(bot.id));
  if (agent?.kind === "skipper") {
    const threadId = threadIdForRoot(threadRootId, channelId) ?? ensureThread(threadRootId, channelId);
    const escalationId = run("INSERT INTO escalations (thread_id,channel_id,reason,status,created) VALUES (?,?,?,'open',?)",
      threadId, channelId, String(msg.body).slice(0, 4000), now()).lastInsertRowid;
    run("INSERT INTO channel_activity (channel_id,thread_id,kind,summary,status,actor_type,created) VALUES (?,?,'escalation',?,'open','human',?)", channelId, threadId, String(msg.body).slice(0, 500), now());
    broadcastToChannel(channelId, { type: "escalation", channelId, escalation: { id: escalationId, thread_id: threadId, reason: msg.body, status: "open" } });
    const hostAuthorized = Boolean(q1("SELECT is_admin FROM users WHERE id=?", authorId)?.is_admin);
    void runBot(bot, channelId, Number(msg.id), threadRootId, fresh, escalationId, hostAuthorized);
  } else if (agent?.kind === "channel") {
    if (Number(agent.channel_id) === channelId) void runBot(bot, channelId, Number(msg.id), threadRootId, fresh);
  } else if (botIsInChannel(Number(bot.id), channelId)) void runBot(bot, channelId, Number(msg.id), threadRootId, fresh);
  else sendToUsers([authorId], { type: "bot_prompt", botId: bot.id, botName: bot.name, channelId, triggerId: msg.id, threadRootId, fresh });
}

/** A one-human/one-agent thread stays conversational until another named or
 * participating human/agent joins it. */
function conversationalAgent(channelId: number, threadRootId: number, beforeMessageId: number): { bot: Row; threadId: number; automatic: boolean } | null {
  const rows = q("SELECT * FROM messages WHERE (id=? OR parent_id=?) AND id<? ORDER BY id", threadRootId, threadRootId, beforeMessageId);
  const botIds = new Set<number>();
  const humanIds = new Set<number>();
  let recentBotId = 0;
  const currentAuthor = q1("SELECT user_id FROM messages WHERE id=?", beforeMessageId);
  if (currentAuthor?.user_id) humanIds.add(Number(currentAuthor.user_id));
  for (const row of rows) {
    if (row.user_id) humanIds.add(Number(row.user_id));
    if (row.bot_id && String(row.body) !== "_Working…_") {
      botIds.add(Number(row.bot_id));
      recentBotId = Number(row.bot_id);
    }
    // Only human-authored @mentions expand the participant set.
    // Agent replies (especially Skipper in #main) often name other bots like
    // "Resident @oss-scout-agent" without inviting them into this thread — that
    // must not force "Did you mean to tag @skipper?" on every follow-up.
    if (row.user_id) {
      for (const mentioned of findMentionedBots(String(row.body))) botIds.add(Number(mentioned.id));
      const names = new Set((String(row.body).match(/@([a-zA-Z0-9_.-]+)/g) || []).map((name) => name.slice(1).toLowerCase()));
      if (names.size) {
        for (const human of q("SELECT id,username FROM users")) {
          if (names.has(String(human.username).toLowerCase())) humanIds.add(Number(human.id));
        }
      }
    }
  }
  if (!recentBotId) return null;
  const threadId = threadIdForRoot(threadRootId, channelId) ?? ensureThread(threadRootId, channelId);
  for (const guest of q("SELECT a.bot_id FROM thread_agent_guests g JOIN agents a ON a.id=g.agent_id WHERE g.thread_id=? AND g.status='active'", threadId)) {
    if (guest.bot_id) botIds.add(Number(guest.bot_id));
  }
  const bot = q1("SELECT * FROM bots WHERE id=?", recentBotId);
  if (!bot) return null;
  return { bot, threadId, automatic: botIds.size === 1 && humanIds.size === 1 };
}

function setBotComputers(botId: number, computerIds: unknown[]): void {
  run("DELETE FROM bot_computers WHERE bot_id=?", botId);
  for (const c of computerIds) {
    const cid = Number(c);
    if (cid && q1("SELECT 1 FROM computers WHERE id=?", cid)) run("INSERT OR IGNORE INTO bot_computers (bot_id, computer_id) VALUES (?,?)", botId, cid);
  }
}

function postMessage(channelId: number, user: Row, text: string, parentId: number | null, uploads: { token: string; name: string; mime: string; size: number }[], modelPolicy?: { provider_id?: number | null; model?: string | null }): Row {
  const channel = q1("SELECT status FROM channels WHERE id=?", channelId);
  if (!channel) throw new Error("Channel not found.");
  if (channel.status !== "active") throw new Error("Restore this channel before starting new work.");
  if (parentId) {
    const parent = q1("SELECT id FROM messages WHERE id=? AND channel_id=? AND parent_id IS NULL", parentId, channelId);
    if (!parent) throw new Error("Thread root does not belong to this channel.");
  }
  const message = text.trim();
  if (!message && !(uploads || []).length) throw new Error("Write a message or attach a file.");
  if (message.length > 50_000) throw new Error("Messages are limited to 50,000 characters.");
  if (modelPolicy?.provider_id && !q1("SELECT 1 FROM providers WHERE id=?", Number(modelPolicy.provider_id))) throw new Error("Provider not found.");
  const id = createMessage({ channelId, parentId, userId: Number(user.id), body: message });
  const rootId = parentId || id;
  const threadId = ensureThread(rootId, channelId);
  if (modelPolicy?.model) {
    const agent = agentForChannel(channelId);
    // Skipper always keeps its workspace-wide policy, including in #main.
    if (agent?.bot_id && agent.kind !== "skipper") {
      const providerId = modelPolicy.provider_id ? Number(modelPolicy.provider_id) : null;
      setModelPolicy(Number(agent.bot_id), "thread", String(rootId), providerId, String(modelPolicy.model));
    }
  }
  run("UPDATE threads SET status='open', updated_at=? WHERE id=? AND status IN ('waiting','resolved','failed')", now(), threadId);
  const uniqueUploads = [...new Map((uploads || []).map((upload) => [upload.token, upload])).values()].slice(0, 20);
  for (const upload of uniqueUploads) {
    if (!/^[a-f0-9]{32,}$/.test(upload.token) || !existsSync(join(UPLOAD_DIR, upload.token))) continue;
    const size = statSync(join(UPLOAD_DIR, upload.token)).size;
    run("INSERT INTO attachments (message_id, name, mime, size, path) VALUES (?,?,?,?,?)", id, upload.name.slice(0, 255), upload.mime.slice(0, 255), size, upload.token);
    importAttachment(channelId, threadId, upload.token, upload.name, "human");
  }
  refreshThreadSummary(rootId);
  const msg = serializeMessage(id)!;
  broadcastToChannel(channelId, { type: "message", message: msg, parent: parentId ? serializeMessage(parentId) : null });
  triggerBots(channelId, msg, Number(user.id));
  return msg;
}

// ---- HTTP routing ----
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://localhost`);
    const p = url.pathname;
    const m = req.method || "GET";

    // The unified provider gateway is public by URL and authenticates with its
    // own generated gateway keys. It intentionally does not use a 1Helm web
    // session so editors, CLIs, and other machines can use the same endpoint.
    if (p === "/health" || p === "/v1" || p.startsWith("/v1/")) return proxyRoutingRequest(req, res);

    // static
    if ((m === "GET" || m === "HEAD") && !p.startsWith("/api/")) {
      const rel = p === "/" ? "/index.html" : p;
      const file = join(PUBLIC, rel);
      if (file.startsWith(PUBLIC) && existsSync(file)) {
        const ct = MIME[extname(file)] || "application/octet-stream";
        // index.html: always revalidate so a freshly built bundle.js?v=... is picked up.
        // versioned assets (bundle.js?..., app.css?...): cached hard for a year.
        const isHtml = rel === "/index.html" || extname(file) === ".html";
        const isSw = rel === "/sw.js" || rel.endsWith("/sw.js");
        const isManifest = extname(file) === ".webmanifest";
        const headers: Record<string, string> = { "content-type": ct, ...SECURITY_HEADERS };
        if (isHtml || isSw || isManifest) headers["cache-control"] = "no-cache, must-revalidate";
        else headers["cache-control"] = "public, max-age=31536000, immutable";
        res.writeHead(200, headers);
        res.end(m === "HEAD" ? undefined : await readFile(file));
        return;
      }
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-cache, must-revalidate", ...SECURITY_HEADERS });
      res.end(m === "HEAD" ? undefined : await readFile(join(PUBLIC, "index.html")).catch(() => "1Helm (run npm run build)"));
      return;
    }

    // ---- setup and auth (no session required) ----
    if (p === "/api/setup/status" && m === "GET") return json(res, 200, setupStatus());
    if (p === "/api/auth/register" && m === "POST") {
      if (Number(q1("SELECT COUNT(*) n FROM users")?.n || 0) > 0) return json(res, 403, { error: "Registration is closed. Ask the Captain to add you from Members." });
      const b = await jbody(req);
      const username = String(b.username || "").trim().toLowerCase();
      const password = String(b.password || "");
      const display = String(b.display || b.username || "").trim() || username;
      if (!/^[a-z0-9_.-]{2,32}$/.test(username) || password.length < 4) return json(res, 400, { error: "Invalid username or password (min 4 chars)." });
      if (q1("SELECT 1 FROM users WHERE username=?", username)) return json(res, 409, { error: "Username taken." });
      const uid = run("INSERT INTO users (username, pass, display, is_admin, created) VALUES (?,?,?,?,?)", username, hashPassword(password), display, 1, now()).lastInsertRowid;
      for (const ch of q("SELECT id FROM channels WHERE kind='channel'")) run("INSERT OR IGNORE INTO members (channel_id, user_id) VALUES (?,?)", ch.id, uid);
      const token = newToken();
      run("INSERT INTO sessions (token, user_id, created) VALUES (?,?,?)", token, uid, now());
      return json(res, 200, { token, user: publicUser(q1("SELECT * FROM users WHERE id=?", uid)!) });
    }
    if (p === "/api/auth/login" && m === "POST") {
      const b = await jbody(req);
      const u = q1("SELECT * FROM users WHERE username=?", String(b.username || "").trim().toLowerCase());
      if (!u || !verifyPassword(String(b.password || ""), String(u.pass))) return json(res, 401, { error: "Wrong username or password." });
      const token = newToken();
      run("INSERT INTO sessions (token, user_id, created) VALUES (?,?,?)", token, u.id, now());
      return json(res, 200, { token, user: publicUser(u) });
    }

    // ---- everything below requires a session ----
    const user = authUser(req);
    if (!user) return json(res, 401, { error: "Not authenticated" });

    // 1Helm-native control-plane facade over the embedded routing engine.
    // Account credentials and gateway keys are workspace-admin material.
    if (p === "/api/routing/state" && m === "GET") {
      if (!user.is_admin) return json(res, 403, { error: "Captain/admin only" });
      return json(res, 200, await routingState());
    }
    if (p === "/api/routing/credentials" && m === "GET") {
      if (!user.is_admin) return json(res, 403, { error: "Captain/admin only" });
      return json(res, 200, await routingCredentials());
    }
    if (p === "/api/routing/models" && m === "GET") {
      return json(res, 200, { models: await routingModels() });
    }
    if (p === "/api/routing/action" && m === "POST") {
      if (!user.is_admin) return json(res, 403, { error: "Captain/admin only" });
      const b = await jbody(req);
      const action = String(b.action || "");
      const allowed = new Set([
        "app:oauth-start", "app:oauth-status", "app:oauth-cancel", "app:oauth-complete",
        "app:add-keyed-provider", "app:test-keyed-provider", "app:remove-provider",
        "app:set-provider-enabled", "app:usage", "app:quota-get", "app:quota-refresh",
        "app:save-combo", "app:delete-combo", "app:create-api-key", "app:revoke-api-key",
        "app:set-api-key-enabled", "app:set-model-enabled", "app:set-all-models-enabled",
        "app:add-model", "app:remove-model", "app:logs-get", "app:logs-clear", "app:set-bind-host",
      ]);
      if (!allowed.has(action)) return json(res, 400, { error: "Unsupported routing action." });
      const result = await routingInvoke(action, b.payload);
      if (result.ok !== false) broadcastAll({ type: "routing_changed", action });
      return json(res, result.ok === false ? 400 : 200, result);
    }

    // Login-with-ChatGPT device flow. Every route is admin-only because this
    // session becomes the shared provider used by all ChatGPT-backed bots.
    if (p === "/api/chatgpt" || p.startsWith("/api/chatgpt/")) {
      if (!user.is_admin) return json(res, 403, { error: "Admin only" });
      const raw = await body(req);
      return writeChatGPTWebResponse(res, await chatgptWebResponse(req, raw));
    }
    if (p === "/api/providers/chatgpt/status" && m === "GET") {
      if (!user.is_admin) return json(res, 403, { error: "Admin only" });
      try { return json(res, 200, await chatgptSessionStatus()); }
      catch (e) { return json(res, 502, { error: (e as Error).message }); }
    }
    if (p === "/api/providers/chatgpt/complete" && m === "POST") {
      if (!user.is_admin) return json(res, 403, { error: "Admin only" });
      try {
        const r = await bindChatGPTProviderFromCookie(req.headers.cookie);
        const provider = providerView(q1("SELECT * FROM providers WHERE id=?", r.providerId)!);
        broadcastAll({ type: "provider_update", provider });
        return json(res, 200, { provider, user: r.user });
      } catch (e) { return json(res, 400, { error: (e as Error).message }); }
    }
    if (p === "/api/providers/chatgpt/disconnect" && m === "POST") {
      if (!user.is_admin) return json(res, 403, { error: "Admin only" });
      try {
        await disconnectChatGPTProvider();
        // Clients resync providers on reconnect; push a soft notice so open UIs refresh lists.
        broadcastAll({ type: "providers_changed" });
        return json(res, 200, { ok: true });
      }
      catch (e) { return json(res, 502, { error: (e as Error).message }); }
    }

    if (p === "/api/me") return json(res, 200, { user: publicUser(user), workspace: workspaceView() });
    // Profile-bound UI layout (docked terminal, preferred computer, per-channel view). Not browser cache.
    if (p === "/api/me/ui-state" && m === "GET") {
      const rows = q("SELECT key, value, updated FROM user_ui_state WHERE user_id=?", user.id);
      const state: Record<string, unknown> = {};
      for (const row of rows) {
        try { state[String(row.key)] = JSON.parse(String(row.value || "{}")); }
        catch { state[String(row.key)] = String(row.value || ""); }
      }
      return json(res, 200, { state });
    }
    if (p === "/api/me/ui-state" && (m === "PUT" || m === "PATCH")) {
      const b = await jbody(req);
      const entries: { key: string; value: unknown }[] = [];
      if (b && typeof b === "object" && b.state && typeof b.state === "object" && !Array.isArray(b.state)) {
        for (const [key, value] of Object.entries(b.state as Record<string, unknown>)) entries.push({ key, value });
      } else if (b && typeof b === "object" && typeof (b as { key?: unknown }).key === "string") {
        entries.push({ key: String((b as { key: string }).key), value: (b as { value?: unknown }).value });
      } else if (Array.isArray((b as { entries?: unknown }).entries)) {
        for (const item of (b as { entries: unknown[] }).entries) {
          if (!item || typeof item !== "object") continue;
          const key = String((item as { key?: unknown }).key || "").trim();
          if (!key) continue;
          entries.push({ key, value: (item as { value?: unknown }).value });
        }
      }
      if (!entries.length) return json(res, 400, { error: "Provide { key, value }, { entries }, or { state }." });
      const ts = now();
      for (const entry of entries) {
        const key = entry.key.trim().slice(0, 200);
        if (!key) continue;
        const value = JSON.stringify(entry.value === undefined ? null : entry.value);
        if (value.length > 100_000) return json(res, 400, { error: `UI state value for ${key} is too large.` });
        run(`INSERT INTO user_ui_state (user_id, key, value, updated) VALUES (?,?,?,?)
          ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value, updated=excluded.updated`,
          user.id, key, value, ts);
      }
      const rows = q("SELECT key, value FROM user_ui_state WHERE user_id=?", user.id);
      const state: Record<string, unknown> = {};
      for (const row of rows) {
        try { state[String(row.key)] = JSON.parse(String(row.value || "{}")); }
        catch { state[String(row.key)] = String(row.value || ""); }
      }
      return json(res, 200, { state });
    }
    if (p === "/api/workspace" && m === "GET") return json(res, 200, { workspace: workspaceView() });
    if (p === "/api/workspace" && m === "PATCH") {
      if (!user.is_admin) return json(res, 403, { error: "Captain/admin only" });
      const b = await jbody(req);
      const name = String(b.name || "").trim().slice(0, 100);
      const theme = String(b.theme || "graphite");
      if (!name) return json(res, 400, { error: "Workspace name is required." });
      if (!["graphite", "ocean", "forest", "ember", "plum"].includes(theme)) return json(res, 400, { error: "Unknown workspace theme." });
      run("UPDATE workspace SET name=?,theme=? WHERE id=1", name, theme);
      const workspace = workspaceView();
      broadcastAll({ type: "workspace_update", workspace });
      return json(res, 200, { workspace });
    }
    if (p === "/api/workspace/photo" && m === "GET") {
      const mime = String(q1("SELECT photo_mime FROM workspace WHERE id=1")?.photo_mime || "");
      if (!mime || !existsSync(WORKSPACE_PHOTO)) return json(res, 404, { error: "No workspace photo." });
      res.writeHead(200, { "content-type": mime, "cache-control": "no-cache", ...SECURITY_HEADERS });
      res.end(await readFile(WORKSPACE_PHOTO)); return;
    }
    if (p === "/api/workspace/photo" && m === "POST") {
      if (!user.is_admin) return json(res, 403, { error: "Captain/admin only" });
      const mime = String(req.headers["content-type"] || "").split(";")[0];
      if (!/^image\/(png|jpeg|webp|gif)$/.test(mime)) return json(res, 400, { error: "Use a PNG, JPEG, WebP, or GIF image." });
      const bytes = await body(req, 5 * 1024 * 1024);
      if (!bytes.length) return json(res, 400, { error: "Choose an image." });
      await writeFile(WORKSPACE_PHOTO, bytes, { mode: 0o600 });
      run("UPDATE workspace SET photo_mime=? WHERE id=1", mime);
      const workspace = workspaceView();
      broadcastAll({ type: "workspace_update", workspace });
      return json(res, 200, { workspace });
    }
    if (p === "/api/workspace/photo" && m === "DELETE") {
      if (!user.is_admin) return json(res, 403, { error: "Captain/admin only" });
      try { unlinkSync(WORKSPACE_PHOTO); } catch { /* absent */ }
      run("UPDATE workspace SET photo_mime='' WHERE id=1");
      const workspace = workspaceView();
      broadcastAll({ type: "workspace_update", workspace });
      return json(res, 200, { workspace });
    }
    if (p === "/api/agent-templates" && m === "GET") return json(res, 200, { templates: listTemplates() });
    if (p === "/api/skills" && m === "GET") return json(res, 200, { skills: listSkills() });
    const agentSkills = p.match(/^\/api\/agents\/(\d+)\/skills$/);
    if (agentSkills && m === "GET") return json(res, 200, { skills: skillsForAgent(Number(agentSkills[1])) });
    if (agentSkills && m === "POST") {
      if (!user.is_admin) return json(res, 403, { error: "Captain/admin only" });
      const b = await jbody(req);
      try { return json(res, 201, { skill: provisionSkill(Number(agentSkills[1]), String(b.skill || b.slug || ""), Number(q1("SELECT id FROM agents WHERE kind='skipper' AND status<>'deleted' LIMIT 1")?.id || 0) || null, String(b.reason || "Provisioned by the Captain.")) }); }
      catch (error) { return json(res, 400, { error: (error as Error).message }); }
    }
    if (p === "/api/improvements/run" && m === "POST") {
      if (!user.is_admin) return json(res, 403, { error: "Captain/admin only" });
      return json(res, 200, { improved: runImprovementPass() });
    }
    if (p === "/api/thread-audit/run" && m === "POST") {
      if (!user.is_admin) return json(res, 403, { error: "Captain/admin only" });
      return json(res, 200, await runThreadAuditPass());
    }
    if (p === "/api/domains" && m === "GET") return json(res, 200, { domains: domainsView() });
    if (p === "/api/domains/cloudflare" && m === "POST") {
      if (!user.is_admin) return json(res, 403, { error: "Captain/admin only" });
      const b = await jbody(req);
      try { return json(res, 201, { domain: await connectCloudflareDomain(String(b.hostname || ""), String(b.token || ""), PORT) }); }
      catch (error) { return json(res, 400, { error: (error as Error).message }); }
    }
    if (p === "/api/setup/complete" && m === "POST") {
      if (!user.is_admin) return json(res, 403, { error: "Admin only" });
      if (workspaceView().setup_complete) return json(res, 409, { error: "Setup already completed." });
      const b = await jbody(req);
      try {
        const result = await completeSetup({
          name: String(b.name || "My Workspace"),
          terminalsEnabled: b.terminals_enabled !== false && b.terminalsEnabled !== false,
          userId: Number(user.id),
          providerId: b.provider_id ? Number(b.provider_id) : undefined,
          model: b.model ? String(b.model) : undefined,
        });
        return json(res, 200, result);
      } catch (e) { return json(res, 400, { error: (e as Error).message }); }
    }
    if (p === "/api/auth/logout" && m === "POST") {
      const h = req.headers["authorization"]; if (h?.startsWith("Bearer ")) run("DELETE FROM sessions WHERE token=?", h.slice(7));
      return json(res, 200, { ok: true });
    }
    if (p === "/api/users" && m === "GET") return json(res, 200, { users: q("SELECT * FROM users ORDER BY display").map(publicUser) });

    // channels
    if (p === "/api/channels" && m === "GET") return json(res, 200, { channels: visibleChannels(user).map((c) => channelView(user, c)) });
    // Global thread inbox (cross-channel) for the sidebar Threads control.
    if (p === "/api/threads" && m === "GET") {
      const unreadOnly = url.searchParams.get("unread") === "1" || url.searchParams.get("unread") === "true";
      const channels = visibleChannels(user).filter((c) => c.kind === "channel" && String(c.status || "active") !== "deleted");
      const threads: Record<string, unknown>[] = [];
      for (const channel of channels) {
        const channelId = Number(channel.id);
        for (const root of q("SELECT id FROM messages WHERE channel_id=? AND parent_id IS NULL ORDER BY id", channelId)) {
          ensureThread(Number(root.id), channelId);
        }
        const lastRead = Number(q1("SELECT last_read FROM members WHERE channel_id=? AND user_id=?", channelId, user.id)?.last_read || 0);
        for (const thread of q("SELECT * FROM threads WHERE channel_id=? ORDER BY updated_at DESC", channelId)) {
          const rootId = Number(thread.root_message_id);
          const unread = Number(q1(
            `SELECT COUNT(*) n FROM messages m
             WHERE (m.id=? OR m.parent_id=?) AND m.id>? AND (m.user_id IS NULL OR m.user_id<>?)
               AND ${messageIsSettledSql("m")}`,
            rootId, rootId, lastRead, user.id,
          )?.n || 0) > 0;
          if (unreadOnly && !unread) continue;
          threads.push({
            ...thread,
            channel_name: channel.name,
            channel_slug: channel.slug || String(channel.id),
            unread,
            followup: threadFollowupView(Number(thread.id)),
            root: serializeMessage(rootId),
          });
        }
      }
      threads.sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0));
      return json(res, 200, { threads });
    }
    if (p === "/api/channels" && m === "POST") {
      const b = await jbody(req);
      const name = normalizeChannelName(String(b.name || ""));
      const purpose = String(b.purpose || b.topic || "").trim();
      if (!name) return json(res, 400, { error: "Invalid channel name." });
      if (!purpose) return json(res, 400, { error: "What is this channel all about?" });
      try {
        const provisioned = provisionChannel({ name, purpose, userId: Number(user.id), templateSlug: String(b.template || "general") });
        const row = q1("SELECT * FROM channels WHERE id=?", provisioned.channelId)!;
        const channel = channelView(user, row);
        broadcastChannelMeta(provisioned.channelId, "channel_new");
        if (provisioned.announcementId) broadcastToChannel(provisioned.channelId, { type: "message", message: serializeMessage(provisioned.announcementId) });
        return json(res, provisioned.created ? 201 : 200, { channel, created: provisioned.created });
      } catch (error) {
        const message = (error as Error).message;
        return json(res, /already exists/i.test(message) ? 409 : 400, { error: message });
      }
    }
    const nativeChannel = p.match(/^\/api\/channels\/(\d+)(?:\/(archive|restore|threads|files|memory|activity|agent-policy|agent-avatar))?$/);
    if (nativeChannel) {
      const channelId = Number(nativeChannel[1]);
      const action = nativeChannel[2] || "channel";
      if (!canSee(user, channelId)) return json(res, 403, { error: "No access" });
      if (action === "channel" && m === "PATCH") {
        const b = await jbody(req);
        const purposeIn = "purpose" in b || "topic" in b;
        const nameIn = "name" in b;
        if (!purposeIn && !nameIn) return json(res, 400, { error: "Nothing to update." });
        try {
          if (nameIn) {
            if (!user.is_admin) return json(res, 403, { error: "Captain/admin only" });
            renameChannel(channelId, String(b.name || ""));
          }
          if (purposeIn) {
            const purpose = String(b.purpose ?? b.topic ?? "").trim();
            if (!purpose) return json(res, 400, { error: "Purpose is required." });
            updateChannelPurpose(channelId, purpose);
          }
        } catch (error) { return json(res, 400, { error: (error as Error).message }); }
        const channel = channelView(user, q1("SELECT * FROM channels WHERE id=?", channelId)!);
        broadcastChannelMeta(channelId);
        return json(res, 200, { channel });
      }
      if (action === "archive" && m === "POST") {
        if (!user.is_admin) return json(res, 403, { error: "Captain/admin only" });
        const target = q1("SELECT name FROM channels WHERE id=? AND kind='channel'", channelId);
        if (!target || String(target.name) === "main") return json(res, 400, { error: target ? "#main cannot be archived." : "Channel not found." });
        try {
          cancelChannelTurns(channelId); archiveChannel(channelId); closeChannelSessions(channelId);
          const channel = channelView(user, q1("SELECT * FROM channels WHERE id=?", channelId)!);
          broadcastChannelMeta(channelId);
          return json(res, 200, { channel });
        } catch (error) { return json(res, 400, { error: (error as Error).message }); }
      }
      if (action === "restore" && m === "POST") {
        if (!user.is_admin) return json(res, 403, { error: "Captain/admin only" });
        try {
          restoreChannel(channelId);
          const channel = channelView(user, q1("SELECT * FROM channels WHERE id=?", channelId)!);
          broadcastChannelMeta(channelId);
          return json(res, 200, { channel });
        } catch (error) { return json(res, 400, { error: (error as Error).message }); }
      }
      if (action === "channel" && m === "DELETE") {
        if (!user.is_admin) return json(res, 403, { error: "Captain/admin only" });
        const b = await jbody(req);
        const target = q1("SELECT name, status FROM channels WHERE id=? AND kind='channel'", channelId);
        const confirmation = String(b.confirm || "");
        if (!target || String(target.name) === "main" || target.status !== "archived" || confirmation !== String(target.name)) {
          return json(res, 400, { error: !target ? "Channel not found." : String(target.name) === "main" ? "#main cannot be deleted." : target.status !== "archived" ? "Archive the channel before permanent deletion." : "Type the channel name to confirm permanent deletion." });
        }
        try {
          cancelChannelTurns(channelId); closeChannelSessions(channelId); deleteChannelWorld(channelId, confirmation);
          broadcastToChannel(channelId, { type: "channel_deleted", channelId });
          return json(res, 200, { ok: true });
        } catch (error) { return json(res, 400, { error: (error as Error).message }); }
      }
      if (action === "threads" && m === "GET") {
        for (const root of q("SELECT id FROM messages WHERE channel_id=? AND parent_id IS NULL ORDER BY id", channelId)) ensureThread(Number(root.id), channelId);
        const threads = q("SELECT * FROM threads WHERE channel_id=? ORDER BY updated_at DESC", channelId).map((thread) => ({
          ...thread,
          followup: threadFollowupView(Number(thread.id)),
          root: serializeMessage(Number(thread.root_message_id)),
        }));
        return json(res, 200, { threads });
      }
      if (action === "files" && m === "GET") {
        const files = syncWorkspaceArtifacts(channelId, null, "agent");
        return json(res, 200, { files, artifacts: q("SELECT * FROM artifacts WHERE channel_id=? ORDER BY modified DESC", channelId) });
      }
      if (action === "memory" && m === "GET") return json(res, 200, { memory: q("SELECT m.*, t.root_message_id FROM memory_items m LEFT JOIN threads t ON t.id=m.thread_id WHERE m.channel_id=? AND m.kind<>'summary' ORDER BY m.status, m.created DESC", channelId) });
      if (action === "memory" && m === "POST") {
        const b = await jbody(req);
        const rootId = b.threadRootId ? Number(b.threadRootId) : null;
        const threadId = rootId ? threadIdForRoot(rootId, channelId) : null;
        try {
          const id = recordMemory({ channelId, threadId, kind: String(b.kind || "fact"), content: String(b.content || ""), authorType: "human", scope: String(b.scope || "channel") });
          return json(res, 201, { memory: q1("SELECT * FROM memory_items WHERE id=?", id) });
        } catch (error) { return json(res, 400, { error: (error as Error).message }); }
      }
      if (action === "activity" && m === "GET") return json(res, 200, {
        activity: q("SELECT * FROM channel_activity WHERE channel_id=? ORDER BY created DESC LIMIT 200", channelId),
        actions: q(`SELECT ta.* FROM tool_actions ta JOIN threads t ON t.id=ta.thread_id WHERE t.channel_id=? ORDER BY ta.created DESC LIMIT 100`, channelId),
        escalations: q("SELECT * FROM escalations WHERE channel_id=? ORDER BY created DESC LIMIT 100", channelId),
      });
      if (action === "agent-policy" && m === "PATCH") {
        if (!user.is_admin) return json(res, 403, { error: "Captain/admin only" });
        const b = await jbody(req);
        const agent = agentForChannel(channelId);
        if (!agent?.bot_id) return json(res, 404, { error: "Resident agent not found." });
        if (b.provider_id && !q1("SELECT 1 FROM providers WHERE id=?", Number(b.provider_id))) return json(res, 400, { error: "Provider not found." });
        if ("provider_id" in b) {
          const providerId = b.provider_id ? Number(b.provider_id) : null;
          run("UPDATE bots SET provider_id=? WHERE id=?", providerId, agent.bot_id);
          if (agent.kind === "skipper") {
            run("UPDATE workspace SET default_provider_id=? WHERE id=1", providerId);
            run("UPDATE bots SET provider_id=? WHERE id IN (SELECT bot_id FROM agents WHERE kind='channel' AND provider_inherited=1 AND status<>'deleted')", providerId);
          } else run("UPDATE agents SET provider_inherited=0 WHERE id=?", agent.id);
        }
        if ("model" in b) {
          if (agent.kind === "skipper") {
            run("UPDATE bots SET model=? WHERE id=?", String(b.model || ""), agent.bot_id);
            run("UPDATE workspace SET default_model=? WHERE id=1", String(b.model || ""));
          } else setModelPref(Number(agent.bot_id), "channel", String(channelId), b.model ? String(b.model) : null);
        }
        const channel = channelView(user, q1("SELECT * FROM channels WHERE id=?", channelId)!);
        broadcastChannelMeta(channelId);
        return json(res, 200, { channel });
      }
      if (action === "agent-avatar" && m === "PATCH") {
        const b = await jbody(req);
        const agent = agentForChannel(channelId);
        if (!agent?.bot_id) return json(res, 404, { error: "Resident agent not found." });
        const avatar = String(b.avatar || "");
        if (avatar && !avatar.startsWith("color:") && !avatar.startsWith("data:image/") && !avatar.startsWith("/")) {
          return json(res, 400, { error: "Invalid avatar value." });
        }
        if (avatar.startsWith("data:image/") && avatar.length > 1_500_000) {
          return json(res, 400, { error: "Avatar image too large." });
        }
        run("UPDATE bots SET avatar=? WHERE id=?", avatar, agent.bot_id);
        const channel = channelView(user, q1("SELECT * FROM channels WHERE id=?", channelId)!);
        broadcastChannelMeta(channelId);
        return json(res, 200, { channel });
      }
    }
    const worldFile = p.match(/^\/api\/channels\/(\d+)\/files\/content$/);
    if (worldFile && m === "GET") {
      const channelId = Number(worldFile[1]);
      if (!canSee(user, channelId)) return json(res, 403, { error: "No access" });
      try {
        const file = resolveWorldFile(channelId, url.searchParams.get("path") || "");
        res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.split("/").pop() || "file")}`, ...SECURITY_HEADERS });
        return res.end(await readFile(file));
      } catch (error) { return json(res, 404, { error: (error as Error).message }); }
    }
    const memoryItem = p.match(/^\/api\/memory\/(\d+)$/);
    if (memoryItem && m === "DELETE") {
      const item = q1("SELECT channel_id FROM memory_items WHERE id=?", Number(memoryItem[1]));
      if (!item || !canSee(user, Number(item.channel_id))) return json(res, 404, { error: "Not found" });
      run("UPDATE memory_items SET status='superseded' WHERE id=?", Number(memoryItem[1]));
      return json(res, 200, { ok: true });
    }
    const threadState = p.match(/^\/api\/threads\/(\d+)$/);
    if (threadState && m === "PATCH") {
      const thread = q1("SELECT * FROM threads WHERE id=?", Number(threadState[1]));
      if (!thread || !canSee(user, Number(thread.channel_id))) return json(res, 404, { error: "Not found" });
      const b = await jbody(req);
      if (b.status && !["open", "waiting", "resolved", "failed", "archived"].includes(String(b.status))) return json(res, 400, { error: "Invalid thread status." });
      if (b.status) run("UPDATE threads SET status=?, updated_at=? WHERE id=?", String(b.status), now(), thread.id);
      if (b.status && ["resolved", "archived"].includes(String(b.status))) {
        run("UPDATE thread_agent_guests SET status='removed' WHERE thread_id=?", thread.id);
        const resident = agentForChannel(Number(thread.channel_id)); if (resident) scheduleAgentReview(Number(resident.id));
      }
      if (b.summary != null) run("UPDATE threads SET summary=?, updated_at=? WHERE id=?", String(b.summary).slice(0, 10000), now(), thread.id);
      return json(res, 200, { thread: q1("SELECT * FROM threads WHERE id=?", thread.id) });
    }
    if (p === "/api/dm" && m === "POST") {
      const b = await jbody(req);
      const otherId = Number(b.userId);
      const existing = q1(`SELECT c.id FROM channels c JOIN members m1 ON m1.channel_id=c.id AND m1.user_id=?
                           JOIN members m2 ON m2.channel_id=c.id AND m2.user_id=? WHERE c.kind='dm'`, user.id, otherId);
      let id = existing ? Number(existing.id) : 0;
      if (!id) {
        id = run("INSERT INTO channels (name, kind, created_by, created) VALUES ('dm','dm',?,?)", user.id, now()).lastInsertRowid;
        run("INSERT INTO members (channel_id, user_id) VALUES (?,?)", id, user.id);
        if (otherId !== Number(user.id)) run("INSERT INTO members (channel_id, user_id) VALUES (?,?)", id, otherId);
      }
      return json(res, 200, { channel: channelView(user, q1("SELECT * FROM channels WHERE id=?", id)!) });
    }

    let mm: RegExpMatchArray | null;
    // Captain "Check now": zero countdown + fire the same durable wake as the timer.
    if ((mm = p.match(/^\/api\/threads\/(\d+)\/check-now$/)) && m === "POST") {
      const thread = q1("SELECT * FROM threads WHERE id=?", Number(mm[1]));
      if (!thread || !canSee(user, Number(thread.channel_id))) return json(res, 404, { error: "Not found" });
      const channel = q1("SELECT status FROM channels WHERE id=?", Number(thread.channel_id));
      if (!channel || channel.status !== "active") return json(res, 409, { error: "Channel is not active." });
      const result = bumpThreadFollowup(Number(thread.id));
      if (!result.ok) return json(res, 409, { error: result.error });
      return json(res, 200, {
        ok: true,
        followup_id: result.followup_id,
        due_at: result.due_at,
        followup: threadFollowupView(Number(thread.id)),
        thread: { ...thread, followup: threadFollowupView(Number(thread.id)) },
      });
    }
    // Lightweight mark-read so live viewing + Threads/sidebar stay aligned without a full message fetch.
    if ((mm = p.match(/^\/api\/channels\/(\d+)\/read$/)) && m === "POST") {
      const cid = Number(mm[1]);
      if (!canSee(user, cid)) return json(res, 403, { error: "No access" });
      // Never advance past an in-flight Working placeholder — that ate finished agent turns.
      const maxId = maxSettledMessageId(cid);
      run("INSERT INTO members (channel_id, user_id, last_read) VALUES (?,?,?) ON CONFLICT(channel_id,user_id) DO UPDATE SET last_read=excluded.last_read",
        cid, user.id, maxId);
      return json(res, 200, { ok: true, last_read: maxId });
    }
    if ((mm = p.match(/^\/api\/channels\/(\d+)\/messages$/))) {
      const cid = Number(mm[1]);
      if (!canSee(user, cid)) return json(res, 403, { error: "No access" });
      if (m === "GET") {
        run("INSERT INTO members (channel_id, user_id, last_read) VALUES (?,?,?) ON CONFLICT(channel_id,user_id) DO UPDATE SET last_read=excluded.last_read",
          cid, user.id, maxSettledMessageId(cid));
        const rows = q("SELECT id FROM messages WHERE channel_id=? AND parent_id IS NULL ORDER BY id DESC LIMIT 100", cid).reverse();
        return json(res, 200, { messages: rows.map((r) => serializeMessage(Number(r.id))), bots: botsInChannel(cid).map(botView), agent: agentViewForChannel(cid) });
      }
      if (m === "POST") {
        const b = await jbody(req);
        try { return json(res, 200, { message: postMessage(cid, user, String(b.body || ""), b.parentId ? Number(b.parentId) : null, (b.uploads as never[]) || [], b.modelPolicy as never) }); }
        catch (error) { return json(res, 409, { error: (error as Error).message }); }
      }
    }
    if ((mm = p.match(/^\/api\/messages\/(\d+)\/thread$/)) && m === "GET") {
      const root = q1("SELECT * FROM messages WHERE id=?", Number(mm[1]));
      if (!root || !canSee(user, Number(root.channel_id))) return json(res, 404, { error: "Not found" });
      const replies = q("SELECT id FROM messages WHERE parent_id=? ORDER BY id", root.id);
      const threadId = threadIdForRoot(Number(root.id), Number(root.channel_id)) ?? ensureThread(Number(root.id), Number(root.channel_id));
      const thread = q1("SELECT * FROM threads WHERE id=?", threadId);
      return json(res, 200, {
        root: serializeMessage(Number(root.id)),
        replies: replies.map((r) => serializeMessage(Number(r.id))).filter(Boolean),
        thread,
        usage: {
          input_tokens: Math.max(0, Number(thread?.input_tokens || 0)),
          output_tokens: Math.max(0, Number(thread?.output_tokens || 0)),
        },
      });
    }
    if ((mm = p.match(/^\/api\/messages\/(\d+)\/model-policy$/))) {
      const root = q1("SELECT * FROM messages WHERE id=? AND parent_id IS NULL", Number(mm[1]));
      if (!root || !canSee(user, Number(root.channel_id))) return json(res, 404, { error: "Not found" });
      const agent = agentForChannel(Number(root.channel_id));
      if (!agent?.bot_id) return json(res, 404, { error: "Resident agent not found" });
      if (m === "GET") return json(res, 200, { policy: resolvedModelPolicy(Number(agent.bot_id), Number(root.channel_id), Number(root.id)) });
      if (m === "POST") {
        if (agent.kind === "skipper") return json(res, 409, { error: "Skipper always uses the workspace-wide model policy." });
        const b = await jbody(req);
        const providerId = b.provider_id ? Number(b.provider_id) : null;
        if (providerId && !q1("SELECT 1 FROM providers WHERE id=?", providerId)) return json(res, 400, { error: "Provider not found" });
        setModelPolicy(Number(agent.bot_id), "thread", String(root.id), providerId, b.model ? String(b.model) : null);
        return json(res, 200, { policy: resolvedModelPolicy(Number(agent.bot_id), Number(root.channel_id), Number(root.id)) });
      }
    }
    if ((mm = p.match(/^\/api\/messages\/(\d+)\/mention-confirmation$/)) && m === "POST") {
      const message = q1("SELECT * FROM messages WHERE id=? AND user_id=? AND parent_id IS NOT NULL", Number(mm[1]), user.id);
      if (!message || !canSee(user, Number(message.channel_id))) return json(res, 404, { error: "Not found" });
      const b = await jbody(req);
      const threadId = threadIdForRoot(Number(message.parent_id), Number(message.channel_id)) ?? ensureThread(Number(message.parent_id), Number(message.channel_id));
      if (!b.confirm) {
        run(`INSERT INTO thread_mention_preferences (thread_id,user_id,muted,updated) VALUES (?,?,1,?)
          ON CONFLICT(thread_id,user_id) DO UPDATE SET muted=1,updated=excluded.updated`, threadId, user.id, now());
        return json(res, 200, { ok: true, muted: true });
      }
      const bot = q1("SELECT * FROM bots WHERE id=?", Number(b.botId));
      if (!bot) return json(res, 404, { error: "Agent not found" });
      const revised = `@${bot.name} ${String(message.body)}`.trim();
      run("UPDATE messages SET body=? WHERE id=?", revised, message.id);
      const updated = serializeMessage(Number(message.id))!;
      broadcastToChannel(Number(message.channel_id), { type: "message_update", message: updated });
      triggerBots(Number(message.channel_id), updated, Number(user.id));
      return json(res, 200, { ok: true, message: updated });
    }
    if ((mm = p.match(/^\/api\/messages\/(\d+)$/)) && m === "DELETE") {
      const existing = q1("SELECT channel_id FROM messages WHERE id=?", Number(mm[1]));
      if (!existing || !canSee(user, Number(existing.channel_id))) return json(res, 404, { error: "Not found" });
      try {
        const result = deleteMessage(Number(mm[1]), Number(user.id), !!user.is_admin);
        broadcastToChannel(result.channel_id, {
          type: "message_deleted",
          messageId: result.id,
          channelId: result.channel_id,
          parentId: result.parent_id,
          deletedIds: result.deleted_ids,
          parent: result.parent,
        });
        return json(res, 200, { ok: true, ...result });
      } catch (error) {
        const status = (error as Error & { status?: number }).status || 400;
        return json(res, status, { error: (error as Error).message });
      }
    }

    // uploads
    if (p === "/api/upload" && m === "POST") {
      const token = randomBytes(20).toString("hex");
      const contents = await body(req, UPLOAD_BODY_LIMIT);
      await writeFile(join(UPLOAD_DIR, token), contents);
      return json(res, 200, { token, name: String(req.headers["x-filename"] || "file"), mime: String(req.headers["content-type"] || "application/octet-stream"), size: contents.length });
    }
    if ((mm = p.match(/^\/api\/files\/(\d+)$/)) && m === "GET") {
      const a = q1("SELECT at.*, m.channel_id FROM attachments at JOIN messages m ON m.id=at.message_id WHERE at.id=?", Number(mm[1]));
      if (!a || !canSee(user, Number(a.channel_id))) return json(res, 404, { error: "Not found" });
      const mime = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/i.test(String(a.mime)) ? String(a.mime) : "application/octet-stream";
      const disposition = /^(image\/|application\/pdf)/.test(mime) ? "inline" : "attachment";
      res.writeHead(200, { "content-type": mime, "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(String(a.name))}`, ...SECURITY_HEADERS });
      return res.end(await readFile(join(UPLOAD_DIR, String(a.path))));
    }

    // providers (reusable, bot-agnostic connections)
    if (p === "/api/providers" && m === "GET") return json(res, 200, { providers: q("SELECT * FROM providers WHERE kind='routing' ORDER BY name").map(providerView) });
    if (p === "/api/providers/fetch-models" && m === "POST") {
      const b = await jbody(req);
      const prov = b.providerId ? q1("SELECT * FROM providers WHERE id=?", b.providerId) : undefined;
      if (prov && String(prov.kind) === CHATGPT_KIND) {
        try { return json(res, 200, { models: await listChatGPTModels() }); }
        catch (e) { return json(res, 502, { error: (e as Error).message }); }
      }
      if (prov && String(prov.kind) === "routing") {
        return json(res, 200, { models: (await routingModels()).map((model) => model.id) });
      }
      const base = prov ? String(prov.base_url || "") : String(b.base_url || "");
      const key = prov ? String(prov.api_key || "") : String(b.api_key || "");
      try { return json(res, 200, { models: await fetchModels(base, key) }); }
      catch (e) { return json(res, 502, { error: (e as Error).message }); }
    }
    if ((mm = p.match(/^\/api\/providers\/(\d+)\/models$/)) && m === "GET") {
      const prov = q1("SELECT * FROM providers WHERE id=?", Number(mm[1]));
      if (!prov) return json(res, 404, { error: "Not found" });
      try {
        if (String(prov.kind) === "routing") return json(res, 200, { models: (await routingModels()).map((model) => model.id) });
        if (String(prov.kind) === CHATGPT_KIND) return json(res, 200, { models: await listChatGPTModels() });
        return json(res, 200, { models: await fetchModels(String(prov.base_url), String(prov.api_key)) });
      }
      catch (e) { return json(res, 502, { error: (e as Error).message }); }
    }
    if (p === "/api/providers" && m === "POST") {
      if (!user.is_admin) return json(res, 403, { error: "Admin only" });
      const b = await jbody(req);
      const baseUrl = String(b.base_url || "").trim();
      const apiKey = String(b.api_key || "");
      const tested = await routingInvoke("app:test-keyed-provider", { baseUrl, apiKey, providerType: "openai-compat" });
      if (tested.ok === false) return json(res, 502, { error: String(tested.error || "Provider test failed") });
      const added = await routingInvoke("app:add-keyed-provider", {
        name: String(b.name || "Provider").trim(), baseUrl, apiKey, models: tested.models || [],
      });
      if (added.ok === false) return json(res, 400, { error: String(added.error || "Could not add provider") });
      const id = await internalRoutingProviderId();
      const provider = providerView(q1("SELECT * FROM providers WHERE id=?", id)!);
      const routing = await routingState() as {
        providers?: Array<{ id?: string; models?: Array<{ gatewayId?: string; id?: string; name?: string; enabled?: boolean }> }>;
      };
      const source = (routing.providers || []).find((item) => item.id === added.id);
      const models = (source?.models || [])
        .filter((model) => model.enabled !== false)
        .map((model) => ({ id: String(model.gatewayId || model.id || ""), name: String(model.name || model.id || "") }))
        .filter((model) => model.id);
      broadcastAll({ type: "routing_changed", action: "provider_added" });
      return json(res, 200, { provider, models });
    }
    if ((mm = p.match(/^\/api\/providers\/(\d+)$/)) && (m === "PATCH" || m === "DELETE")) {
      if (!user.is_admin) return json(res, 403, { error: "Admin only" });
      const id = Number(mm[1]);
      if (m === "DELETE") {
        const inUse = Number(q1("SELECT COUNT(*) n FROM bots WHERE provider_id=?", id)?.n || 0);
        if (inUse) return json(res, 409, { error: `In use by ${inUse} bot(s). Reassign them first.` });
        run("DELETE FROM providers WHERE id=?", id);
        broadcastAll({ type: "provider_deleted", providerId: id });
        return json(res, 200, { ok: true });
      }
      const b = await jbody(req);
      for (const f of ["name", "base_url", "kind"]) if (f in b) run(`UPDATE providers SET ${f}=? WHERE id=?`, String(b[f] ?? ""), id);
      if (b.api_key) run("UPDATE providers SET api_key=? WHERE id=?", String(b.api_key), id);
      const provider = providerView(q1("SELECT * FROM providers WHERE id=?", id)!);
      broadcastAll({ type: "provider_update", provider });
      return json(res, 200, { provider });
    }
    // OpenRouter OAuth (PKCE): exchange the returned code for a user-controlled key → a provider
    if (p === "/api/oauth/openrouter/exchange" && m === "POST") {
      if (!user.is_admin) return json(res, 403, { error: "Admin only" });
      const b = await jbody(req);
      try {
        const r = await fetch("https://openrouter.ai/api/v1/auth/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: b.code, code_verifier: b.code_verifier, code_challenge_method: "S256" }) });
        if (!r.ok) return json(res, 502, { error: `OpenRouter exchange failed (${r.status}): ${(await r.text()).slice(0, 200)}` });
        const key = (await r.json() as { key?: string }).key;
        if (!key) return json(res, 502, { error: "No key returned by OpenRouter" });
        const tested = await routingInvoke("app:test-keyed-provider", { baseUrl: "https://openrouter.ai/api/v1", apiKey: key, providerType: "openrouter" });
        if (tested.ok === false) return json(res, 502, { error: String(tested.error || "OpenRouter model discovery failed") });
        const added = await routingInvoke("app:add-keyed-provider", { preset: "openrouter", name: String(b.name || "OpenRouter").trim(), apiKey: key, models: tested.models || [] });
        if (added.ok === false) return json(res, 400, { error: String(added.error || "Could not save OpenRouter") });
        const id = await internalRoutingProviderId();
        const provider = providerView(q1("SELECT * FROM providers WHERE id=?", id)!);
        broadcastAll({ type: "routing_changed", action: "openrouter_connected" });
        return json(res, 200, { provider });
      } catch (e) { return json(res, 502, { error: (e as Error).message }); }
    }

    // bots
    if (p === "/api/bots" && m === "GET") return json(res, 200, { bots: q("SELECT * FROM bots ORDER BY name").map(botView) });
    if ((mm = p.match(/^\/api\/bots\/(\d+)\/models$/)) && m === "GET") {
      const bot = q1("SELECT * FROM bots WHERE id=?", Number(mm[1]));
      if (!bot) return json(res, 404, { error: "Not found" });
      const prov = bot.provider_id ? q1("SELECT * FROM providers WHERE id=?", bot.provider_id) : undefined;
      try {
        if (prov && String(prov.kind) === CHATGPT_KIND) return json(res, 200, { models: await listChatGPTModels() });
        const ep = botEndpoint(Number(mm[1]));
        if (!ep) return json(res, 404, { error: "No provider connected" });
        return json(res, 200, { models: await fetchModels(ep.base_url, ep.api_key) });
      } catch (e) { return json(res, 502, { error: (e as Error).message }); }
    }
    if (p === "/api/bots" && m === "POST") {
      if (!user.is_admin) return json(res, 403, { error: "Admin only" });
      const b = await jbody(req);
      // base_url/api_key are legacy columns (pre-provider bots); older DBs have them NOT NULL without a default.
      const id = run("INSERT INTO bots (name, provider_id, model, prompt, avatar, base_url, api_key, created) VALUES (?,?,?,?,?,'','',?)",
        String(b.name || "bot").trim(), b.provider_id ? Number(b.provider_id) : null, String(b.model || ""), String(b.prompt || ""), String(b.avatar || ""), now()).lastInsertRowid;
      if (Array.isArray(b.computers)) setBotComputers(id, b.computers as unknown[]);
      const bot = botView(q1("SELECT * FROM bots WHERE id=?", id)!);
      broadcastAll({ type: "bot_update", bot });
      return json(res, 200, { bot });
    }
    if ((mm = p.match(/^\/api\/bots\/(\d+)$/)) && (m === "PATCH" || m === "DELETE")) {
      if (!user.is_admin) return json(res, 403, { error: "Admin only" });
      const id = Number(mm[1]);
      if (m === "DELETE") {
        if (q1("SELECT 1 FROM agents WHERE bot_id=? AND status<>'deleted'", id)) return json(res, 409, { error: "Resident agents are removed through their channel lifecycle." });
        run("DELETE FROM bot_channels WHERE bot_id=?", id); run("DELETE FROM bot_computers WHERE bot_id=?", id); run("DELETE FROM model_prefs WHERE bot_id=?", id); run("DELETE FROM bots WHERE id=?", id);
        broadcastAll({ type: "bot_deleted", botId: id });
        return json(res, 200, { ok: true });
      }
      const b = await jbody(req);
      for (const f of ["name", "model", "prompt", "avatar"]) if (f in b) run(`UPDATE bots SET ${f}=? WHERE id=?`, String(b[f] ?? ""), id);
      if ("provider_id" in b) run("UPDATE bots SET provider_id=? WHERE id=?", b.provider_id ? Number(b.provider_id) : null, id);
      if (Array.isArray(b.computers)) setBotComputers(id, b.computers as unknown[]);
      const bot = botView(q1("SELECT * FROM bots WHERE id=?", id)!);
      broadcastAll({ type: "bot_update", bot });
      // Resident channel header/agent faces should update live when the shadow bot changes.
      const resident = agentForBot(id);
      if (resident?.kind === "channel") {
        const bound = q1("SELECT channel_id FROM agent_channels WHERE agent_id=?", resident.id);
        if (bound?.channel_id) broadcastChannelMeta(Number(bound.channel_id));
      }
      return json(res, 200, { bot });
    }
    if ((mm = p.match(/^\/api\/bots\/(\d+)\/join$/)) && m === "POST") {
      if (!user.is_admin) return json(res, 403, { error: "Captain/admin only" });
      const b = await jbody(req);
      const botId = Number(mm[1]); const cid = Number(b.channelId);
      if (!canSee(user, cid)) return json(res, 403, { error: "No access" });
      if (q1("SELECT 1 FROM channels WHERE id=? AND kind='channel'", cid)) return json(res, 409, { error: "Native channels contain only Skipper and their one resident agent. Invite another resident through Skipper for one thread instead." });
      const targetAgent = agentForBot(botId);
      if (targetAgent?.kind === "channel") return json(res, 409, { error: "Resident agents are created by channel provisioning, not joined manually." });
      try { addBotToChannel(botId, cid); }
      catch (error) { return json(res, 409, { error: (error as Error).message }); }
      const bot = q1("SELECT * FROM bots WHERE id=?", botId);
      broadcastToChannel(cid, { type: "channel_bots", bots: botsInChannel(cid).map(botView) });
      if (bot && b.triggerId) void runBot(bot, cid, Number(b.triggerId), Number(b.threadRootId), Boolean(b.fresh));
      return json(res, 200, { ok: true });
    }
    if (p === "/api/model-pref" && m === "POST") {
      if (!user.is_admin) return json(res, 403, { error: "Captain/admin only" });
      const b = await jbody(req);
      setModelPref(Number(b.botId), String(b.scope), String(b.scopeId ?? ""), b.model ? String(b.model) : null);
      return json(res, 200, { bot: botView(q1("SELECT * FROM bots WHERE id=?", b.botId)!) });
    }

    // computers
    if (p === "/api/computers" && m === "GET") return json(res, 200, { computers: q("SELECT * FROM computers ORDER BY id").map(computerRowView) });
    if (p === "/api/computers" && m === "POST") {
      if (!user.is_admin) return json(res, 403, { error: "Admin only" });
      const b = await jbody(req);
      const id = run("INSERT INTO computers (name, base_url, api_key, created) VALUES (?,?,?,?)", String(b.name || "computer").trim(), String(b.base_url || ""), String(b.api_key || ""), now()).lastInsertRowid;
      const skipper = q1("SELECT bot_id FROM agents WHERE kind='skipper' AND status<>'deleted' LIMIT 1");
      if (skipper?.bot_id) run("INSERT OR IGNORE INTO bot_computers (bot_id, computer_id) VALUES (?,?)", skipper.bot_id, id);
      const computer = computerRowView(q1("SELECT * FROM computers WHERE id=?", id)!);
      broadcastAll({ type: "computer_update", computer });
      return json(res, 200, { computer });
    }
    if ((mm = p.match(/^\/api\/computers\/(\d+)$/)) && (m === "PATCH" || m === "DELETE")) {
      if (!user.is_admin) return json(res, 403, { error: "Admin only" });
      const id = Number(mm[1]);
      if (m === "DELETE") {
        run("DELETE FROM computers WHERE id=?", id); run("DELETE FROM bot_computers WHERE computer_id=?", id);
        broadcastAll({ type: "computer_deleted", computerId: id });
        return json(res, 200, { ok: true });
      }
      const b = await jbody(req);
      for (const f of ["name", "base_url", "api_key"]) if (f in b) run(`UPDATE computers SET ${f}=? WHERE id=?`, String(b[f] ?? ""), id);
      const computer = computerRowView(q1("SELECT * FROM computers WHERE id=?", id)!);
      broadcastAll({ type: "computer_update", computer });
      return json(res, 200, { computer });
    }

    // Channel terminals always start in the selected channel's workspace.
    if (p === "/api/term/open" && m === "POST") {
      if (!workspaceView().terminals_enabled) return json(res, 403, { error: "Terminals are disabled for this workspace." });
      const b = await jbody(req);
      const channelId = Number(b.channelId);
      if (!channelId || !canSee(user, channelId)) return json(res, 403, { error: "No channel access" });
      const channel = q1("SELECT status FROM channels WHERE id=?", channelId);
      if (!channel || channel.status !== "active") return json(res, 409, { error: "Restore the channel before opening a terminal." });
      const requestedComputerId = b.computerId != null ? Number(b.computerId) : 0;
      const computer = requestedComputerId
        ? q1("SELECT id, name FROM computers WHERE id=?", requestedComputerId)
        : q1("SELECT id, name FROM computers WHERE name='This Computer' ORDER BY id LIMIT 1")
          || q1("SELECT id, name FROM computers ORDER BY id LIMIT 1");
      if (!computer) return json(res, 503, { error: "Local computer is not ready." });
      try {
        // Host computer stays rooted in the channel workspace; remotes open at their default shell cwd.
        const isHost = String(computer.name) === "This Computer";
        if (isHost) ensureChannelWorkspace(channelId);
        const cwd = isHost ? channelWorkspace(channelId) : undefined;
        const sessionId = await openSession(Number(computer.id), channelId, Number(user.id), cwd || "", Number(b.cols) || 80, Number(b.rows) || 24);
        if (!q1("SELECT 1 FROM channels WHERE id=? AND status='active'", channelId)) { closeSession(sessionId); return json(res, 409, { error: "Channel was archived while the terminal opened." }); }
        return json(res, 200, { sessionId, computerId: Number(computer.id) });
      } catch (e) { return json(res, 502, { error: (e as Error).message }); }
    }
    if (p === "/api/term/list" && m === "GET") return json(res, 200, { sessions: listSessions(Number(user.id), url.searchParams.get("channelId") ? Number(url.searchParams.get("channelId")) : undefined) });
    const termClose = p.match(/^\/api\/term\/([^/]+)$/);
    if (termClose && m === "DELETE") {
      if (!listSessions(Number(user.id)).some((session) => session.id === termClose[1])) return json(res, 404, { error: "Session not found" });
      closeSession(termClose[1]); return json(res, 200, { ok: true });
    }

    // admin
    if (p === "/api/admin/users" && m === "POST") {
      if (!user.is_admin) return json(res, 403, { error: "Captain/admin only" });
      const b = await jbody(req);
      const username = String(b.username || "").trim().toLowerCase();
      const password = String(b.password || "");
      const display = String(b.display || b.username || "").trim() || username;
      if (!/^[a-z0-9_.-]{2,32}$/.test(username) || password.length < 8) return json(res, 400, { error: "Use a valid username and a temporary password of at least 8 characters." });
      if (q1("SELECT 1 FROM users WHERE username=?", username)) return json(res, 409, { error: "Username taken." });
      const id = run("INSERT INTO users (username, pass, display, is_admin, created) VALUES (?,?,?,?,?)", username, hashPassword(password), display, b.is_admin ? 1 : 0, now()).lastInsertRowid;
      for (const channel of q("SELECT id FROM channels WHERE kind='channel' AND status<>'deleted'")) run("INSERT OR IGNORE INTO members (channel_id, user_id) VALUES (?,?)", channel.id, id);
      const created = publicUser(q1("SELECT * FROM users WHERE id=?", id)!);
      broadcastAll({ type: "user_update", user: created });
      return json(res, 201, { user: created });
    }
    if ((mm = p.match(/^\/api\/admin\/users\/(\d+)$/)) && (m === "PATCH" || m === "DELETE")) {
      if (!user.is_admin) return json(res, 403, { error: "Admin only" });
      const id = Number(mm[1]);
      if (m === "DELETE") {
        if (id === Number(user.id)) return json(res, 400, { error: "Cannot delete yourself" });
        run("DELETE FROM users WHERE id=?", id); run("DELETE FROM sessions WHERE user_id=?", id);
        broadcastAll({ type: "user_deleted", userId: id });
        return json(res, 200, { ok: true });
      }
      const b = await jbody(req);
      if ("is_admin" in b) run("UPDATE users SET is_admin=? WHERE id=?", b.is_admin ? 1 : 0, id);
      const updated = publicUser(q1("SELECT * FROM users WHERE id=?", id)!);
      broadcastAll({ type: "user_update", user: updated });
      return json(res, 200, { user: updated });
    }

    return json(res, 404, { error: "Not found" });
  } catch (e) {
    json(res, (e as Error).name === "PayloadTooLargeError" ? 413 : 500, { error: (e as Error).message });
  }
});

// ---- WebSockets: /ws (app events) and /ws/term/:sid (terminal proxy) ----
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket: Socket, head) => {
  const url = new URL(req.url || "/", "http://localhost");
  const user = userFromToken(url.searchParams.get("token"));
  if (!user) { socket.destroy(); return; }
  const termMatch = url.pathname.match(/^\/ws\/term\/([^/]+)$/);
  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    if (termMatch) { void attachClient(termMatch[1], ws, Number(user.id)); return; }
    const client = register(ws, Number(user.id));
    ws.on("close", () => unregister(client));
    ws.on("message", () => { /* clients act via REST; WS is push-only */ });
    ws.send(JSON.stringify({ type: "hello" }));
  });
});

// ---- embedded local computer (open-terminal compatible) ----
async function bootstrap(): Promise<void> {
  prepareMnemosyneRuntime();
  await startRoutingEngine(() => broadcastAll({ type: "routing_activity" }));
  await internalRoutingProviderId();
  const agentKey = newToken();
  const agentPort = await startAgent(0, agentKey);
  const url = `http://127.0.0.1:${agentPort}`;
  const existing = q1("SELECT id FROM computers WHERE name='This Computer'");
  const computerId = existing
    ? (run("UPDATE computers SET base_url=?, api_key=? WHERE id=?", url, agentKey, existing.id), Number(existing.id))
    : run("INSERT INTO computers (name, base_url, api_key, created) VALUES ('This Computer',?,?,?)", url, agentKey, now()).lastInsertRowid;
  for (const agent of q("SELECT bot_id FROM agents WHERE status<>'deleted' AND bot_id IS NOT NULL")) run("INSERT OR IGNORE INTO bot_computers (bot_id, computer_id) VALUES (?,?)", agent.bot_id, computerId);
  for (const channel of q("SELECT id FROM channels WHERE kind='channel' AND status<>'deleted'")) {
    ensureChannelWorkspace(Number(channel.id));
    const agent = agentForChannel(Number(channel.id)); if (agent) ensureAgentMemory(agent);
  }
  startImprovementLoop();
  startThreadAuditLoop();
  startFollowupLoop();
  server.listen(PORT, () => console.log(`1Helm on 1Helm → http://localhost:${PORT}  (local agent on ${agentPort})  data: ${DATA_DIR}`));
}
void bootstrap();

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  await stopRoutingEngine().catch(() => undefined);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 12_000).unref();
};
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
