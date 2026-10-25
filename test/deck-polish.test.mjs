// Deck polish: the same deck must not reach the person twice, and an impact figure must read alone. Deterministic facts only: Library rows, emitted file
// cards, names and bytes, and new_deck.mjs answers. No browser and no model.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const SESSION = '00000000-0000-4000-8000-000000000001', DIR = '/workspace/workspace/helpers/41', SLUG = DIR + '/northwind-ai-impact-2026', enc = s => new TextEncoder().encode(s);
const library = () => sql.exec("SELECT name FROM files WHERE deleted=0 ORDER BY name").toArray().map(r => r.name);
const html = enc('<html>' + 'deck'.repeat(60)), pptx = enc('PK' + 'p'.repeat(90));
// 1. Run 5: the worker copied the deck to a readable name and the reviewer named only the .pptx copy. The build's .html is attached under the readable
// name, the unselected copy is deleted, and the Library holds each file once.
sql.exec("INSERT INTO helpers(id,session,name,task,status,started,deadline,dynamic_routing,required_delegation,round,handed) VALUES(41,?,'Build deck','task','awaiting_review',1,9999999999999,1,1,1,1)", SESSION);
const h = sql.exec('SELECT * FROM helpers WHERE id=41').one();
const stage = (path, bytes) => stageRoutingFile(R, h, { path, bytes });
await stage(`${DIR}/2026 AI Impact Report.html`, html); const copyPptx = await stage(`${DIR}/2026 AI Impact Report.pptx`, pptx);
await stage(`${SLUG}/northwind-ai-impact-2026.html`, html); await stage(`${SLUG}/northwind-ai-impact-2026.pptx`, pptx);
await stage(`${SLUG}/.src/make_deck.json`, enc(JSON.stringify({ ok: true, out: `${SLUG}/northwind-ai-impact-2026.html ${SLUG}/northwind-ai-impact-2026.pptx` })));
const tc = { session: SESSION, turn: 'review-1', routingReviewHelper: 41, kind: 'chat', orchestration: { review: 41 }, emit: e => emitted.push(e) };
await collectRoutingFiles(R, h, tc);
assert.match(await R.orchestrationTool('approve_subagent', { id: 41, files: [copyPptx.id] }, tc), /approved/);
assert.deepEqual(library(), ['2026 AI Impact Report.html', '2026 AI Impact Report.pptx'], 'one card for each file, named as the person would name them');
// 2. share_file of the same bytes under the readable name, and a /workspace/files copy, add nothing (the run-5 second card).
sql.exec("UPDATE files SET source='helper'");
computer.files.set('files/2026 AI Impact Report.html', html);
const before = sql.exec("SELECT id FROM files WHERE name='2026 AI Impact Report.html'").one().id;
const said = await R.shareFile({ path: 'files/2026 AI Impact Report.html', name: '2026 AI Impact Report.html', copy: true }, { session: SESSION, emit: e => emitted.push(e) });
assert.equal(library().length, 3, 'copy: true on purpose still adds a file: ' + said); sql.exec("DELETE FROM files WHERE name='2026 AI Impact Report (2).html'");
computer.files.set('files/copy of deck.html', html);
const said2 = await R.shareFile({ path: 'files/copy of deck.html', name: 'Executive deck.html' }, { session: SESSION, emit: e => emitted.push(e) });
assert.match(said2, /already shared/); assert.deepEqual(library(), ['2026 AI Impact Report.html', '2026 AI Impact Report.pptx']);
assert.equal(sql.exec("SELECT id FROM files WHERE name='2026 AI Impact Report.html'").one().id, before);
// different bytes under the same extension is a new file
computer.files.set('files/other.html', enc('<html>other'));
await R.shareFile({ path: 'files/other.html' }, { session: SESSION, emit() {} }); assert.equal(library().length, 3);
// 3. The Library save-back of a file under /workspace/files that has the same bytes as a deck file adds no row, and the build's name gives way to the readable one.
sql.exec("DELETE FROM files WHERE name='other.html'");
sql.exec("UPDATE files SET name='northwind-ai-impact-2026.pptx' WHERE name='2026 AI Impact Report.pptx'");
computer.files.set('files/2026 AI Impact Report.pptx', pptx);
const saved = await saveBack(R, ['2026 AI Impact Report.pptx'], new Map([['2026 AI Impact Report.pptx', '1 1']]), { session: SESSION, emit: e => emitted.push(e) });
assert.deepEqual(saved.failed, []); assert.deepEqual(library(), ['2026 AI Impact Report.html', '2026 AI Impact Report.pptx']);
// 4. Impact figures read alone: a split figure is refused with the fix, a whole figure builds and a long one gets a smaller size.
const S = new URL('../src/skills/artifacts/scripts/', import.meta.url).pathname, work = mkdtempSync(join(tmpdir(), 'deck-polish-'));
const deck = (impact, name) => { const data = join(work, name + '.json'); writeFileSync(data, JSON.stringify({ slides: [{ pattern: 'project', title: 'T', users: 'U', problem: 'p', built: 'b', impact }] })); return spawnSync('node', [S + 'new_deck.mjs', join(work, name), '--template', 'emerald-editorial', '--title', 'T', '--data', data], { encoding: 'utf8' }); };
for (const [i, impact] of [[0, [{ value: '3 days', label: 'to 4 hours: report time cut' }]], [1, [{ value: '9 to 5', label: 'days: close shortened' }]], [2, [{ value: '2.4', label: 'times: reported hazards up' }]], [3, [{ value: '3 days to', label: 'report time' }]], [4, [{ value: 'days', label: 'report time' }]]]) {
  const r = deck(impact, 'bad' + i); assert.equal(r.status, 2, JSON.stringify(impact) + r.stdout); assert.match(r.stdout, /impact/);
}
const okd = deck([{ value: '3 days → 4 hours', label: 'report time' }, { value: '2.4×', label: 'reported hazards' }], 'ok'); assert.equal(okd.status, 0, okd.stdout + okd.stderr);
const slide = (await import('node:fs')).readFileSync(join(work, 'ok', '.src', 'slides', '01-project.html'), 'utf8');
assert.match(slide, /data-slot="stat1"[^>]*font-size:(\d+)px/); const px1 = +slide.match(/data-slot="stat1"[^>]*font-size:(\d+)px/)[1], px2 = +slide.match(/data-slot="stat2"[^>]*font-size:(\d+)px/)[1];
assert.ok(px1 < 120 && px1 === px2, 'both figures use one smaller size'); assert.ok(slide.includes('3\u00a0days\u00a0→ 4\u00a0hours'), 'a before and after wraps only at the arrow');
const shortFig = deck([{ value: '38%', label: 'first response' }], 'short'); assert.equal(shortFig.status, 0);
assert.match((await import('node:fs')).readFileSync(join(work, 'short', '.src', 'slides', '01-project.html'), 'utf8'), /data-slot="stat1"[^>]*font-size:120px/, 'a short figure keeps the template size');
// 5. The editable PowerPoint: a one-line title is placed by the HTML's baseline (not centred on the HTML's taller line box), and the empty picture box's
// label and frame use the template's colours and read on its background.
import { mkdirSync } from 'node:fs';
const pp = join(work, 'pp'); mkdirSync(join(pp, '.src', 'build'), { recursive: true });
writeFileSync(join(pp, '.src', 'build', 'pptx.json'), JSON.stringify({ title: 'T', slides: [{ notes: '', items: [
  { type: 'rect', x: 0, y: 0, w: 1920, h: 1080, fill: '#3cd896', line: null, radius: 0, rot: 0 },
  { type: 'text', x: 600, y: 177, w: 700, h: 281, base: 454, maxw: 700, rot: 0, align: 'left', lh: 169, lines: 1, runs: [{ t: '2026 AI', font: 'Bodoni Moda', px: 184, color: '#0f1a5c', bold: true }] },
  { type: 'media', x: 916, y: 96, w: 908, h: 888, label: 'Screenshot or GIF goes here', color: '#0f1a5c', frame: '#0f1a5c', bg: '#3cd896' }] }] }));
const built = spawnSync('python3', ['-I', S + 'build_pptx.py', pp], { encoding: 'utf8' }); assert.equal(built.status, 0, built.stderr);
const readPptx = spawnSync('python3', ['-I', '-c', `
import sys, json
from pptx import Presentation
prs = Presentation(sys.argv[1]); out = {}
for sh in prs.slides[0].shapes:
    if sh.has_text_frame and sh.text_frame.text.strip():
        r = sh.text_frame.paragraphs[0].runs[0]
        out[sh.text_frame.text.strip()] = {"top": sh.top / 6350, "color": str(r.font.color.rgb) if r.font.color and r.font.color.type else None}
print(json.dumps(out))`, join(pp, 'pp.pptx')], { encoding: 'utf8' }); assert.equal(readPptx.status, 0, readPptx.stderr);
const shapes = JSON.parse(readPptx.stdout);
assert.ok(Math.abs(shapes['2026 AI'].top - (454 - 0.96 * 184)) < 1, 'the title box top follows the baseline: ' + shapes['2026 AI'].top);
assert.equal(shapes['Screenshot or GIF goes here'].color, '0F1A5C', 'the label uses the template colour, not a fixed grey');
console.log('PASS deck polish');
