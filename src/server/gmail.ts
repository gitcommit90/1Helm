import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DATA_DIR, now } from "./db.ts";

type TokenPayload = {
  token?: string;
  refresh_token?: string;
  token_uri?: string;
  client_id?: string;
  client_secret?: string;
  account_email?: string;
  scope?: string;
  scopes?: string[];
};

type MailConfig = { accounts: string[]; can_read: boolean; can_draft: boolean; can_send: boolean };

type OAuthClient = { client_id: string; client_secret: string; auth_uri?: string; token_uri?: string; redirect_uris?: string[] };
type GmailSetup = { active: boolean; status: "idle" | "needs_client" | "waiting" | "connected" | "failed"; authorization_url?: string; manual_completion?: boolean; error?: string; started_at?: number; expires_at?: number };
type PendingOAuth = { client: OAuthClient; state: string; verifier: string; redirectUri: string; completing: boolean };

const CONNECTION_DIR = process.env.ONEHELM_GOOGLE_CONNECTION_DIR || join(DATA_DIR, "connections", "gmail");
const TOKENS_DIR = process.env.ONEHELM_GOOGLE_TOKENS_DIR || join(CONNECTION_DIR, "tokens");
const CLIENT_FILE = join(CONNECTION_DIR, "oauth-client.json");
const LEGACY_TOKENS_DIR = join(homedir(), ".hermes", "google_tokens");
const LEGACY_CLIENT_FILE = join(homedir(), ".hermes", "google_client_secret.json");
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GMAIL_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"];
let setup: GmailSetup = { active: false, status: "idle" };
let callbackServer: Server | null = null;
let pendingOAuth: PendingOAuth | null = null;
let gmailFetch: typeof fetch = fetch;

export function setGmailFetchForTests(implementation: typeof fetch | null): void {
  gmailFetch = implementation || fetch;
}

export function stopGmailConnection(): void {
  callbackServer?.close();
  callbackServer = null;
  pendingOAuth = null;
  setup = { active: false, status: "idle" };
}

const normalizeEmail = (value: unknown): string => String(value || "").trim().toLowerCase();
const tokenPath = (email: string): string => join(TOKENS_DIR, email.replaceAll("@", "_at_").replaceAll(".", "_dot_") + ".json");

