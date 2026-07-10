import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { db, q, q1, run, now, hashPassword, verifyPassword, newToken, seed, DATA_DIR, UPLOAD_DIR, type Row } from "./db.ts";
import { createMessage, serializeMessage, setModelPref, botView, providerView, botEndpoint, botsInChannel, botIsInChannel, addBotToChannel, findMentionedBots } from "./store.ts";
import { computerRowView, fetchModels } from "./computer.ts";
import { runBot } from "./bots.ts";
import { register, unregister, broadcastToChannel, sendToUsers } from "./events.ts";
import { openSession, attachClient, listSessions } from "./terms.ts";
import { startAgent } from "./agent.ts";
import { CHATGPT_KIND, bindChatGPTProviderFromCookie, chatgptSessionStatus, chatgptWebResponse, disconnectChatGPTProvider, listChatGPTModels, writeChatGPTWebResponse } from "./chatgpt.ts";

const PORT = Number(process.env.PORT || 8123);
const PUBLIC = join(process.cwd(), "public");
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };

seed();

// ---- helpers ----
// TLS is terminated by the deployment's reverse proxy. Do not advertise an
// HTTPS-only policy here: local and first-run HTTP deployments must still load
// their relative JS and CSS assets.
const SECURITY_HEADERS: Record<string, string> = {};
const json = (res: ServerResponse, code: number, body: unknown): void => {
  const s = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", ...SECURITY_HEADERS });
  res.end(s);
};
const body = (req: IncomingMessage): Promise<Buffer> => new Promise((resolve) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => resolve(Buffer.concat(chunks)));
});
const jbody = async (req: IncomingMessage): Promise<Record<string, unknown>> => { try { return JSON.parse((await body(req)).toString() || "{}"); } catch { return {}; } };

const userFromToken = (token: string | null): Row | undefined => {
  if (!token) return undefined;
  const s = q1("SELECT user_id FROM sessions WHERE token=?", token);
  return s ? q1("SELECT * FROM users WHERE id=?", s.user_id) : undefined;
};
const authUser = (req: IncomingMessage): Row | undefined => {
  const h = req.headers["authorization"];
  return userFromToken(h && h.startsWith("Bearer ") ? h.slice(7) : null);
};

const canSee = (user: Row, channelId: number): boolean => {
  const ch = q1("SELECT kind FROM channels WHERE id=?", channelId);
  if (!ch) return false;
  if (ch.kind === "channel") return true;
  return !!q1("SELECT 1 FROM members WHERE channel_id=? AND user_id=?", channelId, user.id);
};

const publicUser = (r: Row): Record<string, unknown> => ({ id: r.id, username: r.username, display: r.display, is_admin: Boolean(r.is_admin) });

function channelView(user: Row, c: Row): Record<string, unknown> {
  let name = c.name as string;
  if (c.kind === "dm") {
    const other = q1("SELECT u.* FROM members m JOIN users u ON u.id=m.user_id WHERE m.channel_id=? AND m.user_id<>?", c.id, user.id);
    name = other ? (other.display as string) : "Direct message";
  }
  const lastRead = Number(q1("SELECT last_read FROM members WHERE channel_id=? AND user_id=?", c.id, user.id)?.last_read || 0);
  const unread = Number(q1("SELECT COUNT(*) n FROM messages WHERE channel_id=? AND parent_id IS NULL AND id>? AND (user_id IS NULL OR user_id<>?)", c.id, lastRead, user.id)?.n || 0);
  return { id: c.id, name, kind: c.kind, topic: c.topic, unread };
}

function visibleChannels(user: Row): Row[] {
  return q(`SELECT * FROM channels WHERE kind='channel'
            UNION SELECT c.* FROM channels c JOIN members m ON m.channel_id=c.id WHERE m.user_id=? AND c.kind<>'channel'
            ORDER BY kind, name`, user.id);
}

