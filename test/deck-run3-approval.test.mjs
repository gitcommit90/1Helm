// Replay of live run 3 (helper #29, round 3): the review turn called approve_subagent with file PATHS, the approval only knew file IDs, and the thrown
// error ended the review turn. Twice. Facts judged: the call attaches the deck, a wrong name returns an error the model can act on, a session whose worker
// is waiting for review stays "working". No model is called.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Resident } from '../src/resident.js';
import { fileVersionsMethods } from '../src/file-versions.js';
import { helpersInit } from '../src/helpers.js';
import { userInputInit } from '../src/user-input.js';
import { initRoutingArtifacts, stageRoutingFile, collectRoutingFiles, resolveSelection } from '../src/ee/routing-artifacts.js';
import { seedSettings } from './helpers/seed-settings.mjs';
import { ENDPOINTS } from '../src/privacy.js';
ENDPOINTS.transcription ||= {}; for (const m of ['@cf/google/gemma-4-26b-a4b-it']) ENDPOINTS.transcription[m] = { 'cloudflare-workers-ai': { zdr: true, training: false } };
const db = new DatabaseSync(':memory:'), d1 = new DatabaseSync(':memory:');
d1.exec(readFileSync(new URL('../db/migrations/0020_029_storage.sql', import.meta.url), 'utf8'));
d1.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,slug TEXT,plan TEXT,status TEXT);INSERT INTO tenants VALUES('test-tenant','fixture','plus','active');CREATE TABLE share_links(tenant_id TEXT,file_id TEXT,r2key TEXT,bytes INTEGER)");
const DB = { prepare(q) { const st = d1.prepare(q); let a = []; const o = { bind(...v) { a = v; return o; }, async first() { return st.get(...a) || null; }, async all() { return { results: st.all(...a) }; }, async run() { return { meta: { changes: Number(st.run(...a).changes) } }; } }; return o; } };
const sql = { exec(q, ...a) { const st = db.prepare(q); if (st.columns().length) { const rows = st.all(...a); return { toArray: () => rows, one: () => { assert.equal(rows.length, 1); return rows[0]; } }; } const r = st.run(...a); return { toArray: () => [], rowsWritten: Number(r.changes) }; } };
db.exec("CREATE TABLE files(id TEXT PRIMARY KEY,at INTEGER,name TEXT,mime TEXT,bytes INTEGER,r2key TEXT,view_key TEXT,source TEXT,session TEXT,turn TEXT,synced INTEGER DEFAULT 0,deleted INTEGER DEFAULT 0,pending INTEGER DEFAULT 0,src_path TEXT,tags TEXT,version INTEGER DEFAULT 1,prev_key TEXT,prev_bytes INTEGER);CREATE TABLE card_events(card TEXT,type TEXT,tool TEXT);CREATE TABLE turns(id TEXT PRIMARY KEY,at INTEGER NOT NULL);CREATE TABLE workflows(session TEXT,status TEXT);CREATE TABLE approvals(session TEXT,status TEXT)");
helpersInit(sql); userInputInit(sql);
const objects = new Map(), read = async b => typeof b === 'string' ? new TextEncoder().encode(b) : b instanceof Uint8Array ? b : new Uint8Array(await new Response(b).arrayBuffer());
const WS = { async put(k, b) { const bytes = await read(b); objects.set(k, bytes); return { size: bytes.length }; }, async get(k) { const bytes = objects.get(k); return bytes ? { size: bytes.length, arrayBuffer: async () => bytes.slice().buffer, text: async () => new TextDecoder().decode(bytes), body: new Response(bytes).body } : null; }, async head(k) { return objects.has(k) ? { size: objects.get(k).length } : null; }, async delete(ks) { for (const k of [].concat(ks)) objects.delete(k); } };
const emitted = [];
const R = Object.assign(Object.create(Resident.prototype), { sql, env: { DB, WS, DYNAMIC_ROUTING: 'on', ONEHELM_EE: '1hc', MODEL_SETTINGS: seedSettings(), COMPUTER: { idFromName: n => n, get: () => ({ prepJob: async ({ pages }) => ({ pages: pages.map(page => ({ page, md: 'OCR page ' + page })), ms: 1000 }) }) } },
  get(k) { return { tenant: 'test-tenant', channel: 'main' }[k]; }, ledger() { return { reserve: async () => ({ ok: true }), settle: async () => {} }; }, ctx: { waitUntil() {} }, sidecarKick() {}, async republishPages() { return ''; }, journalDelegation() {}, ...fileVersionsMethods });