function writePrivate(path: string, payload: unknown): void {
  mkdirSync(CONNECTION_DIR, { recursive: true, mode: 0o700 });
  mkdirSync(TOKENS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

function parseOAuthClient(value: unknown, requireDesktop = false): OAuthClient {
  const raw = value as { installed?: OAuthClient; web?: OAuthClient };
  if (requireDesktop && !raw?.installed) throw new Error("Choose a Google OAuth client JSON file created as a Desktop app.");
  const client = raw?.installed || value as OAuthClient;
  if (!client?.client_id || !client.client_secret) throw new Error("Choose a valid Google OAuth client JSON file created as a Desktop app.");
  return { client_id: String(client.client_id), client_secret: String(client.client_secret), auth_uri: String(client.auth_uri || "https://accounts.google.com/o/oauth2/v2/auth"), token_uri: String(client.token_uri || "https://oauth2.googleapis.com/token"), redirect_uris: client.redirect_uris || [] };
}

function importLegacyConnections(): void {
  mkdirSync(TOKENS_DIR, { recursive: true, mode: 0o700 });
  // An explicit connection root is an isolation boundary (tests, alternate
  // profiles, and packaged installations) and must never inherit a user's
  // unrelated legacy Hermes credentials.
  if (process.env.ONEHELM_GOOGLE_CONNECTION_DIR || process.env.ONEHELM_GOOGLE_TOKENS_DIR) return;
  if (!existsSync(CLIENT_FILE) && existsSync(LEGACY_CLIENT_FILE)) {
    try { writePrivate(CLIENT_FILE, parseOAuthClient(JSON.parse(readFileSync(LEGACY_CLIENT_FILE, "utf8")), true)); } catch { /* invalid legacy config */ }
  }
  if (!existsSync(LEGACY_TOKENS_DIR)) return;
  for (const file of readdirSync(LEGACY_TOKENS_DIR, { withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith(".json") || existsSync(join(TOKENS_DIR, file.name))) continue;
    try {
      const payload = JSON.parse(readFileSync(join(LEGACY_TOKENS_DIR, file.name), "utf8")) as TokenPayload;
      if (payload.refresh_token && payload.client_id && payload.client_secret) writePrivate(join(TOKENS_DIR, file.name), payload);
    } catch { /* ignore unrelated legacy files */ }
  }
}

export function availableGoogleAccounts(): string[] {
  importLegacyConnections();
  if (!existsSync(TOKENS_DIR)) return [];
  const accounts = new Set<string>();
  for (const file of readdirSync(TOKENS_DIR, { withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith(".json")) continue;
    try {
      const payload = JSON.parse(readFileSync(join(TOKENS_DIR, file.name), "utf8")) as TokenPayload;
      const email = normalizeEmail(payload.account_email || file.name.slice(0, -5).replaceAll("_at_", "@").replaceAll("_dot_", "."));
      if (EMAIL.test(email)) accounts.add(email);
    } catch { /* malformed or unrelated credential file */ }
  }
  return [...accounts].sort();
}

export function gmailConnectionStatus(): Record<string, unknown> {
  importLegacyConnections();
  return { accounts: availableGoogleAccounts(), has_oauth_client: existsSync(CLIENT_FILE), setup: { ...setup, authorization_url: setup.authorization_url || "" } };
}

export function saveGmailOAuthClient(input: unknown): Record<string, unknown> {
  const client = parseOAuthClient(input, true);
  writePrivate(CLIENT_FILE, client);
  return gmailConnectionStatus();
}

const setupPage = (message: string, ok: boolean): string => `<!doctype html><html><head><meta charset="utf-8"><title>1Helm Gmail</title><style>body{font:16px system-ui;background:#111827;color:#f9fafb;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:34rem;padding:2rem;border:1px solid #374151;border-radius:16px;background:#1f2937}h1{margin-top:0;color:${ok ? "#34d399" : "#f87171"}}</style></head><body><main class="card"><h1>${ok ? "Gmail connected" : "Gmail connection failed"}</h1><p>${message.replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[char]!)}</p><p>You can close this tab and return to 1Helm.</p></main></body></html>`;

function parsedCallback(value: unknown, pending: PendingOAuth): URL {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 8192) throw new Error("Paste the complete Google callback URL from the browser address bar.");
  let callback: URL;
  try { callback = new URL(raw); }
  catch { throw new Error("Paste a valid complete Google callback URL."); }
  const expected = new URL(pending.redirectUri);
  if (callback.protocol !== expected.protocol || callback.hostname !== expected.hostname || callback.port !== expected.port || callback.pathname !== expected.pathname) {
    throw new Error("That is not the localhost callback URL created by this Gmail connection attempt.");
  }
  if (callback.searchParams.get("state") !== pending.state) throw new Error("OAuth state did not match. Start the connection again.");
  const code = callback.searchParams.get("code");
  if (!code) throw new Error(callback.searchParams.get("error_description") || callback.searchParams.get("error") || "Google returned no authorization code.");
  return callback;
}

/** Complete the same PKCE exchange from either the local listener or a pasted
 * localhost callback URL. The pasted URL is parsed, never fetched. */
export async function completeGmailConnection(callbackUrl: unknown): Promise<Record<string, unknown>> {
  const pending = pendingOAuth;
  if (!pending || !setup.active || setup.status !== "waiting") throw new Error("No Gmail authorization is waiting. Start the connection again.");
  if (pending.completing) throw new Error("This Gmail authorization is already being completed.");
  const callback = parsedCallback(callbackUrl, pending);
  pending.completing = true;
  try {
    const code = callback.searchParams.get("code")!;
    const tokenResponse = await gmailFetch(pending.client.token_uri || "https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: pending.client.client_id, client_secret: pending.client.client_secret, redirect_uri: pending.redirectUri, grant_type: "authorization_code", code_verifier: pending.verifier }), signal: AbortSignal.timeout(30_000) });
    const token = await tokenResponse.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error_description?: string };
    if (!tokenResponse.ok || !token.access_token || !token.refresh_token) throw new Error(token.error_description || "Google did not return a durable refresh token. Reconnect and approve access.");
    const profileResponse = await gmailFetch(`${GMAIL_API}/profile`, { headers: { authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(30_000) });
    const profile = await profileResponse.json().catch(() => ({})) as { emailAddress?: string; error?: { message?: string } };
    const email = normalizeEmail(profile.emailAddress);
    if (!profileResponse.ok || !EMAIL.test(email)) throw new Error(profile.error?.message || "Google did not identify the Gmail account.");
    writePrivate(tokenPath(email), { token: token.access_token, refresh_token: token.refresh_token, token_uri: pending.client.token_uri || "https://oauth2.googleapis.com/token", client_id: pending.client.client_id, client_secret: pending.client.client_secret, account_email: email, scope: token.scope || GMAIL_SCOPES.join(" ") });
    setup = { active: false, status: "connected", started_at: setup.started_at, expires_at: setup.expires_at };
    return gmailConnectionStatus();
  } catch (error) {
    setup = { active: false, status: "failed", error: (error as Error).message, started_at: setup.started_at };
    throw error;
  } finally {
    if (pendingOAuth === pending) pendingOAuth = null;
    const server = callbackServer;
    callbackServer = null;
    server?.close();
  }
}

export async function startGmailConnection(clientInput?: unknown): Promise<Record<string, unknown>> {
  importLegacyConnections();
  if (clientInput) saveGmailOAuthClient(clientInput);
  if (!existsSync(CLIENT_FILE)) {
    setup = {
      active: false,
      status: "needs_client",
      error: "Add a Google OAuth Desktop app JSON file once, then 1Helm can connect Gmail accounts here. Tokens remain host-owned.",
    };
    // Discovering a required one-time human credential is a successful
    // connector-state result, not a transient tool failure to retry in a
    // model loop. The UI and Skipper can now present one stable next step.
    return gmailConnectionStatus();
  }
  if (callbackServer) { callbackServer.close(); callbackServer = null; }
  pendingOAuth = null;
  const client = parseOAuthClient(JSON.parse(readFileSync(CLIENT_FILE, "utf8")));
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname !== "/gmail/callback") { res.writeHead(404); res.end(); return; }
    try {
      const completed = await completeGmailConnection(new URL(req.url || "/", redirectUri).toString());
      const email = String((completed.accounts as string[])?.at(-1) || "This Gmail account");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(setupPage(`${email} is connected with read and draft access. 1Helm will never expose its OAuth token to a resident computer.`, true));
    } catch (error) {
      res.writeHead(400, { "content-type": "text/html; charset=utf-8" }); res.end(setupPage((error as Error).message, false));
    }
  });
  callbackServer = server;
  const port = await new Promise<number>((resolve, reject) => { callbackServer!.once("error", reject); callbackServer!.listen(0, "127.0.0.1", () => resolve((callbackServer!.address() as { port: number }).port)); });
  const redirectUri = `http://127.0.0.1:${port}/gmail/callback`;
  const pending: PendingOAuth = { client, state, verifier, redirectUri, completing: false };
  pendingOAuth = pending;
  const authorization = new URL(client.auth_uri || "https://accounts.google.com/o/oauth2/v2/auth");
  authorization.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri, response_type: "code", scope: GMAIL_SCOPES.join(" "), access_type: "offline", prompt: "consent select_account", state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
  setup = { active: true, status: "waiting", authorization_url: authorization.toString(), manual_completion: true, started_at: now(), expires_at: now() + 10 * 60_000 };
  const timer = setTimeout(() => {
    if (pendingOAuth !== pending) return;
    setup = { active: false, status: "failed", error: "Gmail authorization expired. Start it again." };
    pendingOAuth = null;
    callbackServer?.close(); callbackServer = null;
  }, 10 * 60_000); timer.unref();
  return gmailConnectionStatus();
}

export function normalizeMailConfig(raw: unknown): MailConfig {
  let value: Record<string, unknown> = {};
  try { value = typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>) || {}; } catch { /* empty */ }
  const available = new Set(availableGoogleAccounts());
  const accounts = Array.isArray(value.accounts)
    ? [...new Set(value.accounts.map(normalizeEmail).filter((email) => available.has(email)))]
    : [];
  return {
    accounts,
    can_read: value.can_read !== false,
    can_draft: value.can_draft !== false,
    can_send: value.can_send === true,
  };
}

