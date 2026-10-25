// Deck run 7: a data file whose project entries have no "pattern" key builds (the pattern follows from the fields), every data problem names its slide instead
// of printing the usage line, and impact figures are sized for any deck however its slide files were written (a data file or the sample's markup filled by hand).
// Deterministic facts only. The make_deck.sh runs need Chrome and playwright-core and run only where both resolve.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const S = new URL('../src/skills/artifacts/scripts/', import.meta.url).pathname, work = mkdtempSync(join(tmpdir(), 'deck-run7-'));
const run = (args) => spawnSync('node', [S + 'new_deck.mjs', ...args], { encoding: 'utf8' });
const T = ['--template', 'blue-professional', '--title', 'T'];
const wr = (name, o) => { const f = join(work, name); writeFileSync(f, JSON.stringify(o)); return f; };

// A synthetic deck of the run's shape: a cover, 32 projects with no "pattern" key and long figures, a media slide, a closing.
const FIG = ['Days → seconds', 'Daily use', '3 wks → 24 hrs', '< 1 week', '~75 hrs/yr', '3 days → 4 hours', 'Multi-six-figure', '9 → 5 days'];
const project = (i) => ({ title: `Project ${i + 1} working title`, users: `Group ${i + 1}, ${20 + i} people`, problem: 'Reports took long to prepare by hand and had errors.', built: 'A small tool that gathers the inputs and drafts the report.',
  impact: [{ value: FIG[i % 8], label: 'time to finish' }, ...(i % 3 === 0 ? [{ value: FIG[(i + 3) % 8], label: 'how often' }] : [])], notes: 'n' });
const slides = [{ pattern: 'cover', text: ['2026', 'Impact report', 'Synthetic', 'Team'] }, ...Array.from({ length: 32 }, (_, i) => project(i)), { title: 'Pictured', body: 'Words', drop: 'a picture' }, { pattern: 'closing', text: ['Thanks', 'Questions', 'a', 'b'] }];
const dataFile = wr('run.json', { slides });

// 1. No "pattern" on project and media entries: the fields decide.
const a = run([join(work, 'a'), ...T, '--data', dataFile]);
assert.equal(a.status, 0, a.stdout);
const ids = JSON.parse(readFileSync(join(work, 'a', '.src', 'deck.json'), 'utf8')).slides.map((s) => s.id);
assert.equal(ids.length, 35); assert.equal(ids[1], '02-project'); assert.equal(ids[33], '34-media'); assert.equal(ids[34], '35-closing');
assert.match(readFileSync(join(work, 'a', '.src', 'slides', '02-project.html'), 'utf8'), /Group 1, 20 people/);