R.fvInit(); initRoutingArtifacts(sql);
const SESSION = '00000000-0000-4000-8000-000000000001', DIR = '/workspace/workspace/helpers/29', SLUG = DIR + '/2026-ai-impact-report', enc = s => new TextEncoder().encode(s);
sql.exec("INSERT INTO helpers(id,session,name,task,status,started,deadline,dynamic_routing,required_delegation,round,handed) VALUES(29,?,'Build deck','task','awaiting_review',1,9999999999999,1,1,3,1)", SESSION);
const h = sql.exec('SELECT * FROM helpers WHERE id=29').one();
// The 14 files of the round-3 handoff (names, folders and sizes as recorded), the .html and .pptx also copied under a new name next to the folder.
const html = enc('<html>' + 'x'.repeat(200)), pptx = enc('PK' + 'y'.repeat(100));
const stage = (path, bytes) => stageRoutingFile(R, h, { path, bytes });
const copyHtml = await stage(`${DIR}/2026 AI Impact Report.html`, html), copyPptx = await stage(`${DIR}/2026 AI Impact Report.pptx`, pptx);
const folderHtml = await stage(`${SLUG}/2026-ai-impact-report.html`, html), folderPptx = await stage(`${SLUG}/2026-ai-impact-report.pptx`, pptx);
await stage(`${SLUG}/.src/deck.json`, enc('{}')); await stage(`${SLUG}/.src/gen_slides.py`, enc('print(1)')); await stage(`${SLUG}/.src/notes.json`, enc('[]')); await stage(`${SLUG}/.src/build/notes.json`, enc('[ ]'));
await stage(`${SLUG}/.src/make_deck.json`, enc(JSON.stringify({ ok: true, out: `${SLUG}/2026-ai-impact-report.html ${SLUG}/2026-ai-impact-report.pptx` })));
const tc = { session: SESSION, turn: 'review-b', routingReviewHelper: 29, kind: 'chat', orchestration: { review: 29 }, emit: e => emitted.push(e) };
const handoff = await collectRoutingFiles(R, h, tc);
assert.ok(handoff.files.length >= 8);
// 1. Helper-side facts: the exact calls the main helper made. A path was accepted nowhere before; now both calls attach the deck.
assert.deepEqual(resolveSelection(sql.exec('SELECT * FROM routing_artifacts').toArray(), [`${DIR}/2026 AI Impact Report.pptx`, `${DIR}/2026 AI Impact Report.html`]), [copyPptx.id, copyHtml.id]);
assert.deepEqual(resolveSelection(sql.exec('SELECT * FROM routing_artifacts').toArray(), ['2026-ai-impact-report.pptx', copyHtml.id.slice(0, 8)]), [folderPptx.id, copyHtml.id]);
// 2. A wrong reference is a tool result the review turn can act on, lists the held files with their IDs, and changes nothing.
const bad = await R.orchestrationTool('approve_subagent', { id: 29, files: ['/workspace/nothing/deck.pptx'] }, tc);
assert.match(bad, /^error: /); assert.ok(bad.includes(folderPptx.id) && bad.includes(copyHtml.id), 'the error lists the held file IDs');
assert.equal(sql.exec('SELECT status FROM helpers WHERE id=29').one().status, 'awaiting_review');
assert.equal(sql.exec("SELECT COUNT(*) n FROM routing_artifacts WHERE state='held'").one().n, handoff.files.length, 'nothing was attached or deleted');
assert.match(await R.orchestrationTool('approve_subagent', { id: 29, files: ['notes.json'] }, tc), /^error: /, 'a name used by two files is not guessed');
// 3. The run-3 call (paths of the renamed copies) approves; the identical deck files in the folder are not attached a second time.
const ok = await R.orchestrationTool('approve_subagent', { id: 29, files: [`${DIR}/2026 AI Impact Report.pptx`, `${DIR}/2026 AI Impact Report.html`] }, tc);
assert.match(ok, /approved/); assert.equal(sql.exec('SELECT status FROM helpers WHERE id=29').one().status, 'approved');
const attached = emitted.filter(e => e.t === 'file').map(e => e.file.name).sort();
assert.deepEqual(attached, ['2026 AI Impact Report.html', '2026 AI Impact Report.pptx']);
// 4. The other call of the run: only the folder .pptx by path, in a round where no copy exists. The folder's .html goes with it.
sql.exec("INSERT INTO helpers(id,session,name,task,status,started,deadline,dynamic_routing,required_delegation,round,handed) VALUES(32,?,'Deck two','t','awaiting_review',1,9999999999999,1,1,1,1)", SESSION);
const h32 = sql.exec('SELECT * FROM helpers WHERE id=32').one(), D2 = '/workspace/workspace/helpers/32/ai', st32 = (path, bytes) => stageRoutingFile(R, h32, { path, bytes });
await st32(`${D2}/ai.html`, enc('<html>two')); await st32(`${D2}/ai.pptx`, enc('PK two')); await st32(`${D2}/.src/make_deck.json`, enc(JSON.stringify({ ok: true, out: `${D2}/ai.html ${D2}/ai.pptx` })));
const tc32 = { ...tc, routingReviewHelper: 32, orchestration: { review: 32 } }; await collectRoutingFiles(R, h32, tc32); emitted.length = 0;
const ok2 = await R.orchestrationTool('approve_subagent', { id: 32, files: [`${D2}/ai.pptx`] }, tc32);
assert.match(ok2, /approved/); assert.deepEqual(emitted.filter(e => e.t === 'file').map(e => e.file.name).sort(), ['ai.html', 'ai.pptx']);
// 5. Calling approve without "files" on a round that has files and no deck does not delete them.
sql.exec("INSERT INTO helpers(id,session,name,task,status,started,deadline,dynamic_routing,required_delegation,round,handed) VALUES(30,?,'Plain','t','awaiting_review',1,9999999999999,1,1,1,1)", SESSION);
const h30 = sql.exec('SELECT * FROM helpers WHERE id=30').one(), r30 = await stageRoutingFile(R, h30, { path: '/workspace/workspace/helpers/30/report.pdf', bytes: enc('%PDF') });
const tc30 = { ...tc, routingReviewHelper: 30, orchestration: { review: 30 } }; await collectRoutingFiles(R, h30, tc30);
assert.match(await R.orchestrationTool('approve_subagent', { id: 30 }, tc30), /^error: .*needs "files"/);
assert.equal(sql.exec('SELECT state FROM routing_artifacts WHERE id=?', r30.id).one().state, 'held');
// 6. Status: a task whose worker returned and whose review has not started is working, not "Ready for you"; once the review turn has started and ended, or
// the person is asked something, it is not.
const view = Object.assign(Object.create(Resident.prototype), { sql, env: { DYNAMIC_ROUTING: 'on', ONEHELM_EE: '1hc' }, liveTurn: () => null, leftoverBrowserReview: () => false, resumingIn: () => false, nativeProgress: () => null, spendWaiting: () => false, helperCount: () => 0, pomoField: () => ({}), lnField: () => ({}), textsSessions: () => [], getRaw: () => null });
const row = { id: SESSION, title: 'AI report', updated: 1, created: 1 };
sql.exec("INSERT INTO helpers(id,session,name,task,status,started,deadline,dynamic_routing,required_delegation,round,handed) VALUES(31,'s31','w','t','awaiting_review',1,9999999999999,1,1,1,0)");
const s31 = { ...row, id: 's31' };
assert.equal(view.sessionView(s31).state, 'working', 'review not started yet');
sql.exec('UPDATE helpers SET handed=1 WHERE id=31'); assert.equal(view.sessionView(s31).state, 'ready', 'the review turn ran and ended without a result: nothing is pending');
sql.exec("UPDATE helpers SET handed=0 WHERE id=31"); sql.exec("UPDATE helpers SET status='failed' WHERE id=31"); assert.equal(view.sessionView(s31).state, 'ready', 'a failed worker is not work in progress');
console.log('PASS deck run 3 approval and status');
