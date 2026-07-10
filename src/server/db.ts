import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const DATA_DIR = process.env.CTRL_DATA_DIR || join(process.cwd(), "data");
export const UPLOAD_DIR = join(DATA_DIR, "uploads");
mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, "ctrl-pane.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass TEXT NOT NULL,
  display TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'channel',
  topic TEXT NOT NULL DEFAULT '', created_by INTEGER, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS members (channel_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  last_read INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (channel_id, user_id));
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, channel_id INTEGER NOT NULL, parent_id INTEGER,
  user_id INTEGER, bot_id INTEGER, body TEXT NOT NULL DEFAULT '',
  reply_count INTEGER NOT NULL DEFAULT 0, last_reply INTEGER, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY, message_id INTEGER NOT NULL, name TEXT NOT NULL,
  mime TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, api_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'openai', created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chatgpt_sessions (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER);
CREATE TABLE IF NOT EXISTS bots (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL DEFAULT '', api_key TEXT NOT NULL DEFAULT '',
  provider_id INTEGER, model TEXT NOT NULL DEFAULT '', prompt TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS computers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, api_key TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bot_channels (bot_id INTEGER NOT NULL, channel_id INTEGER NOT NULL, PRIMARY KEY (bot_id, channel_id));
CREATE TABLE IF NOT EXISTS bot_computers (bot_id INTEGER NOT NULL, computer_id INTEGER NOT NULL, PRIMARY KEY (bot_id, computer_id));
CREATE TABLE IF NOT EXISTS model_prefs (bot_id INTEGER NOT NULL, scope TEXT NOT NULL, scope_id TEXT NOT NULL, model TEXT NOT NULL, PRIMARY KEY (bot_id, scope, scope_id));
CREATE INDEX IF NOT EXISTS idx_msg_channel ON messages(channel_id, parent_id, id);
`);

export type Row = Record<string, unknown>;

export function q(sql: string, ...params: unknown[]): Row[] {
  return db.prepare(sql).all(...(params as never[])) as Row[];
}
export function q1(sql: string, ...params: unknown[]): Row | undefined {
  return db.prepare(sql).get(...(params as never[])) as Row | undefined;
}
export function run(sql: string, ...params: unknown[]): { lastInsertRowid: number; changes: number } {
  const r = db.prepare(sql).run(...(params as never[]));
  return { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.changes) };
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32);
  return salt.toString("hex") + ":" + hash.toString("hex");
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const hash = scryptSync(pw, Buffer.from(saltHex, "hex"), 32);
  return timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
}
export const newToken = (): string => randomBytes(24).toString("hex");
export const now = (): number => Date.now();

/** Ensure the default #general channel exists. Bots/computers are user-added. */
export function seed(): void {
  if (!q1("SELECT id FROM channels WHERE kind='channel' LIMIT 1")) {
    run("INSERT INTO channels (name, kind, topic, created) VALUES ('general','channel','Company-wide announcements and chatter',?)", now());
  }
}

const hostLabel = (url: string): string => { try { return new URL(url).host; } catch { return url || "provider"; } };
const providerKind = (url: string): string => /openrouter\.ai/i.test(url) ? "openrouter" : "openai";

/** Migrate older bots that stored base_url/api_key inline into reusable provider rows. */
export function migrate(): void {
  const cols = q("PRAGMA table_info(bots)").map((c) => c.name);
  if (!cols.includes("provider_id")) db.exec("ALTER TABLE bots ADD COLUMN provider_id INTEGER");
  for (const b of q("SELECT id, base_url, api_key FROM bots WHERE (provider_id IS NULL OR provider_id=0) AND base_url<>''")) {
    const base = String(b.base_url), key = String(b.api_key);
    const existing = q1("SELECT id FROM providers WHERE base_url=? AND api_key=?", base, key);
    const pid = existing ? Number(existing.id)
      : run("INSERT INTO providers (name, base_url, api_key, kind, created) VALUES (?,?,?,?,?)", hostLabel(base), base, key, providerKind(base), now()).lastInsertRowid;
    run("UPDATE bots SET provider_id=? WHERE id=?", pid, b.id);
  }
}
migrate();
