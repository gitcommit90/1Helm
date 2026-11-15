// node --import ./test/stubs/register.mjs test/frontdoor-channels.test.mjs
// General's front door with few or no other channels, General's channel list, and an unanswered card.
//   1. No other channel to read (only General, or only DMs): no card, nothing read, the model gets a plain answer.
//   2. General's standing context lists the other channels (names and purposes, capped); a project channel's context never does.
//   3. An unanswered card expires (nothing read, the live card is told), and a late answer neither resumes the turn nor leaves a grant.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { world } from "./memjobs-fixtures.mjs";
import { frontDoorGate, channelsLine, NO_OTHER_CHANNELS, wallsTools } from "../src/front-door.js";
import { HOLD, EXPIRED_TEXT } from "../src/perms.js";
import { channelLayers } from "../src/prompt/context-layers.js";
import { prefixDigest } from "../src/task-transcript.js";
let passed = 0;
const ok = (name) => { passed++; console.log("  ok", name); };

const { env, d1, RG, RM, RT } = await world();
d1.exec(readFileSync(new URL("../db/migrations/0053_front_door.sql", import.meta.url), "utf8"));
d1.exec(readFileSync(new URL("../db/migrations/0019_028_permissions.sql", import.meta.url), "utf8"));
env.HS_WALLS = "on";
let n = 0;
const turn = (o = {}) => { const seen = []; const t = { turn: `turn-${++n}`, session: "s1", kind: "chat", subs: new Set([(e) => seen.push(e)]), seen, context: { version: 2 }, ...o }; t.emit = (e) => { for (const s of t.subs) s(e); }; return t; };
const rows = () => RG.sql.exec("SELECT id,status,decision FROM approvals").toArray();
const handoffs = []; RG.handoff = (s, i) => { handoffs.push([s, i]); return { mode: "open" }; };
RG.sql.exec("INSERT OR IGNORE INTO sessions (id,title,created,updated) VALUES ('s1','General chat',1,1)");
let crossCalls = 0;
RG.crossChannelRecall = async () => { crossCalls++; return { pack: "(#Trip:)\nhotel", ids: ["trip:1"], channels: 2, ms: 1 }; };

const realArchive = RG.archive.bind(RG);
const only = (list) => { RG.archive = () => ({ channels: async () => list }); };
const real = () => { RG.archive = realArchive; };
const GEN = { id: 1, slug: "main", name: "General", kind: "channel" };