// 2. Data problems name the slide and never print the bare usage line.
const bad = (name, o, want) => { const r = run([join(work, name), ...T, '--data', wr(name + '.json', o)]); assert.equal(r.status, 2, name); assert.doesNotMatch(r.stdout, /usage:/, name); assert.match(r.stdout, want, name + ': ' + r.stdout); return r.stdout; };
const amb = bad('amb', { slides: [{ pattern: 'cover', text: ['a', 'b', 'c', 'd'] }, { title: 'Only a title' }] }, /slide 2 has no \\"pattern\\"/);
assert.match(amb, /It could be: media, project/); assert.match(amb, /Add \\"pattern\\"/);
bad('textonly', { slides: [{ text: ['a'] }] }, /slide 1 has no \\"pattern\\".*It could be: media, project, cover/);
bad('empty', { slides: [] }, /no slides/);
bad('notlist', { slides: { a: 1 } }, /\\"slides\\" list/);
bad('notobj', { slides: [{ pattern: 'cover', text: ['a', 'b', 'c', 'd'] }, 'project'] }, /slide 2 of the data file is not an object/);
const unk = run([join(work, 'unk'), ...T, '--data', wr('unk.json', { slides: [{ pattern: 'cover', text: ['a', 'b', 'c', 'd'] }, { pattern: 'project', title: 'x', kicker: 'y' }] })]);
assert.equal(unk.status, 0, unk.stdout); assert.match(unk.stdout, /note: slide 2 field "kicker" isn't a slot in the "project" pattern, so it was left out/);
assert.doesNotMatch(readFileSync(join(work, 'unk', '.src', 'slides', '02-project.html'), 'utf8'), /kicker/);
bad('badimpact', { slides: [{ pattern: 'project', impact: '42%' }] }, /slide 1: \\"impact\\" must be a list of/);
bad('badtitle', { slides: [{ pattern: 'media', title: 5 }] }, /slide 1: \\"title\\" must be a string/);
bad('badnotes', { slides: [{ pattern: 'media', title: 't', notes: ['x'] }] }, /slide 1: \\"notes\\" must be one string/);
bad('nopat', { slides: [{ pattern: 'nope', title: 'x' }] }, /slide 1: this template has no slide pattern \\"nope\\"/);
const nt = run([join(work, 'nt'), '--title', 'T', '--data', dataFile]); assert.equal(nt.status, 2); assert.match(nt.stdout, /no template/); assert.doesNotMatch(nt.stdout, /usage:/);
const ns = run([join(work, 'ns'), ...T]); assert.equal(ns.status, 2); assert.match(ns.stdout, /no slides/); assert.doesNotMatch(ns.stdout, /usage:/);

// 3. Figures of a deck written by hand: the skeletons filled with long figures and no sizing. deck_repair --figures (no browser) sizes them like new_deck does.
const skel = join(work, 'skel');
assert.equal(run([skel, ...T, '--slides', 'cover,' + 'project,'.repeat(32) + 'closing']).status, 0);
const set = (h, slot, t) => h.replace(new RegExp(`(<(\\w+)[^>]*data-slot="${slot}"[^>]*>)[\\s\\S]*?(</\\2>)`), (m, x, _t, c) => x + t + c);
readdirSync(join(skel, '.src', 'slides')).sort().forEach((f, k) => {
  if (!/project/.test(f)) return;
  const e = slides[k], file = join(skel, '.src', 'slides', f); let h = readFileSync(file, 'utf8');
  h = set(h, 'title', e.title); e.impact.forEach((x, n) => { h = set(h, 'stat' + (n + 1), x.value); h = set(h, `stat${n + 1}_label`, x.label); });   // a raw "<" in "< 1 week", as a hand-written file has it
  if (e.impact.length < 2) h = h.replace(/<div data-slot="stat2-box"[\s\S]*?<\/div>/, '');
  writeFileSync(file, h);
});
const px = (dir) => readdirSync(join(dir, '.src', 'slides')).sort().flatMap((f) => [...readFileSync(join(dir, '.src', 'slides', f), 'utf8').matchAll(/data-slot="stat\d"[^>]*font-size:(\d+)px/g)].map((m) => +m[1]));
assert.ok(px(skel).every((n) => n === 120), 'the hand-filled figures start at the sample size');
const f1 = JSON.parse(spawnSync('node', [S + 'deck_repair.mjs', skel, '--figures'], { encoding: 'utf8' }).stdout);
assert.equal(f1.ok, true, JSON.stringify(f1.problems)); assert.ok(f1.figures.length >= 20, 'figures were set smaller: ' + f1.figures.length);
assert.ok(px(skel).every((n) => n >= 40 && n <= 120), 'sizes keep the floor: ' + px(skel).join());
// The sizes are the ones --data gives the same figures (same rules), so a data-file deck and a hand-filled deck agree.
const dsz = px(join(work, 'a')), hsz = px(skel); assert.equal(hsz.length, dsz.length); assert.deepEqual(hsz, dsz);
// Run again: nothing changes (figures that fit are left alone).
const f2 = JSON.parse(spawnSync('node', [S + 'deck_repair.mjs', skel, '--figures'], { encoding: 'utf8' }).stdout); assert.deepEqual(f2.figures, []);
// A figure that fits no size is named with its slide, field and a doable length.
const sf = join(skel, '.src', 'slides', '02-project.html'); writeFileSync(sf, set(readFileSync(sf, 'utf8'), 'stat1', 'Unbroken'.repeat(14)));
const f3 = JSON.parse(spawnSync('node', [S + 'deck_repair.mjs', skel, '--figures'], { encoding: 'utf8' }).stdout);
assert.equal(f3.ok, false); assert.equal(f3.problems[0].slide, 2); assert.equal(f3.problems[0].slot, 'impact 1'); assert.ok(f3.problems[0].chars > 3 && f3.problems[0].chars < 112);

// 4. One make_deck run passes on both paths (needs Chrome).
const chrome = [process.env.ONEHC_CHROME, '/opt/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p));
const hasPlaywright = (() => { try { createRequire(join(S, 'browser_runtime.mjs')).resolve('playwright-core'); return true; } catch { return false; } })();
if (chrome && hasPlaywright) {
  const env = { ...process.env, ONEHC_CHROME: chrome }, times = {};
  // The skeleton deck is rebuilt (the figure check above left one slide unfit) and filled again, so make_deck does the sizing itself.
  const skel2 = join(work, 'skel2');
  assert.equal(run([skel2, ...T, '--slides', 'cover,' + 'project,'.repeat(32) + 'closing']).status, 0);
  readdirSync(join(skel2, '.src', 'slides')).sort().forEach((f, k) => {
    const file = join(skel2, '.src', 'slides', f); let h = readFileSync(file, 'utf8');
    if (/project/.test(f)) { const e = slides[k]; h = set(h, 'title', e.title); h = set(h, 'label', e.users); h = set(h, 'problem', e.problem); h = set(h, 'built', e.built); e.impact.forEach((x, n) => { h = set(h, 'stat' + (n + 1), x.value); h = set(h, `stat${n + 1}_label`, x.label); }); if (e.impact.length < 2) h = h.replace(/<div data-slot="stat2-box"[\s\S]*?<\/div>/, ''); }
    else { let i = 0; h = h.replace(/>([^<>]+)</g, (m, s) => (s.trim() ? `>Word ${++i}<` : m)); }
    writeFileSync(file, h);
  });
  for (const [name, dir] of [['data', join(work, 'a')], ['hand-filled', skel2]]) {
    const t0 = Date.now(), m = spawnSync('bash', [S + 'make_deck.sh', dir], { encoding: 'utf8', env, timeout: 280000 }); times[name] = Math.round((Date.now() - t0) / 1000);
    assert.equal(m.status, 0, `${name}: ${m.stdout.slice(-900)}`); assert.match(m.stdout, /\nPASS: built /);
  }
  console.log('make_deck seconds (no pdf, no pptx)', JSON.stringify(times));
}
console.log('deck-run7 ok');
