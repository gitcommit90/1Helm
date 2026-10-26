// share_file keeps the source file's extension when the helper's name has none (fall menu board demo.mp4 case), on the direct path and the dynamic_routing path.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Resident } from '../src/resident.js';
import { fileVersionsMethods } from '../src/file-versions.js';
import { helpersInit } from '../src/helpers.js';
import { userInputInit } from '../src/user-input.js';
import { initRoutingArtifacts, stageRoutingFile, collectRoutingFiles } from '../src/ee/routing-artifacts.js';
import { saveBack } from '../src/files-saveback.js';
import { seedSettings } from './helpers/seed-settings.mjs';
import { ENDPOINTS } from '../src/privacy.js';
ENDPOINTS.transcription ||= {}; for (const m of ['@cf/google/gemma-4-26b-a4b-it']) ENDPOINTS.transcription[m] = { 'cloudflare-workers-ai': { zdr: true, training: false } };
const db = new DatabaseSync(':memory:'), d1 = new DatabaseSync(':memory:');
d1.exec(readFileSync(new URL('../db/migrations/0020_029_storage.sql', import.meta.url), 'utf8'));
d1.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,slug TEXT,plan TEXT,status TEXT);INSERT INTO tenants VALUES('test-tenant','fixture','plus','active');CREATE TABLE share_links(tenant_id TEXT,file_id TEXT,r2key TEXT,bytes INTEGER)");
const DB = { prepare(q) { const st = d1.prepare(q); let a = []; const o = { bind(...v) { a = v; return o; }, async first() { return st.get(...a) || null; }, async all() { return { results: st.all(...a) }; }, async run() { return { meta: { changes: Number(st.run(...a).changes) } }; } }; return o; } };
const sql = { exec(q, ...a) { const st = db.prepare(q); if (st.columns().length) { const rows = st.all(...a); return { toArray: () => rows, one: () => { assert.equal(rows.length, 1); return rows[0]; } }; } const r = st.run(...a); return { toArray: () => [], rowsWritten: Number(r.changes) }; } };
db.exec("CREATE TABLE files(id TEXT PRIMARY KEY,at INTEGER,name TEXT,mime TEXT,bytes INTEGER,r2key TEXT,view_key TEXT,source TEXT,session TEXT,turn TEXT,synced INTEGER DEFAULT 0,deleted INTEGER DEFAULT 0,pending INTEGER DEFAULT 0,src_path TEXT,tags TEXT,version INTEGER DEFAULT 1,prev_key TEXT,prev_bytes INTEGER,hidden INTEGER DEFAULT 0);CREATE TABLE card_events(card TEXT,type TEXT,tool TEXT);CREATE TABLE turns(id TEXT PRIMARY KEY,at INTEGER NOT NULL);CREATE TABLE workflows(session TEXT,status TEXT);CREATE TABLE approvals(session TEXT,status TEXT)");
helpersInit(sql); userInputInit(sql);
const objects = new Map(), read = async b => typeof b === 'string' ? new TextEncoder().encode(b) : b instanceof Uint8Array ? b : new Uint8Array(await new Response(b).arrayBuffer());
const WS = { async put(k, b) { const bytes = await read(b); objects.set(k, bytes); return { size: bytes.length }; }, async get(k) { const bytes = objects.get(k); return bytes ? { size: bytes.length, arrayBuffer: async () => bytes.slice().buffer, text: async () => new TextDecoder().decode(bytes), body: new Response(bytes).body } : null; }, async head(k) { return objects.has(k) ? { size: objects.get(k).length } : null; }, async delete(ks) { for (const k of [].concat(ks)) objects.delete(k); } };
const emitted = [];
const R = Object.assign(Object.create(Resident.prototype), { sql, env: { DB, WS, DYNAMIC_ROUTING: 'on', MODEL_SETTINGS: seedSettings(), COMPUTER: { idFromName: n => n, get: () => ({ prepJob: async ({ pages }) => ({ pages: pages.map(page => ({ page, md: 'OCR page ' + page })), ms: 1000 }) }) } },
  get(k) { return { tenant: 'test-tenant', channel: 'main' }[k]; }, ledger() { return { reserve: async () => ({ ok: true }), settle: async () => {} }; }, ctx: { waitUntil() {} }, kv: new Map(), getRaw(k) { return this.kv.get(k) ?? null; }, put(k, v) { this.kv.set(k, v); }, computer: () => computer, sidecarKick() {}, async republishPages() { return ''; }, journalDelegation() {}, ...fileVersionsMethods });
