// Deck run 6: a long impact figure ("3 days → 4 hours") must build in every template's project pattern, and a figure that cannot fit is refused with the one
// fix. Deterministic facts only: new_deck.mjs answers, the font width table, and the sizes written into the slide files. The make_deck.sh figure hint
// needs Chrome and playwright-core and runs only where both resolve.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const S = new URL('../src/skills/artifacts/scripts/', import.meta.url).pathname, T = new URL('../app-assets/deck-templates/', import.meta.url).pathname, work = mkdtempSync(join(tmpdir(), 'deck-run6-'));
const templates = readdirSync(T).filter((n) => existsSync(join(T, n, 'head.html')));
assert.equal(templates.length, 34);
const widths = JSON.parse(readFileSync(join(T, '_measure', 'figure-widths.json'), 'utf8')).templates;
assert.deepEqual(Object.keys(widths).sort(), templates, 'the figure width table covers every template');
const VALUES = ['3 days → 4 hours', '9 → 5 days', '$100K/yr', '1.7B+ impressions', '3 weeks → 24 hours', '14 → 4 steps'];
const entry = (impact) => ({ pattern: 'project', title: 'T', users: 'U', problem: 'p', built: 'b', impact });
const slides = [...VALUES.map((v) => entry([{ value: v, label: 'what it measures' }])),
  entry([{ value: VALUES[0], label: 'a' }, { value: VALUES[1], label: 'b' }]), entry([{ value: VALUES[2], label: 'a' }, { value: VALUES[3], label: 'b' }]),
  entry([{ value: VALUES[4], label: 'a' }, { value: VALUES[5], label: 'b' }]), entry([{ value: VALUES[4], label: 'a' }, { value: VALUES[0], label: 'b' }])];
const data = join(work, 'stress.json'); writeFileSync(data, JSON.stringify({ slides }));
const sizes = {};
for (const t of templates) {
  const r = spawnSync('node', [S + 'new_deck.mjs', join(work, t), '--template', t, '--title', 'T', '--data', data], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${t}: ${r.stdout.slice(-400)}`);
  const files = readdirSync(join(work, t, '.src', 'slides')).sort();
  sizes[t] = files.map((f) => [...readFileSync(join(work, t, '.src', 'slides', f), 'utf8').matchAll(/data-slot="stat\d"[^>]*font-size:(\d+)px/g)].map((m) => +m[1]));
  for (const px of sizes[t].flat()) assert.ok(px >= 40, `${t}: figure size ${px}px`);
}
// A template's own big number stays for a short figure and shrinks for a long one; the widest template styles shrink the most.
const one = (t) => sizes[t].slice(0, 6).map((a) => a[0]);
assert.ok(one('bold-poster')[0] < one('bold-poster')[1] && one('bold-poster')[0] < 120, 'a long figure is smaller than a short one in bold-poster: ' + one('bold-poster'));
// Two figures that cannot share the row are stacked (the impact row becomes a column), each with the whole column.
const stacked = templates.filter((t) => /data-slot="impact" style="[^"]*flex-direction:column/.test(readFileSync(join(work, t, '.src', 'slides', '10-project.html'), 'utf8')));
assert.ok(stacked.length >= 1, 'at least one template stacks the two longest figures');
// A figure that fits no way is refused with the fix: which entry, and how long a value fits.
const longData = join(work, 'long.json'); writeFileSync(longData, JSON.stringify({ slides: [entry([{ value: '3.14159265358979323846264338327950', label: 'waiting' }])] }));
const refused = spawnSync('node', [S + 'new_deck.mjs', join(work, 'long'), '--template', 'bold-poster', '--title', 'T', '--data', longData], { encoding: 'utf8' });
assert.equal(refused.status, 2); assert.match(refused.stdout, /Fix: in the \\"impact\\" entry whose \\"value\\" is \\"3.14159/); assert.match(refused.stdout, /shorten \\"value\\" to about \d+ characters/);
// make_deck.sh sizes a figure that was set too big by hand (needs Chrome).
const chrome = [process.env.ONEHC_CHROME, '/opt/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p));
// The deck scripts import "playwright-core" from their own folder, so the guard resolves it the same way (as test/skills-artifacts.test.mjs does).
const hasPlaywright = (() => { try { createRequire(join(S, 'browser_runtime.mjs')).resolve('playwright-core'); return true; } catch { return false; } })();
if (chrome && hasPlaywright) {
  const dir = join(work, 'hint'), hd = join(work, 'hint.json'); writeFileSync(hd, JSON.stringify({ slides: [entry([{ value: '3 days → 4 hours', label: 'report time' }])] }));
  assert.equal(spawnSync('node', [S + 'new_deck.mjs', dir, '--template', 'bold-poster', '--title', 'T', '--data', hd], { encoding: 'utf8' }).status, 0);
  const f = join(dir, '.src', 'slides', '01-project.html'); writeFileSync(f, readFileSync(f, 'utf8').replace(/(data-slot="stat1"[^>]*)font-size:\d+px/, '$1font-size:220px'));
  // A figure set too big by hand is sized by make_deck itself (deck run 7), so one run passes.
  const m = spawnSync('bash', [S + 'make_deck.sh', dir], { encoding: 'utf8', env: { ...process.env, ONEHC_CHROME: chrome } });
  assert.equal(m.status, 0, m.stdout); assert.match(m.stdout, /\nPASS: built /); assert.match(m.stdout, /1 impact figure\(s\) were wider than their place/);
}
console.log('deck-run6 ok');
