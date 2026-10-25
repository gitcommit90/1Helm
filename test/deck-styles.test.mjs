// Deck styles (deck-styles.js, scripts/build-deck-style-thumbs.mjs): app facts only, no model. Thumbnails for all 34 templates and the staleness check; a delivered
// HTML deck is tagged "deck" and a plain .html is not; the picker data; the helper tool and the transcript marker; and nothing stores a style.
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
const computer = { files: new Map(), async readFile(p) { const b = this.files.get('/workspace/' + p) || this.files.get(p); return b ? { ok: true, bytes: b } : { ok: false }; }, async fileToR2(path, key) { const b = this.files.get(path); if (!b) return { ok: false, error: 'missing ' + path }; await WS.put(key, b); return { ok: true, bytes: b.length }; } };
const SESSION = '00000000-0000-4000-8000-000000000001', DIR = '/workspace/workspace/helpers/41', SLUG = DIR + '/northwind-ai-impact-2026', enc = s => new TextEncoder().encode(s);
import test from 'node:test';
import { cpSync, existsSync, readdirSync, readFileSync as rf, writeFileSync as wf, mkdtempSync as mk, statSync, rmSync } from "node:fs";
import { DECK_STYLES_TOOL, deckStylesTool, turnHasDeckStyles } from '../src/deck-styles.js';
import { HELPER_ALLOWED } from '../src/helpers.js';
const ROOT = new URL('..', import.meta.url).pathname, OUTD = join(ROOT, 'app-assets/app-static/deck-styles'), TPL = join(ROOT, 'app-assets/deck-templates');
const index = JSON.parse(rf(join(OUTD, 'index.json'), 'utf8'));

test('the picker data lists every template with name, feel and two thumbnails, and the files are small', () => {
  const names = readdirSync(TPL).filter((n) => !n.startsWith('_') && existsSync(join(TPL, n, 'head.html'))).sort();
  assert.equal(names.length, 34); assert.deepEqual(index.templates.map((t) => t.name), names);
  let total = 0;
  for (const t of index.templates) {
    assert.ok(t.title && t.feel && t.use, t.name + ': title, feel and use'); assert.ok(['light', 'dark', 'mixed'].includes(t.scheme));
    for (const f of [t.cover, t.project]) { assert.match(f, /^[a-z0-9-]+-(cover|project)\.webp$/); const s = statSync(join(OUTD, f)).size; assert.ok(s > 1000 && s < 30000, f + ' ' + s); total += s; }
  }
  assert.ok(total < 700000, 'thumbnails total ' + total);
  let big = 0; for (const t of index.templates) for (const f of [t.coverLarge, t.projectLarge]) { assert.match(f, /^[a-z0-9-]+-(cover|project)-l\.webp$/); const s = statSync(join(OUTD, f)).size; assert.ok(s > 3000 && s < 90000, f + ' ' + s); big += s; }
  assert.ok(big < 2500000, 'large pictures total ' + big);
  assert.deepEqual(Object.keys(JSON.parse(spawnSync('node', [join(ROOT, 'scripts/build-deck-style-thumbs.mjs'), '--lines'], { encoding: 'utf8' }).stdout)).sort(), names, 'each template has its feel line in deck-templates.md');
});
test('the thumbnails check passes now and fails when a template changed after its thumbnails, or a picture is missing', () => {
  const chk = (out) => { const r = spawnSync('node', [join(ROOT, 'scripts/build-deck-style-thumbs.mjs'), '--check', ...(out ? ['--out', out] : [])], { encoding: 'utf8' }); return { status: r.status, text: r.stderr + r.stdout }; };
  assert.equal(chk().status, 0);
  const out = mk(join(tmpdir(), 'ds-thumbs-')); cpSync(OUTD, out, { recursive: true });
  const idx = JSON.parse(rf(join(out, 'index.json'), 'utf8')); idx.templates[0].hash = '0000000000000000'; wf(join(out, 'index.json'), JSON.stringify(idx));
  assert.match(chk(out).text, new RegExp(idx.templates[0].name + ': the template changed'));
  idx.templates[0].hash = index.templates[0].hash; wf(join(out, 'index.json'), JSON.stringify(idx)); rmSync(join(out, idx.templates[1].project));
  assert.match(chk(out).text, /project\.webp is missing/); assert.equal(chk(out).status, 1);
});