function credentialPayload(email: string): TokenPayload {
  const normalized = normalizeEmail(email);
  if (!availableGoogleAccounts().includes(normalized)) throw new Error(`Gmail account ${normalized || "(missing)"} is not connected on this host.`);
  const payload = JSON.parse(readFileSync(tokenPath(normalized), "utf8")) as TokenPayload;
  if (!payload.refresh_token || !payload.client_id || !payload.client_secret) throw new Error(`Gmail credentials for ${normalized} are incomplete.`);
  return payload;
}

async function accessToken(email: string, signal?: AbortSignal): Promise<string> {
  const credentials = credentialPayload(email);
  const response = await gmailFetch(credentials.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credentials.refresh_token!,
      client_id: credentials.client_id!,
      client_secret: credentials.client_secret!,
    }),
    signal,
  });
  const result = await response.json().catch(() => ({})) as { access_token?: string; error_description?: string };
  if (!response.ok || !result.access_token) throw new Error(`Gmail authorization failed for ${email}: ${result.error_description || response.status}.`);
  return result.access_token;
}

async function gmail<T>(email: string, path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const token = await accessToken(email, signal);
  const response = await gmailFetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) },
    signal,
  });
  const result = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(`Gmail ${response.status}: ${result.error?.message || "request failed"}.`);
  return result;
}

