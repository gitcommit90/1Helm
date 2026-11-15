// Name, tone and channel instructions must reach the model on both prompt paths, and the persona text must not ask for performed warmth.
import assert from "node:assert/strict";
import { channelBlock, staticCore } from "../src/prompt/index.js";
import { channelLayers } from "../src/prompt/context-layers.js";
import * as L from "../src/prompt/person-lines.js";

const base = { helperName: "Ollie", firstName: "Sam", tone: 1, tz: "America/Chicago", channel: "main", recall: true, pinned: "- (you) x", recent: "[t] person: hi", purpose: "p" };
for (const general of [true, false]) {
  const o = { ...base, general }, block = channelBlock(o), v2 = channelLayers(o).runtime;
  const shared = [L.helperNameLine("Ollie"), L.firstNameLine("Sam"), L.toneLine(1), L.timeZoneLine("America/Chicago")];
  if (general) shared.push(L.RECALL_SAVE_LINE, L.MARK_DONE_LINE); else shared.push(L.PROJECT_OTHER_LINE);
  for (const line of shared) { assert.ok(block.includes(line), `channelBlock lacks: ${line}`); assert.ok(v2.includes(line), `v2 runtime lacks: ${line}`); }
  assert.ok(block.includes(L.recentLine()) && v2.includes(L.recentLine(true)), "both paths say the earlier messages are for context only");
  // Drift guard: every instruction line channelBlock emits needs a v2 counterpart. Only data lines and the long General lines that v2 words differently are skipped.
  const dataOnly = [/^## /, /^$/, /^Pinned notes/, /^- \(you\)/, /^Saved (keys|logins)/, /^Most recent messages/, /^\[t\] person/, /^You're in (General|the #)/, /^What you remember here stays/, /^Here you can see across/,
    /^Use list_channels to discover/, /^When they ask for a new channel and to kick off/, /^start_task\.instructions is your actionable/];
  for (const line of block.split("\n")) {
    if (dataOnly.some((re) => re.test(line))) continue;
    assert.ok(v2.includes(line), `channelBlock instruction has no v2 counterpart: ${line.slice(0, 100)}`);
  }
}
// Name rule.
const rule = L.firstNameLine("Sam");
assert.match(rule, /Never open a reply with their name and never end a reply with it\. Use it rarely/);
assert.equal(L.firstNameLine(""), ""); assert.doesNotMatch(channelLayers({ tz: "UTC" }).runtime, /first name/); assert.doesNotMatch(channelBlock({ tz: "UTC" }), /first name/);
assert.match(L.toneLine(1), /rules about their name and about emoji still apply/);
assert.equal(L.toneLine(0), ""); assert.match(L.toneLine(2), /without jargon/);
// Emoji rule and persona text, with and without context_v2.
for (const flags of [{}, { context_v2: true }]) {
  const core = staticCore(flags);
  assert.match(core, /don't use emoji unless the person uses them first, and then use them sparingly/);
  assert.match(core, /`react` tool is not covered/);
  assert.match(core, /Warmth comes from paying attention and doing the work well, not from affectionate wording, flattery, reassurance or repeated apologies/);
  assert.match(core, /Your warmth shows in how closely you pay attention/);
  assert.match(core, /When they share a feeling, respond to what they actually said/);
  assert.match(core, /For tender subjects \(stress, grief, health scares, relationships, confidence\), be gentle/);
  assert.match(core, /warm and chatty tone, use warmer, more conversational wording/);
  assert.doesNotMatch(core, /bright, kind|Be warm and caring|say something human before the facts|feeling heard, backed up/);
  for (const h of ["### Truth", "### Beauty", "### Respect", "### Fun"]) assert.ok(core.includes(h), h);
}
console.log("persona lines tests passed");
