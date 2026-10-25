// Deck build (run 3, changed by deck-ours): a deck of any length starts from --slides or --data, and a slide file changed by hand is built like any other.
// make_deck.sh no longer refuses hand edits, and the first PASS still removes the data-file record. Deterministic facts only; no browser and no model.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const S = new URL('../src/skills/artifacts/scripts/', import.meta.url).pathname, work = mkdtempSync(join(tmpdir(), 'deck-run3-'));
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', cwd: work });
const slides = [{ pattern: 'cover', text: ['2026 AI', 'Report', 'Northwind', '2026'] }, ...Array.from({ length: 12 }, (_, i) => ({ pattern: 'project', title: `Project ${i + 1}`, users: 'Supply Chain', problem: 'Late', built: 'Model', impact: [{ value: '31%', label: 'fewer' }], notes: `n${i}` })), { pattern: 'closing', text: ['Thank you', '', '', ''] }];
const P = join(work, 'deck'), data = join(work, 'slides.json'); writeFileSync(data, JSON.stringify({ slides }));
// 1. Eleven slides from --slides are accepted, and so is the same count from --data, which leaves only the record of its data file.
const skeleton = run('node', [S + 'new_deck.mjs', join(work, 'long'), '--template', 'blue-professional', '--title', 'T', '--slides', 'cover,' + 'project,'.repeat(9) + 'closing']);
assert.equal(skeleton.status, 0, skeleton.stdout); assert.ok(existsSync(join(work, 'long', '.src', 'deck.json')));
const made = run('node', [S + 'new_deck.mjs', P, '--template', 'blue-professional', '--title', 'T', '--data', data]);
assert.equal(made.status, 0, made.stdout + made.stderr);
assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(P, '.src', 'data_build.json'), 'utf8'))), ['data']);
// 2. A slide file and notes.json changed by hand are not refused: the build goes on to assemble the deck.
const f = join(P, '.src', 'slides', '05-project.html'); writeFileSync(f, readFileSync(f, 'utf8').replace('Project 4', 'Project four'));
writeFileSync(join(P, '.src', 'notes.json'), '[]\n');
const edited = run('bash', [S + 'make_deck.sh', P]); assert.match(edited.stdout, /\[1\] assembled 14 slides/); assert.doesNotMatch(edited.stdout, /FAIL at source/);
// 3. The scripts hold no hash guard any more.
const sh = readFileSync(S + 'make_deck.sh', 'utf8'); assert.ok(!sh.includes('FAIL at source') && !sh.includes('"source"'));
assert.ok(!readFileSync(S + 'new_deck.mjs', 'utf8').includes('createHash'));
// 4. A small deck from --slides carries no data record.
const small = join(work, 'small'); assert.equal(run('node', [S + 'new_deck.mjs', small, '--template', 'blue-professional', '--title', 'T', '--slides', 'cover,project,closing']).status, 0);
assert.ok(!existsSync(join(small, '.src', 'data_build.json')));
console.log('PASS deck run 3 scripts');
