import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createChatGPTHandler, type ChatGPTHandler } from "@opencoredev/loginwithchatgpt-server";
import type { KeyValueStore } from "@opencoredev/loginwithchatgpt-core";
import type { IncomingMessage, ServerResponse } from "node:http";
import { DATA_DIR, q, q1, run, now } from "./db.ts";

export const CHATGPT_KIND = "chatgpt";
export const CHATGPT_BASE_URL = "ctrl-pane://chatgpt";
export const CHATGPT_PROVIDER_NAME = "ChatGPT";

const SECRET_FILE = join(DATA_DIR, "chatgpt-secret");
const PROVIDER_META_KEY = "provider:chatgpt";

type StoredSession = {
  status: string;
  device?: unknown;
  tokensCipher?: string;
  tokensPlain?: unknown;
  user?: { email?: string; name?: string; id?: string };
  createdAt: number;
  updatedAt: number;
};

type ProviderMeta = {
  sessionId: string;
  cookieValue: string;
  userEmail?: string;
  userName?: string;
  updatedAt: number;
};

function ensureSecret(): string {
  if (process.env.LWC_SECRET) return process.env.LWC_SECRET;
  if (existsSync(SECRET_FILE)) return readFileSync(SECRET_FILE, "utf8").trim();
  const secret = randomBytes(32).toString("hex");
  writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}

/** Durable SQLite-backed store for Login-with-ChatGPT sessions. */
function sqliteStore(): KeyValueStore<StoredSession> {
  return {
    get(key) {
      const row = q1("SELECT value, expires FROM chatgpt_sessions WHERE key=?", key);
      if (!row) return undefined;
      if (row.expires != null && Number(row.expires) <= Date.now()) {
        run("DELETE FROM chatgpt_sessions WHERE key=?", key);
        return undefined;
      }
      try { return JSON.parse(String(row.value)) as StoredSession; } catch { return undefined; }
    },
    set(key, value, options) {
      const expires = options?.ttlMs != null ? Date.now() + options.ttlMs : null;
      run("INSERT INTO chatgpt_sessions (key, value, expires) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires=excluded.expires",
        key, JSON.stringify(value), expires);
    },
    delete(key) {
      run("DELETE FROM chatgpt_sessions WHERE key=?", key);
    },
  };
}

const secret = ensureSecret();
export const chatgptHandler: ChatGPTHandler = createChatGPTHandler({
  secret,
  basePath: "/api/chatgpt",
  sessionStore: sqliteStore() as never,
  cookieName: "lwc_session",
  // Bots call the handler server-side without a browser Origin header.
  responsesProxy: { rateLimit: false },
});

function cookieHeader(cookieValue: string): string {
  return `lwc_session=${cookieValue}`;
}

function absoluteUrl(path: string, req?: IncomingMessage): string {
  const host = req?.headers.host || `localhost:${process.env.PORT || 8123}`;
  const proto = String(req?.headers["x-forwarded-proto"] || "http").split(",")[0].trim() || "http";
  return `${proto}://${host}${path}`;
}

function toWebRequest(req: IncomingMessage, body?: Buffer): Request {
  const url = absoluteUrl(req.url || "/", req);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((item) => headers.append(k, item));
    else headers.set(k, v);
  }
  const method = req.method || "GET";
  return new Request(url, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : new Uint8Array(body || []),
  });
}

async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      const existing = headers[key];
      if (!existing) headers[key] = value;
      else if (Array.isArray(existing)) existing.push(value);
      else headers[key] = [existing, value];
      return;
    }
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  if (!response.body) { res.end(); return; }
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}

export async function handleChatGPTHttp(req: IncomingMessage, res: ServerResponse, body: Buffer): Promise<void> {
  await writeWebResponse(res, await chatgptHandler.handler(toWebRequest(req, body)));
}

export async function chatgptWebResponse(req: IncomingMessage, body: Buffer): Promise<Response> {
  return chatgptHandler.handler(toWebRequest(req, body));
}

export async function writeChatGPTWebResponse(res: ServerResponse, response: Response): Promise<void> {
  await writeWebResponse(res, response);
}

function getProviderMeta(): ProviderMeta | null {
  const raw = q1("SELECT value FROM chatgpt_sessions WHERE key=?", PROVIDER_META_KEY);
  if (!raw) return null;
  try { return JSON.parse(String(raw.value)) as ProviderMeta; } catch { return null; }
}

function setProviderMeta(meta: ProviderMeta | null): void {
  if (!meta) { run("DELETE FROM chatgpt_sessions WHERE key=?", PROVIDER_META_KEY); return; }
  run("INSERT INTO chatgpt_sessions (key, value, expires) VALUES (?,?,NULL) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires=NULL",
    PROVIDER_META_KEY, JSON.stringify(meta));
}

