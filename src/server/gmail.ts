import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type TokenPayload = {
  token?: string;
  refresh_token?: string;
  token_uri?: string;
  client_id?: string;
  client_secret?: string;
  account_email?: string;
};

type MailConfig = { accounts: string[]; can_read: boolean; can_draft: boolean; can_send: boolean };

const TOKENS_DIR = process.env.ONEHELM_GOOGLE_TOKENS_DIR || join(homedir(), ".hermes", "google_tokens");
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (value: unknown): string => String(value || "").trim().toLowerCase();
const tokenPath = (email: string): string => join(TOKENS_DIR, email.replaceAll("@", "_at_").replaceAll(".", "_dot_") + ".json");

export function availableGoogleAccounts(): string[] {
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
  const response = await fetch(credentials.token_uri || "https://oauth2.googleapis.com/token", {
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
  const response = await fetch(`${GMAIL_API}${path}`, {
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