/** Fire bots mentioned in a freshly posted message (or prompt the author to add them). */
function triggerBots(channelId: number, msg: Row, authorId: number): void {
  const fresh = msg.parent_id == null;
  const threadRootId = Number(msg.parent_id ?? msg.id);
  for (const bot of findMentionedBots(String(msg.body))) {
    if (botIsInChannel(Number(bot.id), channelId)) void runBot(bot, channelId, Number(msg.id), threadRootId, fresh);
    else sendToUsers([authorId], { type: "bot_prompt", botId: bot.id, botName: bot.name, channelId, triggerId: msg.id, threadRootId, fresh });
  }
}

function setBotComputers(botId: number, computerIds: unknown[]): void {
  run("DELETE FROM bot_computers WHERE bot_id=?", botId);
  for (const c of computerIds) {
    const cid = Number(c);
    if (cid && q1("SELECT 1 FROM computers WHERE id=?", cid)) run("INSERT OR IGNORE INTO bot_computers (bot_id, computer_id) VALUES (?,?)", botId, cid);
  }
}

function postMessage(channelId: number, user: Row, text: string, parentId: number | null, uploads: { token: string; name: string; mime: string; size: number }[]): Row {
  const id = createMessage({ channelId, parentId, userId: Number(user.id), body: text });
  for (const u of uploads || []) {
    if (!/^[a-f0-9]{32,}$/.test(u.token) || !existsSync(join(UPLOAD_DIR, u.token))) continue;
    run("INSERT INTO attachments (message_id, name, mime, size, path) VALUES (?,?,?,?,?)", id, u.name, u.mime, u.size, u.token);
  }
  const msg = serializeMessage(id)!;
  broadcastToChannel(channelId, { type: "message", message: msg });
  triggerBots(channelId, msg, Number(user.id));
  return msg;
}