function ensureChatGPTProviderRow(meta: ProviderMeta | null): number {
  const existing = q1("SELECT id FROM providers WHERE kind=?", CHATGPT_KIND);
  const label = meta?.userEmail || meta?.userName || CHATGPT_PROVIDER_NAME;
  const name = meta ? `${CHATGPT_PROVIDER_NAME} (${label})` : CHATGPT_PROVIDER_NAME;
  if (existing) {
    run("UPDATE providers SET name=?, base_url=?, api_key=?, kind=? WHERE id=?", name, CHATGPT_BASE_URL, meta?.sessionId || "", CHATGPT_KIND, existing.id);
    return Number(existing.id);
  }
  return run("INSERT INTO providers (name, base_url, api_key, kind, created) VALUES (?,?,?,?,?)",
    name, CHATGPT_BASE_URL, meta?.sessionId || "", CHATGPT_KIND, now()).lastInsertRowid;
}

/** Build a Request that carries the admin's stored ChatGPT session cookie. */
export function chatgptSessionRequest(path: string, init: RequestInit = {}): Request {
  const meta = getProviderMeta();
  if (!meta?.cookieValue) throw new Error("ChatGPT is not connected. An admin must connect it in Settings → Providers.");
  const headers = new Headers(init.headers || {});
  headers.set("cookie", cookieHeader(meta.cookieValue));
  // This is a server-to-server invocation of the SDK handler. Omitting Origin
  // is intentional: a synthetic localhost Origin is cross-origin to chatgpt.local
  // and the SDK's CSRF protection correctly rejects it.
  headers.delete("origin");
  return new Request(`http://chatgpt.local${chatgptHandler.basePath}${path}`, { ...init, headers });
}

export async function chatgptSessionStatus(): Promise<{ status: string; user?: { email?: string; name?: string; id?: string }; providerId?: number }> {
  const meta = getProviderMeta();
  if (!meta) return { status: "unauthenticated" };
  try {
    const session = await chatgptHandler.getSession(chatgptSessionRequest("/session"));
    if (session.status === "authenticated") {
      const id = ensureChatGPTProviderRow({
        ...meta,
        userEmail: session.user?.email || meta.userEmail,
        userName: session.user?.name || meta.userName,
        updatedAt: Date.now(),
      });
      setProviderMeta({
        ...meta,
        userEmail: session.user?.email || meta.userEmail,
        userName: session.user?.name || meta.userName,
        updatedAt: Date.now(),
      });
      return { status: session.status, user: session.user, providerId: id };
    }
    return { status: session.status, user: session.user };
  } catch {
    return { status: "unauthenticated" };
  }
}

/** After the browser completes device login, bind that session as the shared admin provider. */
export async function bindChatGPTProviderFromCookie(cookieHeaderValue: string | undefined): Promise<{ providerId: number; user?: { email?: string; name?: string; id?: string } }> {
  if (!cookieHeaderValue) throw new Error("No ChatGPT session cookie returned from login.");
  // Prefer the newest Set-Cookie value if multiple are present.
  const match = [...cookieHeaderValue.matchAll(/(?:^|,\s*)lwc_session=([^;]+)/g)].pop();
  const cookieValue = match?.[1];
  if (!cookieValue) throw new Error("ChatGPT login did not establish a session cookie.");
  const req = new Request(`http://chatgpt.local${chatgptHandler.basePath}/session`, {
    headers: { cookie: cookieHeader(cookieValue) },
  });
  const session = await chatgptHandler.getSession(req);
  if (session.status !== "authenticated") throw new Error(`ChatGPT session is ${session.status}, not authenticated.`);
  const meta: ProviderMeta = {
    sessionId: cookieValue.split(".")[0] || cookieValue,
    cookieValue,
    userEmail: session.user?.email,
    userName: session.user?.name,
    updatedAt: Date.now(),
  };
  const providerId = ensureChatGPTProviderRow(meta);
  setProviderMeta(meta);
  return { providerId, user: session.user };
}

export async function disconnectChatGPTProvider(): Promise<void> {
  const meta = getProviderMeta();
  if (meta?.cookieValue) {
    try {
      await chatgptHandler.handler(new Request(`http://chatgpt.local${chatgptHandler.basePath}/logout`, {
        method: "POST",
        headers: { cookie: cookieHeader(meta.cookieValue) },
      }));
    } catch { /* best effort */ }
  }
  setProviderMeta(null);
  const existing = q1("SELECT id FROM providers WHERE kind=?", CHATGPT_KIND);
  if (existing) {
    const inUse = Number(q1("SELECT COUNT(*) n FROM bots WHERE provider_id=?", existing.id)?.n || 0);
    if (!inUse) run("DELETE FROM providers WHERE id=?", existing.id);
    else run("UPDATE providers SET api_key='', name=? WHERE id=?", CHATGPT_PROVIDER_NAME, existing.id);
  }
}