type Header = { name?: string; value?: string };
type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] };
type GmailMessage = {
  id: string;
  threadId?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: Part & { headers?: Header[] };
};

const headers = (message: GmailMessage): Record<string, string> => Object.fromEntries(
  (message.payload?.headers || []).filter((header) => header.name).map((header) => [String(header.name).toLowerCase(), String(header.value || "")]),
);
const decode = (value: string): string => Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");
function bodyText(part: Part | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decode(part.body.data);
  for (const child of part.parts || []) { const found = bodyText(child); if (found) return found; }
  if (part.mimeType === "text/html" && part.body?.data) return decode(part.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (part.body?.data) return decode(part.body.data);
  return "";
}

export async function searchGmail(email: string, query: string, maxResults: number, signal?: AbortSignal): Promise<unknown> {
  const limit = Math.max(1, Math.min(25, Math.floor(maxResults || 10)));
  const list = await gmail<{ messages?: { id: string }[] }>(email, `/messages?q=${encodeURIComponent(query)}&maxResults=${limit}`, {}, signal);
  const results = await Promise.all((list.messages || []).map(async ({ id }) => {
    const message = await gmail<GmailMessage>(email, `/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`, {}, signal);
    const h = headers(message);
    return { id: message.id, thread_id: message.threadId || "", from: h.from || "", to: h.to || "", subject: h.subject || "", date: h.date || "", snippet: message.snippet || "", labels: message.labelIds || [] };
  }));
  return { account: email, query, results };
}

export async function getGmailMessage(email: string, messageId: string, signal?: AbortSignal): Promise<unknown> {
  const message = await gmail<GmailMessage>(email, `/messages/${encodeURIComponent(messageId)}?format=full`, {}, signal);
  const h = headers(message);
  return { account: email, id: message.id, thread_id: message.threadId || "", from: h.from || "", to: h.to || "", subject: h.subject || "", date: h.date || "", labels: message.labelIds || [], body: bodyText(message.payload).slice(0, 40_000) };
}

const base64url = (value: string): string => Buffer.from(value).toString("base64url");
const cleanHeader = (value: string): string => value.replace(/[\r\n]+/g, " ").trim();
export async function createGmailDraft(email: string, to: string, subject: string, text: string, signal?: AbortSignal): Promise<unknown> {
  if (!EMAIL.test(normalizeEmail(to))) throw new Error("Provide one valid recipient email address.");
  if (!subject.trim() || !text.trim()) throw new Error("Draft subject and body are required.");
  const raw = base64url([
    `From: ${cleanHeader(email)}`,
    `To: ${cleanHeader(to)}`,
    `Subject: ${cleanHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
  ].join("\r\n"));
  const result = await gmail<{ id: string; message?: { id?: string; threadId?: string } }>(email, "/drafts", { method: "POST", body: JSON.stringify({ message: { raw } }) }, signal);
  return { account: email, status: "draft_created", draft_id: result.id, message_id: result.message?.id || "", thread_id: result.message?.threadId || "" };
}
