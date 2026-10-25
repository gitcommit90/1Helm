// A change figure's arrow and colour follow the deck's data: "trend" in a --data entry, or a leading + or - in the figure's words, and neutral otherwise.
// The sample slides no longer carry a red or green state. Deterministic facts only; the make_deck run needs Chrome and playwright-core.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const S = new URL('../src/skills/artifacts/scripts/', import.meta.url).pathname, T = new URL('../app-assets/deck-templates/', import.meta.url).pathname, work = mkdtempSync(join(tmpdir(), 'deck-trend-'));
const run = (args) => spawnSync('node', [S + 'new_deck.mjs', ...args], { encoding: 'utf8' });
const pieces = (t, f) => [...readFileSync(`${T}${t}/slides/${f}.html`, 'utf8').matchAll(/>([^<>]+)</g)].map((m) => m[1].replace(/\s+/g, ' ').trim()).filter(Boolean);
const build = (name, template, entry) => { const d = join(work, name), f = join(work, name + '.json'); writeFileSync(f, JSON.stringify({ slides: [entry] })); const r = run([d, '--template', template, '--title', 'T', '--data', f]); return { r, html: () => readFileSync(join(d, '.src', 'slides', readdirSync(join(d, '.src', 'slides'))[0]), 'utf8') }; };
const trends = (h) => [...h.matchAll(/data-trend="([^"]*)"/g)].map((m) => m[1]);
const changed = (t, f) => pieces(t, f).map((x) => x + ' (new)');

// 1. No sample slide marks a figure good or bad: no red or green class or word on a change figure.
for (const [t, f] of [['blue-professional', '03-metrics'], ['cobalt-grid', '07-table'], ['retro-windows', '04-chart'], ['retro-windows', '07-line-chart']]) {
  const h = readFileSync(`${T}${t}/slides/${f}.html`, 'utf8');
  assert.ok(trends(h).length >= 3, `${t}/${f} marks its change figures with data-trend`);
  assert.ok(trends(h).every((v) => /^(up|down|flat)$/.test(v)), `${t}/${f}: direction only, no good or bad`);
  assert.doesNotMatch(h, /\b(positive|negative)\b|&uarr;|&darr;|&#9650;|&#9660;/, `${t}/${f} has no baked-in state`);
  for (const m of h.matchAll(/<\w+[^>]*data-trend="[^"]*"[^>]*>/g)) assert.doesNotMatch(m[0], /text-green|text-red/, `${t}/${f}: a change figure has no colour class`);
}

// 2. With no "trend" the direction follows the sign in the figure's words and the tone stays empty (the blue sample's third card was always red).
const text = changed('blue-professional', '03-metrics').map((x) => /pts vs\. prior quarter/.test(x) ? '' : x);
const chg = text.map((x, i) => i).filter((i) => text[i] === '');
const words = ['+12% vs. last year', '-8% vs. last year', '12% vs. last year'];
chg.forEach((i, k) => { text[i] = words[k]; });
const unset = build('unset', 'blue-professional', { pattern: 'metrics', text });
assert.equal(unset.r.status, 0, unset.r.stdout);
assert.deepEqual(trends(unset.html()), ['up', 'down', '']);
assert.doesNotMatch(unset.html(), /\b(good|bad)\b"/);

// 3. "trend" sets direction and tone for each figure, a single string applies to all, "none" removes the marker.
const given = build('given', 'blue-professional', { pattern: 'metrics', text, trend: ['up good', 'down bad', 'flat'] });
assert.deepEqual(trends(given.html()), ['up good', 'down bad', 'flat']);
const all = build('all', 'blue-professional', { pattern: 'metrics', text, trend: 'up' });
assert.deepEqual(trends(all.html()), ['up', 'up', 'up']);
const none = build('none', 'blue-professional', { pattern: 'metrics', text, trend: ['none', 'up', 'down good'] });
assert.deepEqual(trends(none.html()), ['', 'up', 'down good']);
// Tone alone keeps the direction from the sign.
assert.deepEqual(trends(build('tone', 'blue-professional', { pattern: 'metrics', text, trend: ['good', '', ''] }).html()), ['up good', 'down', '']);

// 4. Other templates follow the same field.
const cob = build('cobalt', 'cobalt-grid', { pattern: 'table', text: changed('cobalt-grid', '07-table'), trend: ['down', 'up', 'flat', 'none', 'up', 'up', 'down', 'up'] });
assert.equal(cob.r.status, 0, cob.r.stdout); assert.deepEqual(trends(cob.html()), ['down', 'up', 'flat', '', 'up', 'up', 'down', 'up']);
const ret = build('retro', 'retro-windows', { pattern: 'line-chart', text: changed('retro-windows', '07-line-chart').map((x) => x.length < 12 ? x.replace(' (new)', '') : x), trend: ['up good', 'down bad', 'flat', 'none'] });
assert.equal(ret.r.status, 0, ret.r.stdout); assert.deepEqual(trends(ret.html()), ['up good', 'down bad', 'flat', '']);

// 5. Bad input names the field: an unknown word, too many entries, a pattern with no change figures.
const bad = (name, tpl, e, want) => { const b = build(name, tpl, e); assert.equal(b.r.status, 2, name); assert.match(b.r.stdout, want, name); };
bad('word', 'blue-professional', { pattern: 'metrics', text, trend: ['sideways'] }, /\\"trend\\" has \\"sideways\\"/);
bad('many', 'blue-professional', { pattern: 'metrics', text, trend: ['up', 'up', 'up', 'up'] }, /4 entries and the \\"metrics\\" pattern has 3 change figures/);
bad('nofig', 'blue-professional', { pattern: 'cover', text: ['a', 'b', 'c', 'd'], trend: ['up'] }, /no change figures/);

// 6. --patterns and --show say which patterns take "trend".
assert.match(run(['--patterns', 'blue-professional']).stdout, /metrics\s+\[trend: 3 change figures/);
assert.match(run(['--show', 'blue-professional', 'metrics']).stdout, /\[trend: 3 change figures.*colour stays neutral/);
assert.match(readFileSync(new URL('../src/skills/artifacts/references/presentation.md', import.meta.url), 'utf8'), /"trend": \["up", "down", "flat" or "none"/);

// 7. Chrome: the arrow and colour render from the data (up good is green, down bad is red, unset is the page's own text colour).
const chrome = [process.env.ONEHC_CHROME, '/opt/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p));
const hasPlaywright = (() => { try { createRequire(join(S, 'browser_runtime.mjs')).resolve('playwright-core'); return true; } catch { return false; } })();
if (chrome && hasPlaywright) {
  const css = readFileSync(`${T}blue-professional/head.html`, 'utf8');
  assert.match(css, /\.metric-change\[data-trend~="good"\] \{ color: #059669/); assert.match(css, /\.metric-change\[data-trend~="bad"\] \{ color: #dc2626/);
  const m = spawnSync('bash', [S + 'make_deck.sh', join(work, 'unset')], { encoding: 'utf8', env: { ...process.env, ONEHC_CHROME: chrome }, timeout: 280000 });
  assert.equal(m.status, 0, m.stdout.slice(-900)); assert.match(m.stdout, /\nPASS: built /);
}
console.log('deck-trend ok');