export async function listChatGPTModels(): Promise<string[]> {
  const models = await chatgptHandler.getModels(chatgptSessionRequest("/models"));
  if (!models?.length) throw new Error("No ChatGPT models available for the connected account.");
  return models;
}

export async function streamChatGPTCompletion(
  model: string,
  messages: { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string }[],
  tools: unknown[] | undefined,
  onDelta: (d: string) => void,
  signal?: AbortSignal,
): Promise<{ content: string; toolCalls: { id: string; type: "function"; function: { name: string; arguments: string } }[]; usage: { input_tokens: number; output_tokens: number } }> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const input = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "tool") {
        return {
          type: "function_call_output",
          call_id: m.tool_call_id || "",
          output: m.content || "",
        };
      }
      if (m.role === "assistant" && m.tool_calls?.length) {
        // Responses API expects function_call items separately; keep text if present.
        const items: unknown[] = [];
        if (m.content) items.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: m.content }] });
        for (const tc of m.tool_calls as { id: string; function: { name: string; arguments: string } }[]) {
          items.push({ type: "function_call", call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments });
        }
        return items;
      }
      return {
        type: "message",
        role: m.role === "assistant" ? "assistant" : "user",
        content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content || "" }],
      };
    })
    .flat();

  const body: Record<string, unknown> = {
    model,
    stream: true,
    input,
    ...(system ? { instructions: system } : {}),
  };
  if (tools?.length) {
    body.tools = (tools as { type: string; function: { name: string; description?: string; parameters?: unknown } }[]).map((t) => ({
      type: "function",
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));
  }

  const response = await chatgptHandler.handler(chatgptSessionRequest("/responses", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  }));
  if (!response.ok || !response.body) {
    throw new Error(`ChatGPT responses failed (${response.status}): ${(await response.text().catch(() => "")).slice(0, 300)}`);
  }

  let content = "";
  const toolMap = new Map<string, { id: string; type: "function"; function: { name: string; arguments: string } }>();
  let usage = { input_tokens: 0, output_tokens: 0 };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    let event = "";
    for (const line of lines) {
      const t = line.trimEnd();
      if (!t) { event = ""; continue; }
      if (t.startsWith("event:")) { event = t.slice(6).trim(); continue; }
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let data: any;
      try { data = JSON.parse(payload); } catch { continue; }
      const type = String(data.type || event || "");
      if (type.includes("response.output_text.delta") || type === "response.output_text.delta") {
        const delta = String(data.delta || data.text || "");
        if (delta) { content += delta; onDelta(delta); }
        continue;
      }
      if (type.includes("output_text.delta") && data.delta) {
        const delta = String(data.delta);
        content += delta; onDelta(delta);
        continue;
      }
      // Some streams put text on response.output_item.delta
      if (typeof data.delta === "string" && /output_text|text\.delta/i.test(type)) {
        content += data.delta; onDelta(data.delta);
      }
      if (type.includes("function_call") || data.name && data.arguments != null) {
        const id = String(data.call_id || data.id || data.item_id || `tool_${toolMap.size}`);
        const cur = toolMap.get(id) || { id, type: "function" as const, function: { name: "", arguments: "" } };
        if (data.name) cur.function.name = String(data.name);
        if (data.arguments) cur.function.arguments += String(data.arguments);
        if (data.delta && typeof data.delta === "string" && /arguments/i.test(type)) cur.function.arguments += data.delta;
        toolMap.set(id, cur);
      }
      // completed response may include full output items
      if (type === "response.completed" && Array.isArray(data.response?.output)) {
        for (const item of data.response.output) {
          if (item?.type === "function_call") {
            const id = String(item.call_id || item.id || `tool_${toolMap.size}`);
            toolMap.set(id, { id, type: "function", function: { name: String(item.name || ""), arguments: String(item.arguments || "") } });
          }
          if (item?.type === "message" && Array.isArray(item.content)) {
            for (const part of item.content) {
              if (part?.type === "output_text" && part.text && !content.includes(part.text)) {
                // Prefer streamed deltas; only fill if nothing streamed.
                if (!content) { content = String(part.text); onDelta(content); }
              }
            }
          }
        }
      }
      // Responses API usage: response.completed / response.done carry totals.
      const u = data.response?.usage || data.usage;
      if (u && typeof u === "object") {
        const input = Number(u.input_tokens ?? u.prompt_tokens ?? 0) || 0;
        const output = Number(u.output_tokens ?? u.completion_tokens ?? 0) || 0;
        if (input || output) usage = { input_tokens: input, output_tokens: output };
      }
    }
  }
  return { content, toolCalls: [...toolMap.values()].filter((t) => t.function.name), usage };
}

export function isChatGPTProvider(row: { kind?: unknown; base_url?: unknown } | null | undefined): boolean {
  return !!row && (String(row.kind) === CHATGPT_KIND || String(row.base_url) === CHATGPT_BASE_URL);
}