const SES = '00000000-0000-4000-8000-000000000001';
test('a delivered deck .html is tagged deck and a plain .html is not', async () => {
  const dir = '/workspace/workspace/q3-review', hp = `${dir}/q3-review.html`, pp = `${dir}/q3-review.pdf`;
  computer.files.set(hp, enc('<html>' + 'deck'.repeat(80))); computer.files.set(pp, enc('%PDF' + 'p'.repeat(90)));
  computer.files.set(`${dir}/.src/make_deck.json`, enc(JSON.stringify({ ok: true, out: `${hp} ${pp}` })));
  const seen = [], ctx = { session: SES, emit: (e) => seen.push(e) };
  for (const f of [hp, pp]) computer.files.set(f.replace('/workspace/', ''), computer.files.get(f));
  await R.shareFile({ path: 'workspace/q3-review/q3-review.html' }, ctx); await R.shareDeckFiles({ path: 'workspace/q3-review/q3-review.html' }, ctx);
  const rows = sql.exec("SELECT name, tags FROM files WHERE deleted=0 ORDER BY name").toArray();
  assert.deepEqual(rows.map((r) => [r.name, JSON.parse(r.tags || '[]')]), [['q3-review.html', ['deck']], ['q3-review.pdf', []]]);
  assert.ok(seen.some((e) => e.t === 'file' && e.file.name === 'q3-review.html' && e.file.tags.includes('deck')), 'the card is re-sent with the tag');
  computer.files.set('files/page.html', enc('<html>' + 'plain page'.repeat(30)));
  await R.shareFile({ path: 'files/page.html' }, ctx); await R.shareDeckFiles({ path: 'files/page.html' }, ctx);
  assert.deepEqual(JSON.parse(sql.exec("SELECT tags FROM files WHERE name='page.html'").one().tags || '[]'), [], 'a web page is not a deck');
  assert.equal(R.listFiles ? (await R.listFiles()).find((f) => f.name === 'q3-review.html').tags[0] : 'deck', 'deck');
});
test('the helper tool puts the picker in the chat for a chat turn only, helpers never get it, and the transcript marks the turn', () => {
  const seen = []; assert.match(deckStylesTool({ kind: 'chat', turn: 't1', emit: (e) => seen.push(e) }), /sees a card/); assert.deepEqual(seen, [{ t: 'deck_styles' }]);
  assert.match(deckStylesTool({ kind: 'workflow', emit: (e) => seen.push(e) }), /^error/); assert.equal(seen.length, 1);
  assert.equal(DECK_STYLES_TOOL.function.name, 'show_deck_styles'); assert.ok(!HELPER_ALLOWED.has('show_deck_styles'));
  assert.ok(R.tools().some((t) => t.function.name === 'show_deck_styles'));
  assert.equal(turnHasDeckStyles([{ tool: 'run_command' }, { tool: 'show_deck_styles' }]), true); assert.equal(turnHasDeckStyles([{ tool: 'run_command' }]), false);
});
test('no code stores a style preference: nothing pins a channel or default style', () => {
  const code = rf(join(ROOT, 'src/deck-styles.js'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /\.sql\b|\bkv\b|\.put\(|getRaw|localStorage|tagFile|INSERT|UPDATE/, 'deck-styles.js writes nothing');
  assert.deepEqual(DECK_STYLES_TOOL.function.parameters.properties, {}, 'the tool takes no style');
  const t = JSON.stringify(DECK_STYLES_TOOL); assert.doesNotMatch(t, /remember|default style|always use/i);
  for (const f of readdirSync(join(ROOT, 'src')).filter((x) => /deck/.test(x) && x.endsWith('.js'))) assert.doesNotMatch(rf(join(ROOT, 'src', f), 'utf8'), /(style|template)_pref|default_template|preferred_template/i, f);
});
