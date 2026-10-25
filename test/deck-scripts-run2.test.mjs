// Deck scripts: a relative project folder, a removed piece takes its empty pill with it, playwright-core is found when a script was
// copied elsewhere, the PASS line is last, and the PDF hides navigation. Deterministic facts only; no model, no browser for the first four.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const S = new URL('../src/skills/artifacts/scripts/', import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), 'deck-run2-'));
// 1. new_deck with a relative folder and a relative --data file, and a closing slide whose small pieces are "".
const ends = JSON.parse(readFileSync(new URL('../app-assets/deck-templates/blue-professional/ends.json', import.meta.url)));
const listing = execFileSync('node', [S + 'new_deck.mjs', '--patterns', 'blue-professional'], { encoding: 'utf8' });
const n = Number(listing.split(`The closing slide is the "${ends.closing}" pattern. Its `)[1].split(' ')[0]);
const texts = Array.from({ length: n }, (_, i) => (i === 0 ? 'Thank you' : ''));
mkdirSync(join(work, 'w'));
writeFileSync(join(work, 'w', 'd.json'), JSON.stringify({ slides: [{ pattern: ends.closing, text: texts }] }));
const r = spawnSync('node', [S + 'new_deck.mjs', 'deck1', '--template', 'blue-professional', '--title', 'T', '--data', 'd.json'], { cwd: join(work, 'w'), encoding: 'utf8' });
assert.equal(r.status, 0, r.stdout + r.stderr);
const slide = readFileSync(join(work, 'w', 'deck1', '.src', 'slides', `01-${ends.closing}.html`), 'utf8');
assert.match(slide, /Thank you/);
assert.doesNotMatch(slide, /cta-btn|closing-contact/, 'the empty pill and the empty contact line are gone');
// 2. make_deck.sh with a folder that does not exist ends with a FAIL line, not a usage message.
const m = spawnSync('bash', [S + 'make_deck.sh', 'no-such-folder'], { cwd: work, encoding: 'utf8' });
assert.equal(m.status, 2); assert.match(m.stdout.trim().split('\n').at(-1), /^FAIL/);
// 3. A copied script finds playwright-core at the place the computer installs it.
const copy = join(work, 'copied'); cpSync(S, copy, { recursive: true });
const probe = join(work, 'probe.mjs');
writeFileSync(probe, `import { loadPlaywright } from ${JSON.stringify(join(copy, 'browser_runtime.mjs'))}; const p = await loadPlaywright(); console.log(typeof p.chromium.launch);`);
const pw = ['/workspace/node_modules/playwright-core', new URL('../node_modules/playwright-core', import.meta.url).pathname].find(existsSync);
if (pw) assert.equal(execFileSync('node', [probe], { encoding: 'utf8', env: { ...process.env, ONEHC_PLAYWRIGHT: pw } }).trim(), 'function');
// 4. The shell script prints PASS last and the slide text before it.
const sh = readFileSync(S + 'make_deck.sh', 'utf8');
assert.ok(sh.lastIndexOf('PASS:') > sh.lastIndexOf('readback.txt'), 'the read-back comes before the PASS line');
assert.match(sh.trimEnd().split('\n').at(-1), /PASS:/);
// 5. The PDF export hides navigation for every template (the function is applied before each page is printed).
assert.match(readFileSync(S + 'deck_check.mjs', 'utf8'), /hideNavigation\(page\)[\s\S]*page\.pdf\(/);
console.log('PASS deck scripts run2');