// ---- 1. nothing to read: no card ----
for (const [label, list] of [["only General", [GEN]], ["General and a DM", [GEN, { id: 9, slug: "dm-x", name: "DM", kind: "dm" }]], ["General and a deleted channel", [GEN, { id: 8, slug: "old", name: "Old", kind: "channel", deleted: 1 }]]]) {
  only(list); crossCalls = 0; const tc = turn();
  const r = await RG.crossChannelFor("Mario land", null, tc, { onDemand: true, otherChannels: true });
  assert.equal(r.note, NO_OTHER_CHANNELS, label); assert.equal(r.pack, ""); assert.equal(crossCalls, 0, "nothing read");
  assert.ok(!tc.seen.some((e) => e.t === "approval"), "no card"); assert.equal(rows().length, 0, "no approval row");
  assert.match(r.note, /no other channels/);
  assert.equal(await frontDoorGate(RG, tc, "look at the tasks in #x"), NO_OTHER_CHANNELS, "list_tasks / read_task / memory_explain / forget use the same gate");
  ok(`${label}: no card, nothing read, the model is told there are no other channels`);
}
{ // the gate answers at once even with no live turn, and never for a project channel
  only([GEN]); assert.equal(await frontDoorGate(RG, null), NO_OTHER_CHANNELS);
  real(); assert.equal(await frontDoorGate(RM, turn()), null, "a project channel is not gated here (it never reads other channels)");
  ok("no live turn: same plain answer; project channel unchanged");
}
{ // with other channels, the card still appears (checked through the expiry test below)
  real(); const names = wallsTools(env, "main", RG.availableTools({ context: { version: 2 } })).find((t) => t.function.name === "recall_memory").function.parameters.properties.other_channels.description;
  assert.match(names, /other channels listed in your context/); assert.match(names, /no other channels, don't use it/);
  ok("recall_memory other_channels description says when to use it");
}

// ---- 2. General's context lists channels; others do not ----
{
  real();
  const g = await RG.systemPrompt(false, false, false, false), m = await RM.systemPrompt(false, false, false, false);
  assert.match(g, /Other channels \(names and purposes only[^)]*\): #Moving \(The move\); #Trip/, "General lists names and purposes");
  assert.ok(!/Other channels \(names/.test(m) && !m.includes("#Trip") && !/Other channels:/.test(m), "a project channel's prompt names no other channel");
  const t = await RT.systemPrompt(false, false, true, false);
  const text = typeof t === "string" ? t : JSON.stringify(t);
  assert.ok(!text.includes("#Moving"), "layered prompt of Trip: no other channel named");
  const gl = await RG.systemPrompt(false, false, true, false); assert.match(JSON.stringify(gl), /#Moving \(The move\)/, "layered prompt lists them too");
  assert.equal(await channelsLine(RM), "", "non-General: empty line");
  ok("General's prompt lists other channels with purposes; a project channel's prompt does not");
}
{
  const many = [GEN, ...Array.from({ length: 25 }, (_, i) => ({ id: 20 + i, slug: `c${i}`, name: `Chan${i}`, kind: "channel", purpose: "p".repeat(300) }))];
  only(many); const line = await channelsLine(RG);
  assert.equal((line.match(/#Chan/g) || []).length, 20, "at most 20 channels"); assert.match(line, /and 5 more/);
  assert.ok(!/p{81}/.test(line), "purpose capped"); assert.ok(line.length < 3000);
  only([GEN]); assert.match(await channelsLine(RG), /none/);
  only([GEN, { id: 9, slug: "dm-x", name: "Secret DM", kind: "dm" }]); assert.ok(!(await channelsLine(RG)).includes("Secret DM"), "DMs are not listed");
  real();
  ok("the list is capped (20 channels, 80 character purposes), says none when empty, and leaves out DMs");
}

// ---- 3. an unanswered card expires ----
{
  real(); HOLD.ms = 600; crossCalls = 0; handoffs.length = 0;
  const tc = turn();
  const r = await RG.crossChannelFor("Mario land", null, tc, { onDemand: true, otherChannels: true });
  assert.equal(r.note, EXPIRED_TEXT); assert.equal(crossCalls, 0, "nothing was read from other channels");
  const card = tc.seen.find((e) => e.t === "approval"), done = tc.seen.find((e) => e.t === "approval_done");
  assert.ok(card, "the card was shown while it waited"); assert.equal(done.id, card.approval.id); assert.equal(done.status, "expired");
  assert.equal(rows()[0].status, "expired");
  assert.equal((await RG.approvals(false)).length, 0, "no pending card is left");
  assert.equal((await RG.approvalCardData(card.approval.id)).status, "expired", "the card page says expired");
  // a late answer does nothing
  for (const d of ["once", "always", "deny"]) assert.match((await RG.decideApproval(card.approval.id, d)).error, /already expired/);
  assert.equal(handoffs.length, 0, "no handoff: the old turn is not resumed");
  assert.equal(RG.sql.exec("SELECT COUNT(*) n FROM grants WHERE host='perm:channels'").one().n, 0, "no grant left for a later turn");
  assert.equal(d1.prepare("SELECT front_door FROM tenants WHERE id='t1'").get().front_door ?? 0, 0, "Always did not turn the front door on");
  // later calls in the same turn do not open another card
  const again = await RG.crossChannelFor("Mario land", null, tc, { onDemand: true, otherChannels: true });
  assert.equal(again.note, EXPIRED_TEXT); assert.equal(rows().length, 1, "no second card in the same turn");
  ok("an unanswered card expires: nothing read, the card closes, a late answer neither resumes the turn nor saves a grant");
}
{ // an answer in time still works
  HOLD.ms = 5000; const tc = turn();
  const p = RG.crossChannelFor("Mario land", null, tc, { onDemand: true, otherChannels: true });
  for (let i = 0; i < 100 && !tc.seen.find((e) => e.t === "approval"); i++) await new Promise((z) => setTimeout(z, 20));
  const ev = tc.seen.find((e) => e.t === "approval"); assert.equal((await RG.decideApproval(ev.approval.id, "once")).ok, true);
  const r = await p; assert.match(r.pack, /Trip/); assert.equal(crossCalls, 1);
  ok("an answer in time still reads the other channels");
}
HOLD.ms = 120e3;
{ // the layered path: the line is in the standing data (watched for changes), never in the frozen runtime message
  const line = "Other channels: none. Everything is in General, so there is nothing to look up in other channels.";
  const g = channelLayers({ general: true, channel: "main", channelsLine: line });
  assert.equal(g.data.other_channels, line); assert.ok(!g.runtime.includes("Other channels"), "not in the frozen runtime message");
  assert.equal("other_channels" in channelLayers({ general: false, channel: "x", channelsLine: line }).data, false, "a project channel never gets it");
  assert.equal("other_channels" in channelLayers({ general: true, channel: "main", channelsLine: "" }).data, false, "no key when empty");
  const d = (o) => prefixDigest([{ role: "user", content: JSON.stringify(channelLayers(o).data) }], []);
  assert.notEqual(d({ general: true, channel: "main" }), d({ general: true, channel: "main", channelsLine: line }), "an existing task's standing digest changes, so it gets a USER CONTEXT UPDATE");
  assert.notEqual(d({ general: true, channel: "main", channelsLine: line }), d({ general: true, channel: "main", channelsLine: "Other channels (names and purposes only): #Trip." }), "a new channel changes the digest");
  ok("the channel list is in General's standing data so existing tasks see it and changes reach them");
}
console.log(`frontdoor-channels: ${passed} passed`);
