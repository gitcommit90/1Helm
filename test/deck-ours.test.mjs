// Deck flow (deck-ours): the app's own instructions and tools stop causing repeat mistakes. Deterministic facts only.
// - notes.json builds in the bare list shape and in the {"notes": [...]} shape;
// - new_deck.mjs --show prints a pattern's markup, and a deck of more than 8 slides from --slides is accepted;
// - the google-slides skill description doesn't match a plain deck request;
// - the editing reference names the theme CSS variables and the picture step, and the presentation reference has no template-file or colour ban.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const S = new URL('../src/skills/artifacts/scripts/', import.meta.url).pathname, R = new URL('../src/skills/artifacts/references/', import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), 'deck-ours-')), run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', cwd: work });
const nd = (P, ...a) => run('node', [S + 'new_deck.mjs', P, '--template', 'coral', '--title', 'T', ...a]);
// 1. Notes in both shapes reach the built notes (assemble_deck.mjs writes .src/build/notes.json).
const P = join(work, 'n'); assert.equal(nd(P, '--slides', 'title-cover,media').status, 0);
const built = (shape) => { writeFileSync(join(P, '.src', 'notes.json'), JSON.stringify(shape)); const r = run('node', [S + 'assemble_deck.mjs', P]); assert.equal(r.status, 0, r.stdout + r.stderr); return JSON.parse(readFileSync(join(P, '.src', 'build', 'notes.json'), 'utf8')); };
assert.deepEqual(built(['first', 'second']), ['first', 'second']);
assert.deepEqual(built({ notes: ['first', 'second'] }), ['first', 'second']);
assert.deepEqual(built([{ notes: 'first' }, { note: 'second' }]), ['first', 'second']);
assert.deepEqual(built({ '01-title-cover': 'first', 2: 'second' }), ['first', 'second']);
// 2. --show prints the full markup of the named patterns, and refuses an unknown one with the list.
const show = run('node', [S + 'new_deck.mjs', '--show', 'coral', 'media', 'title-cover']);
assert.equal(show.status, 0, show.stdout); assert.match(show.stdout, /data-slot="media"[^>]*>Screenshot or GIF goes here</); assert.match(show.stdout, /<svg viewBox="0 0 1200 400"/);
assert.match(show.stdout, /----- coral \/ media/); assert.match(show.stdout, /----- coral \/ title-cover/);
const bad = run('node', [S + 'new_deck.mjs', '--show', 'coral', 'nope']); assert.equal(bad.status, 2); assert.match(bad.stdout, /Its patterns: .*media/);
// 3. More than 8 slides from --slides are accepted.
const long = nd(join(work, 'long'), '--slides', 'title-cover,' + 'media,'.repeat(10) + 'closing'); assert.equal(long.status, 0, long.stdout);
assert.equal(JSON.parse(readFileSync(join(work, 'long', '.src', 'deck.json'), 'utf8')).slides.length, 12);
// 4. The google-slides description starts with "Use when", names Google Slides, and has no plain deck word a "make a deck" request would match.
const desc = readFileSync(new URL('../src/skills/google-slides/SKILL.md', import.meta.url), 'utf8').match(/^description: (.*)$/m)[1];
assert.match(desc, /^Use when /); assert.match(desc, /Google Slides/);
assert.doesNotMatch(desc.replace(/Google Slides/g, ''), /\b(?:decks?|presentations?|slides?)\b/i);
// 5. The editing reference names the CSS variables, the picture step and the redo warning; the presentation reference lost its two bans.
const ed = readFileSync(R + 'deck-editing.md', 'utf8');
assert.match(ed, /CSS variables[\s\S]*head\.html/); assert.match(ed, /\.src\/media\//); assert.match(ed, /<img src="media\//); assert.match(ed, /--redo[\s\S]*throws away/);
const pres = readFileSync(R + 'presentation.md', 'utf8');
assert.ok(!/Never open a template file/.test(pres) && !/No new colours/.test(pres) && !/never write a script that writes them/.test(pres));
assert.match(pres, /--show/);
console.log('PASS deck ours');