// ---- HTTP routing ----
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://localhost`);
    const p = url.pathname;
    const m = req.method || "GET";

    // static
    if (m === "GET" && !p.startsWith("/api/")) {
      const rel = p === "/" ? "/index.html" : p;
      const file = join(PUBLIC, rel);
      if (file.startsWith(PUBLIC) && existsSync(file)) {
        const ct = MIME[extname(file)] || "application/octet-stream";
        // index.html: always revalidate so a freshly built bundle.js?v=... is picked up.
        // versioned assets (bundle.js?..., app.css?...): cached hard for a year.
        const isHtml = rel === "/index.html" || extname(file) === ".html";
        const headers: Record<string, string> = { "content-type": ct, ...SECURITY_HEADERS };
        if (isHtml) headers["cache-control"] = "no-cache, must-revalidate";
        else headers["cache-control"] = "public, max-age=31536000, immutable";
        res.writeHead(200, headers);
        res.end(await readFile(file));
        return;
      }
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-cache, must-revalidate", ...SECURITY_HEADERS });
      res.end(await readFile(join(PUBLIC, "index.html")).catch(() => "CTRL PANE (run npm run build)"));
      return;
    }

    // ---- auth (no session required) ----
    if (p === "/api/auth/register" && m === "POST") {
      const b = await jbody(req);
      const username = String(b.username || "").trim().toLowerCase();
      const password = String(b.password || "");
      const display = String(b.display || b.username || "").trim() || username;
      if (!/^[a-z0-9_.-]{2,32}$/.test(username) || password.length < 4) return json(res, 400, { error: "Invalid username or password (min 4 chars)." });
      if (q1("SELECT 1 FROM users WHERE username=?", username)) return json(res, 409, { error: "Username taken." });
      const isAdmin = q1("SELECT COUNT(*) n FROM users")!.n === 0 ? 1 : 0;
      const uid = run("INSERT INTO users (username, pass, display, is_admin, created) VALUES (?,?,?,?,?)", username, hashPassword(password), display, isAdmin, now()).lastInsertRowid;
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
        return json(res, 200, { provider: providerView(q1("SELECT * FROM providers WHERE id=?", r.providerId)!), user: r.user });
      } catch (e) { return json(res, 400, { error: (e as Error).message }); }
    }
    if (p === "/api/providers/chatgpt/disconnect" && m === "POST") {
      if (!user.is_admin) return json(res, 403, { error: "Admin only" });
      try { await disconnectChatGPTProvider(); return json(res, 200, { ok: true }); }
      catch (e) { return json(res, 502, { error: (e as Error).message }); }
    }

    if (p === "/api/me") return json(res, 200, { user: publicUser(user) });
    if (p === "/api/auth/logout" && m === "POST") {
      const h = req.headers["authorization"]; if (h?.startsWith("Bearer ")) run("DELETE FROM sessions WHERE token=?", h.slice(7));
      return json(res, 200, { ok: true });
    }
    if (p === "/api/users" && m === "GET") return json(res, 200, { users: q("SELECT * FROM users ORDER BY display").map(publicUser) });

    // channels
    if (p === "/api/channels" && m === "GET") return json(res, 200, { channels: visibleChannels(user).map((c) => channelView(user, c)) });
    if (p === "/api/channels" && m === "POST") {
      const b = await jbody(req);
      const name = String(b.name || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
      if (!name) return json(res, 400, { error: "Invalid channel name." });
      const id = run("INSERT INTO channels (name, kind, topic, created_by, created) VALUES (?, 'channel', ?, ?, ?)", name, String(b.topic || ""), user.id, now()).lastInsertRowid;
      for (const u of q("SELECT id FROM users")) run("INSERT OR IGNORE INTO members (channel_id, user_id) VALUES (?,?)", id, u.id);
      broadcastToChannel(id, { type: "channel_new" });
      return json(res, 200, { channel: channelView(user, q1("SELECT * FROM channels WHERE id=?", id)!) });
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
    if ((mm = p.match(/^\/api\/channels\/(\d+)\/messages$/))) {
      const cid = Number(mm[1]);
      if (!canSee(user, cid)) return json(res, 403, { error: "No access" });
      if (m === "GET") {
        run("INSERT INTO members (channel_id, user_id, last_read) VALUES (?,?,?) ON CONFLICT(channel_id,user_id) DO UPDATE SET last_read=excluded.last_read",
          cid, user.id, Number(q1("SELECT MAX(id) x FROM messages WHERE channel_id=?", cid)?.x || 0));
        const rows = q("SELECT id FROM messages WHERE channel_id=? AND parent_id IS NULL ORDER BY id DESC LIMIT 100", cid).reverse();
        return json(res, 200, { messages: rows.map((r) => serializeMessage(Number(r.id))), bots: botsInChannel(cid).map(botView) });
      }
      if (m === "POST") {
        const b = await jbody(req);
        return json(res, 200, { message: postMessage(cid, user, String(b.body || ""), b.parentId ? Number(b.parentId) : null, (b.uploads as never[]) || []) });
      }
    }
    if ((mm = p.match(/^\/api\/messages\/(\d+)\/thread$/)) && m === "GET") {
      const root = q1("SELECT * FROM messages WHERE id=?", Number(mm[1]));
      if (!root || !canSee(user, Number(root.channel_id))) return json(res, 404, { error: "Not found" });
      const replies = q("SELECT id FROM messages WHERE parent_id=? ORDER BY id", root.id);
      return json(res, 200, { root: serializeMessage(Number(root.id)), replies: replies.map((r) => serializeMessage(Number(r.id))) });
    }

    // uploads
    if (p === "/api/upload" && m === "POST") {
      const token = randomBytes(20).toString("hex");
      await writeFile(join(UPLOAD_DIR, token), await body(req));
      return json(res, 200, { token, name: String(req.headers["x-filename"] || "file"), mime: String(req.headers["content-type"] || "application/octet-stream") });
    }
    if ((mm = p.match(/^\/api\/files\/(\d+)$/)) && m === "GET") {
      const a = q1("SELECT * FROM attachments WHERE id=?", Number(mm[1]));
      if (!a) return json(res, 404, { error: "Not found" });
      res.writeHead(200, { "content-type": String(a.mime), "content-disposition": `inline; filename="${a.name}"`, ...SECURITY_HEADERS });
      return res.end(await readFile(join(UPLOAD_DIR, String(a.path))));
    }

    // providers (reusable, bot-agnostic connections)
    if (p === "/api/providers" && m === "GET") return json(res, 200, { providers: q("SELECT * FROM providers ORDER BY name").map(providerView) });
    if (p === "/api/providers/fetch-models" && m === "POST") {
      const b = await jbody(req);
      const prov = b.providerId ? q1("SELECT * FROM providers WHERE id=?", b.providerId) : undefined;
      if (prov && String(prov.kind) === CHATGPT_KIND) {
        try { return json(res, 200, { models: await listChatGPTModels() }); }
        catch (e) { return json(res, 502, { error: (e as Error).message }); }
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
        if (String(prov.kind) === CHATGPT_KIND) return json(res, 200, { models: await listChatGPTModels() });
        return json(res, 200, { models: await fetchModels(String(prov.base_url), String(prov.api_key)) });
      }
      catch (e) { return json(res, 502, { error: (e as Error).message }); }
    }
    if (p === "/api/providers" && m === "POST") {
      if (!user.is_admin) return json(res, 403, { error: "Admin only" });
      const b = await jbody(req);
      const id = run("INSERT INTO providers (name, base_url, api_key, kind, created) VALUES (?,?,?,?,?)",
        String(b.name || "Provider").trim(), String(b.base_url || "").trim(), String(b.api_key || ""), String(b.kind || "openai"), now()).lastInsertRowid;
      return json(res, 200, { provider: providerView(q1("SELECT * FROM providers WHERE id=?", id)!) });
    }
    if ((mm = p.match(/^\/api\/providers\/(\d+)$/)) && (m === "PATCH" || m === "DELETE")) {
      if (!user.is_admin) return json(res, 403, { error: "Admin only" });
      const id = Number(mm[1]);
      if (m === "DELETE") {
        const inUse = Number(q1("SELECT COUNT(*) n FROM bots WHERE provider_id=?", id)?.n || 0);
        if (inUse) return json(res, 409, { error: `In use by ${inUse} bot(s). Reassign them first.` });
        run("DELETE FROM providers WHERE id=?", id);
        return json(res, 200, { ok: true });
      }
      const b = await jbody(req);
      for (const f of ["name", "base_url", "kind"]) if (f in b) run(`UPDATE providers SET ${f}=? WHERE id=?`, String(b[f] ?? ""), id);
      if (b.api_key) run("UPDATE providers SET api_key=? WHERE id=?", String(b.api_key), id);
      return json(res, 200, { provider: providerView(q1("SELECT * FROM providers WHERE id=?", id)!) });
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
        const name = String(b.name || "OpenRouter").trim();
        // Re-authorizing refreshes the existing OAuth provider's key instead of stacking duplicates.
        const existing = q1("SELECT id FROM providers WHERE kind='openrouter' ORDER BY id LIMIT 1");
        const id = existing
          ? (run("UPDATE providers SET api_key=?, name=? WHERE id=?", key, name, existing.id), Number(existing.id))
          : run("INSERT INTO providers (name, base_url, api_key, kind, created) VALUES (?,?,?,?,?)", name, "https://openrouter.ai/api/v1", key, "openrouter", now()).lastInsertRowid;
        return json(res, 200, { provider: providerView(q1("SELECT * FROM providers WHERE id=?", id)!) });
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
      return json(res, 200, { bot: botView(q1("SELECT * FROM bots WHERE id=?", id)!) });
    }
    if ((mm = p.match(/^\/api\/bots\/(\d+)$/)) && (m === "PATCH" || m === "DELETE")) {
      if (!user.is_admin) return json(res, 403, { error: "Admin only" });
      const id = Number(mm[1]);
      if (m === "DELETE") { run("DELETE FROM bots WHERE id=?", id); run("DELETE FROM bot_channels WHERE bot_id=?", id); run("DELETE FROM bot_computers WHERE bot_id=?", id); run("DELETE FROM model_prefs WHERE bot_id=?", id); return json(res, 200, { ok: true }); }
      const b = await jbody(req);
      for (const f of ["name", "model", "prompt", "avatar"]) if (f in b) run(`UPDATE bots SET ${f}=? WHERE id=?`, String(b[f] ?? ""), id);
      if ("provider_id" in b) run("UPDATE bots SET provider_id=? WHERE id=?", b.provider_id ? Number(b.provider_id) : null, id);
      if (Array.isArray(b.computers)) setBotComputers(id, b.computers as unknown[]);
      return json(res, 200, { bot: botView(q1("SELECT * FROM bots WHERE id=?", id)!) });
    }
    if ((mm = p.match(/^\/api\/bots\/(\d+)\/join$/)) && m === "POST") {
      const b = await jbody(req);
      const botId = Number(mm[1]); const cid = Number(b.channelId);
      if (!canSee(user, cid)) return json(res, 403, { error: "No access" });
      addBotToChannel(botId, cid);
      const bot = q1("SELECT * FROM bots WHERE id=?", botId);
      broadcastToChannel(cid, { type: "channel_bots", bots: botsInChannel(cid).map(botView) });
      if (bot && b.triggerId) void runBot(bot, cid, Number(b.triggerId), Number(b.threadRootId), Boolean(b.fresh));
      return json(res, 200, { ok: true });
    }
    if (p === "/api/model-pref" && m === "POST") {
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
      return json(res, 200, { computer: computerRowView(q1("SELECT * FROM computers WHERE id=?", id)!) });
    }
    if ((mm = p.match(/^\/api\/computers\/(\d+)$/)) && (m === "PATCH" || m === "DELETE")) {
      if (!user.is_admin) return json(res, 403, { error: "Admin only" });
      const id = Number(mm[1]);
      if (m === "DELETE") { run("DELETE FROM computers WHERE id=?", id); run("DELETE FROM bot_computers WHERE computer_id=?", id); return json(res, 200, { ok: true }); }
      const b = await jbody(req);
      for (const f of ["name", "base_url", "api_key"]) if (f in b) run(`UPDATE computers SET ${f}=? WHERE id=?`, String(b[f] ?? ""), id);
      return json(res, 200, { computer: computerRowView(q1("SELECT * FROM computers WHERE id=?", id)!) });
    }

    // terminals
    if (p === "/api/term/open" && m === "POST") {
      const b = await jbody(req);
      try { return json(res, 200, { sessionId: await openSession(Number(b.computerId), Number(b.cols) || 80, Number(b.rows) || 24) }); }
      catch (e) { return json(res, 502, { error: (e as Error).message }); }
    }
    if (p === "/api/term/list" && m === "GET") return json(res, 200, { sessions: listSessions() });

    // admin
    if ((mm = p.match(/^\/api\/admin\/users\/(\d+)$/)) && (m === "PATCH" || m === "DELETE")) {
      if (!user.is_admin) return json(res, 403, { error: "Admin only" });
      const id = Number(mm[1]);
      if (m === "DELETE") { if (id === Number(user.id)) return json(res, 400, { error: "Cannot delete yourself" }); run("DELETE FROM users WHERE id=?", id); run("DELETE FROM sessions WHERE user_id=?", id); return json(res, 200, { ok: true }); }
      const b = await jbody(req);
      if ("is_admin" in b) run("UPDATE users SET is_admin=? WHERE id=?", b.is_admin ? 1 : 0, id);
      return json(res, 200, { user: publicUser(q1("SELECT * FROM users WHERE id=?", id)!) });
    }

    return json(res, 404, { error: "Not found" });
  } catch (e) {
    json(res, 500, { error: (e as Error).message });
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
    if (termMatch) { void attachClient(termMatch[1], ws); return; }
    const client = register(ws, Number(user.id));
    ws.on("close", () => unregister(client));
    ws.on("message", () => { /* clients act via REST; WS is push-only */ });
    ws.send(JSON.stringify({ type: "hello" }));
  });
});

// ---- embedded local computer (open-terminal compatible) ----
async function bootstrap(): Promise<void> {
  const agentKey = newToken();
  const agentPort = await startAgent(0, agentKey);
  const url = `http://127.0.0.1:${agentPort}`;
  const existing = q1("SELECT id FROM computers WHERE name='This Computer'");
  if (existing) run("UPDATE computers SET base_url=?, api_key=? WHERE id=?", url, agentKey, existing.id);
  else run("INSERT INTO computers (name, base_url, api_key, created) VALUES ('This Computer',?,?,?)", url, agentKey, now());
  server.listen(PORT, () => console.log(`CTRL PANE → http://localhost:${PORT}  (local agent on ${agentPort})  data: ${DATA_DIR}`));
}
void bootstrap();
