// node --import ./test/stubs/register.mjs test/plain-writing-prompt.test.mjs
// The plain writing rules are the helper's writing rules (src/prompt/05-writing-style.md), the contradicting old lines are gone, and
// the background jobs whose text a person reads carry the short PLAIN_STYLE constant.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { staticCore } from "../src/prompt/index.js";
import { PLAIN_STYLE } from "../src/plain-style.js";
import { LABEL_SYSTEM } from "../src/tracker.js";
import { NOTE_SYSTEM, FINAL_SYSTEM } from "../src/ee/live-notes.js";
import { CARD_SYSTEM } from "../src/sidecar.js";

const md = readFileSync(new URL("../src/prompt/05-writing-style.md", import.meta.url), "utf8");
// Rules 1 to 25 are all there, with their before and after examples.
for (let n = 1; n <= 25; n++) assert.match(md, new RegExp(`^${n}\\. \\*\\*`, "m"), `rule ${n}`);
assert.equal((md.match(/^\s+Before:/gm) || []).length >= 25, true, "before/after examples");
for (const key of ["Use simple, everyday words", "No dashes or middle dots", "Use straight quotes", "Do not use vague demonstrative pronouns", "In chat, give context on the problem",
  "Merriam Webster", "No analogies or imagery", "Do not open with a count of things"]) assert.ok(md.includes(key), key);
// Scope line, personality line and the person's own voice.
assert.match(md, /chat replies, texts, emails and messages/);
assert.match(md, /The rules do not apply to code, commands, identifiers, or exact quotes/);
assert.match(md, /Your personality shows in what you say and what you care about, and the wording stays plain/);
assert.match(md, /in their own voice/);
assert.doesNotMatch(md, /deslopify|\/plain-writing/i);
assert.doesNotMatch(md, /\bthe user\b/i);
// The removed lines that contradicted the rules.
for (const gone of ["Vary sentence length", "The odd fragment is fine", "Probably fine. I'd double-check", "Skip em-dashes", "Write like a person in a chat thread", "Yep, pretty much"]) assert.ok(!md.includes(gone), gone);
// No dashes or curly quotes outside the rules' own bad examples.
const prose = md.split("\n").filter((l) => !/^\s+Before:|middle dot|\(·\)/.test(l)).join("\n");
assert.doesNotMatch(prose, /[—–“”’·]/);
// Kept helper behavior.
for (const keep of ["Results, not self-commentary", "- Errors:", "- Helpful follow-ups:", "- Curiosity:", "### Acknowledging a Task", "### Reactions", "### Richer Replies", "- Language:"]) assert.ok(md.includes(keep), keep);
assert.ok(staticCore({}).includes("Plain writing rules"));
// Background constant: short, no dashes, and in every prompt a person's text comes from.
const words = PLAIN_STYLE.split(/\s+/).length;
assert.ok(words >= 80 && words <= 200, `PLAIN_STYLE is ${words} words`);
assert.doesNotMatch(PLAIN_STYLE, /[—–“”·]/);
for (const [name, p] of [["label", LABEL_SYSTEM], ["notes", NOTE_SYSTEM], ["final notes", FINAL_SYSTEM], ["file card", CARD_SYSTEM]]) assert.ok(p.includes(PLAIN_STYLE), name);
console.log(`Plain writing prompt: 25 rules, scope, kept behavior, removed lines and ${words}-word background constant passed.`);
