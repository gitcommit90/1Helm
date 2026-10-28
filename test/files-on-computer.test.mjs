// node --import ./test/stubs/register.mjs test/files-on-computer.test.mjs
// A FILE MARKED SYNCED IS REALLY ON THE COMPUTER BEFORE THE MODEL IS TOLD SO. Cause: files.synced=1 was written once when a copy was put on the computer and never
// checked again, so a computer that started from an older saved layer (no such file) kept getting told "/workspace/files/<name>" while syncFiles skipped the file.
// Real Resident on node:sqlite, a fake R2 and a fake computer whose disk can be wiped like a start from an old layer. Judges app facts only: the file is on the computer disk.
const { default: worker } = await import("../src/index.js");

const sqlOf = (db) => ({ exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = db.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } });

import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { createHash } from "node:crypto"; import { readFileSync } from "node:fs";
import { Resident } from "../src/resident.js";
import { stPut, recount } from "../src/storage.js";

// ---- D1 ----
const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT); CREATE TABLE sessions (token_hash TEXT, user_id TEXT, expires_at INTEGER);
  CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, owner_user_id TEXT, status TEXT, past_due_since INTEGER, onboarding_completed INTEGER, onboard_step TEXT, slug_chosen INTEGER, helper_name TEXT, helper_avatar INTEGER, helper_tone INTEGER, first_name TEXT, plan TEXT, host_ready INTEGER);
  CREATE TABLE resident_schedules (tenant_id TEXT, channel TEXT, channel_id TEXT, next_run INTEGER, updated_at INTEGER, PRIMARY KEY (tenant_id, channel));
  INSERT INTO users VALUES ('u1','sam@example.com');
  INSERT INTO tenants VALUES ('t1','ck1','u1','active',NULL,1,'',1,'Ollie',3,0,'Sam','plus',0);`);
d1.exec(readFileSync(new URL("../db/migrations/0015_025_share.sql", import.meta.url), "utf8"));
d1.exec(readFileSync(new URL("../db/migrations/0020_029_storage.sql", import.meta.url), "utf8"));
d1.prepare("INSERT INTO sessions VALUES (?,?,?)").run(createHash("sha256").update("aa11").digest("hex"), "u1", Date.now() + 864e5 * 400);
const DB = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return o; } };

// ---- fake R2 (sizes in list, so the recount works) ----
const R2 = new Map(); let etagN = 0;
const toBytes = async (v) => v == null ? new Uint8Array(0) : typeof v === "string" ? new TextEncoder().encode(v) : v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(await new Response(v).arrayBuffer());
const obj = (key, o, body) => ({ key, size: o.bytes.length, httpEtag: `"${o.etag}"`, etag: o.etag, httpMetadata: o.meta || {}, ...(body ? { body: new Response(body).body, arrayBuffer: async () => body.slice().buffer, text: async () => new TextDecoder().decode(body) } : {}) });
const WS = {
  async put(key, v, opts = {}) { const bytes = await toBytes(v); R2.set(key, { bytes, etag: `e${++etagN}`, meta: opts.httpMetadata }); return { size: bytes.length }; },
  async head(key) { const o = R2.get(key); return o ? obj(key, o) : null; },
  async get(key) { const o = R2.get(key); return o ? obj(key, o, o.bytes) : null; },
  async delete(keys) { for (const k of [].concat(keys)) R2.delete(k); },
  async list({ prefix = "", limit = 1000 } = {}) { const ks = [...R2.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit); return { objects: ks.map((k) => ({ key: k, size: R2.get(k).bytes.length })), truncated: false }; },
};
const r2Under = (p) => [...R2.keys()].filter((k) => k.startsWith(p));


// ---- fake channel computer ----
const FS = new Map(); let tick = 0, boot = "boot1", running = true, puts = 0;
const computer = {
  async bootId() { return running ? boot : "asleep"; },
  async sleepState() { return { running }; },
  async filesSnapshot() { if (!running) { running = true; boot = "boot" + (++tick + 1); } return { ok: true, out: [...FS.keys()].filter((k) => /^files\/[^/]+$/.test(k)).map((k) => `${FS.get(k).length} 1.5 ${k.slice(6)}`).join("\n") }; },
  async putFile(path, key) { if (!running) { running = true; boot = "boot" + (++tick + 1); } const o = await WS.get(key); if (!o) return { ok: false, error: "missing in storage" }; FS.set(path, new Uint8Array(await o.arrayBuffer())); puts++; return { ok: true, bytes: o.size }; },
  async rmFile(path) { FS.delete(path); return { ok: true }; },
  async exec() { if (!running) { running = true; boot = "boot" + (++tick + 1); } return { code: 0, out: "ok\n" }; },
};
// ---- env ----
const dos = new Map();
const env = { DB, WS, VAULT_KEY: Buffer.from(Array.from({ length: 32 }, (_, i) => i + 3)).toString("base64"), APP_HOST: "app.example.test", GATEWAY_HOST: "app.example.test", ENV_NAME: "dev", MODEL: "@cf/test/model", MEMORY: "off", GENUI: "off", WORKMEM: "off", TEST_MODE: "1",
  CHANNEL_COMPUTER: {}, RESIDENT: { idFromName: (n) => n, get: (n) => { if (!dos.has(n)) { const db = new DatabaseSync(":memory:"); const R = new Resident({ storage: { sql: sqlOf(db), getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: () => {} }, env);
    R.systemPrompt = async () => "SYSTEM"; R.computer = () => computer;
    const [, tid, slug] = n.split(":"); R.bind(tid, slug, "1", "America/Los_Angeles"); dos.set(n, R); } return dos.get(n); } },
  ARCHIVE: { idFromName: (n) => n, get: () => ({ channels: async () => [{ id: 1, slug: "main", name: "General" }] }) },
  LEDGER: { idFromName: (n) => n, get: () => new Proxy({}, { get: (_, k) => k === "then" ? undefined : k === "state" ? async () => ({ balance_nano: 1e12, spent_nano: 0, granted_nano: 1e12 }) : async () => ({ ok: true }) }) },
};
const R = env.RESIDENT.get("res:t1:main");

const enc = (s) => new TextEncoder().encode(s);
const S = (await R.createSession("Edit my resume")).id;
const upload = async (name, content) => { const id = crypto.randomUUID(), key = `t/t1/files/main/${id}`; await stPut(env, key, content); const v = await R.addUpload("t1", "main", "1", { id, name, mime: "application/pdf", bytes: content.length, r2key: key }); return v.id; };
const synced = (id) => R.sql.exec("SELECT synced FROM files WHERE id=?", id).one().synced;
let passed = 0; const ok = (n) => { passed++; console.log("  ok", n); };

const NAME = "AI.Solutions_Joseph_Yaksich.CV.pdf", ID = await upload(NAME, enc("%PDF-1.4 resume bytes"));
// the file was put on the computer once (synced=1), then the computer started again from an older saved layer without it
await R.syncFiles(); assert.ok(FS.has(`files/${NAME}`)); assert.equal(synced(ID), 1);
{
  FS.clear(); running = false;   // the new start has an empty files folder
  const ap = await R.attachParts([ID], S, "turn-1", null);
  assert.match(ap.note, /\/workspace\/files\/AI\.Solutions/, "the note names the path");
  await R.syncFiles();   // the first computer tool of the turn
  assert.equal(new TextDecoder().decode(FS.get(`files/${NAME}`)), "%PDF-1.4 resume bytes", "the file is on the computer before any tool runs");
  ok("a synced file missing after the computer started again is put back before the first computer tool");
}
{
  FS.clear();   // running computer that lost the file; the attachment is what tells the model
  const before = puts; await R.attachParts([ID], S, "turn-2", null);
  assert.ok(FS.has(`files/${NAME}`), "attached to a running computer: the file is there when the note is built"); assert.equal(puts, before + 1);
  ok("attaching a synced file to a message with the computer running puts a missing copy back at once");
}
{
  const before = puts; await R.attachParts([ID], S, "turn-3", null); await R.syncFiles();
  assert.equal(puts, before, "a file that is there is not copied again (a copy edited on the computer is never overwritten)");
  FS.set(`files/${NAME}`, enc("edited on the computer")); await R.syncFiles(); await R.attachParts([ID], S, "turn-4", null);
  assert.equal(new TextDecoder().decode(FS.get(`files/${NAME}`)), "edited on the computer");
  ok("a file already on the computer is left alone");
}
{
  FS.clear(); running = false; await R.syncFiles();
  assert.ok(FS.has(`files/${NAME}`), "a start of the computer, checked once per boot, restores every synced file");
  ok("every synced file is checked once per start of the computer");
}
console.log(`PASS files-on-computer (${passed} checks)`); process.exit(0);