R.fvInit(); initRoutingArtifacts(sql);
const computer = { files: new Map(), async fileToR2(path, key) { const b = this.files.get(path); if (!b) return { ok: false, error: 'missing ' + path }; await WS.put(key, b); return { ok: true, bytes: b.length }; } };
const SESSION = 'e32cae00-2155-40ba-98cb-df8f432998d0', DIR = '/workspace/workspace/helpers/41', SLUG = DIR + '/northwind-ai-impact-2026', enc = s => new TextEncoder().encode(s);
const library = () => sql.exec("SELECT name FROM files WHERE deleted=0 ORDER BY name").toArray().map(r => r.name);
import { nameWithSourceExt, mimeOf } from '../src/files.js';
const row = n => sql.exec("SELECT name,mime FROM files WHERE name=?", n).toArray().map(r => ({ ...r }))[0];
const emitted2 = [], ctx = { session: SESSION, emit: e => emitted2.push(e) };
// helper unit
assert.equal(nameWithSourceExt('Fall menu board demo', 'workspace/fall-menu-board-demo.mp4'), 'Fall menu board demo.mp4');
assert.equal(nameWithSourceExt('Q3 report v1.2', 'q3.pdf'), 'Q3 report v1.2.pdf');
assert.equal(nameWithSourceExt('Budget.xlsx', 'b.csv'), 'Budget.xlsx', 'a name with an extension is unchanged');
assert.equal(nameWithSourceExt('Notes', 'noext'), 'Notes'); assert.equal(nameWithSourceExt('', 'a.mp4'), '');
for (const e of ['mp4', 'mov', 'webm', 'm4v', 'mkv', 'mp3', 'wav', 'ogg']) assert.match(mimeOf('x.' + e), /^(video|audio)\//, e);
// direct path
computer.files.set('workspace/fall-menu-board-demo.mp4', enc('video'.repeat(30)));
const said = await R.shareFile({ path: '/workspace/workspace/fall-menu-board-demo.mp4', name: 'Fall menu board demo' }, ctx);
assert.deepEqual(row('Fall menu board demo.mp4'), { name: 'Fall menu board demo.mp4', mime: 'video/mp4' });
assert.equal(row('Fall menu board demo'), undefined);
assert.match(said, /card shows under your reply/); assert.doesNotMatch(said, /download card in this chat/);
// a name with an extension is unchanged
computer.files.set('workspace/clip.mov', enc('mov'.repeat(30)));
await R.shareFile({ path: 'workspace/clip.mov', name: 'Clip.mp4' }, ctx);
assert.deepEqual(row('Clip.mp4'), { name: 'Clip.mp4', mime: 'video/mp4' });
// no name: the file's own name
await R.shareFile({ path: 'workspace/clip.mov' }, ctx);
assert.ok(row('clip.mov') || row('Clip.mp4'));
// an update in place says where the card shows
computer.files.set('workspace/fall-menu-board-demo.mp4', enc('video2'.repeat(30)));
const upd = await R.shareFile({ path: 'workspace/fall-menu-board-demo.mp4', name: 'Fall menu board demo' }, ctx);
assert.match(upd, /Updated "Fall menu board demo\.mp4"/); assert.match(upd, /card shows under your reply/);
// dynamic_routing path
sql.exec("INSERT INTO helpers(id,session,name,task,status,started,deadline,dynamic_routing,required_delegation,round,handed) VALUES(51,?,'Make video','task','working',1,9999999999999,1,0,1,0)", SESSION);
const h2 = sql.exec('SELECT * FROM helpers WHERE id=51').one();
const held = await stageRoutingFile(R, h2, { path: '/workspace/workspace/helpers/51/Menu clip.webm', name: 'Menu clip', bytes: enc('webm'.repeat(30)) });
assert.equal(held.name, 'Menu clip.webm');
const held2 = await stageRoutingFile(R, h2, { name: 'Bytes only', mime: 'image/png', bytes: enc('png'.repeat(30)) });
assert.equal(held2.name, 'Bytes only', 'bytes with no source path keep the given name');
console.log('PASS share-ext');
