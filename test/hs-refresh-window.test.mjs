// node --import ./test/stubs/register.mjs test/hs-refresh-window.test.mjs
// The mental model refresh charge window (src/byok.js hs_refresh_run, HS_REFRESH_WINDOW_MS; resident.js hsRetainHold / hsRefreshTake; bee-sync.js).
// Hindsight refreshes every template model on a cron twice a day ("0 10,22 * * *", 12 hours apart), and 1HC charges the refresh runs of every model
// once per 12 hour window. Checks: the window is the cron gap, taken from the templates (a longer window let one charge cover two runs); a send inside
// the window pays no refresh and one after it pays again; two sends running at the same moment pay for one window between them (the clock is
// set before any await); a refused or failed hold gives the window back, without undoing a window someone else took since; a chat turn and a
// Bee conversation share General's one window (they had two clocks); BeeSync keeps its own clock only when General's Resident can't answer.
import assert from "node:assert/strict";
import { METER, hsRetainBatchNano, HS_REFRESH_WINDOW_MS } from "../src/byok.js";
import { templateModelCount } from "../src/hindsight-template.js";
import general from "../src/hindsight-templates/general.json" with { type: "json" };
import channel from "../src/hindsight-templates/channel.json" with { type: "json" };
import { Resident } from "../src/resident.js";
import { BeeSync } from "../src/ee/bee-sync.js";
const ok = (n) => console.log("  ok", n);

// ---- the window is the interval ----
for (const [kind, t] of [["general", general], ["channel", channel]]) {
  for (const m of t.mental_models) { assert.equal(m.trigger?.refresh_cron, "0 10,22 * * *", `${kind}/${m.id}: refreshes at 10:00 and 22:00 UTC, 12 hours apart`); assert.ok(!m.trigger?.refresh_after_consolidation && m.trigger?.min_refresh_interval_seconds == null, `${kind}/${m.id}: no refresh outside the cron`); }
}
assert.equal(HS_REFRESH_WINDOW_MS, 12 * 3600e3);
ok("window: 12 hours, equal to the gap between the two daily cron refreshes of every model of both kinds");

// ---- fakes ----
let NOW = 1_800_000_000_000; const realNow = Date.now; Date.now = () => NOW;
const kv = () => { const m = new Map(); return { get: (k) => m.has(k) ? m.get(k) : null, put: (k, v) => { m.set(k, v); } }; };
function resident(channelSlug = "main", holds = [], delay = 0) {
  const R = Object.create(Resident.prototype), s = kv(); R.get = s.get; R.put = s.put; R.env = { BYOK: "1" };
  R.byokHold = async (kind, nano) => { if (!R.env.BYOK) return { skipped: false, done: async () => 0 }; if (delay) await new Promise((z) => setTimeout(z, delay)); holds.push([kind, nano]); return R.refuse ? null : { skipped: false, done: async (n) => n }; };
  R.get = (k) => k === "channel" ? channelSlug : s.get(k); return R;
}
const GEN = templateModelCount("general"), CH = templateModelCount("channel"), base = (lens) => hsRetainBatchNano(lens, 0), runs = (n) => n * METER.hs_refresh_run;
const paidRuns = (h, lens = [500]) => (h[1] - base(lens)) / METER.hs_refresh_run;

// ---- the window ----
{
  const holds = [], R = resident("main", holds); await R.hsRetainHold([500]); assert.equal(paidRuns(holds.at(-1)), GEN, "first send: every General model");
  NOW += 43199e3; await R.hsRetainHold([500]); assert.equal(paidRuns(holds.at(-1)), 0, "43,199 s later: no refresh charged");
  NOW += 2e3; await R.hsRetainHold([500]); assert.equal(paidRuns(holds.at(-1)), GEN, "after 43,200 s from the window's start: charged again");
  NOW += 21600e3; await R.hsRetainHold([500]); assert.equal(paidRuns(holds.at(-1)), 0, "inside the new window");
  const c = resident("project", holds); await c.hsRetainHold([500]); assert.equal(paidRuns(holds.at(-1)), CH, "a project channel pays for its own models");
  ok("a send pays the refresh runs once per 12 hour window (General and project channel counts)");
}
{ const holds = [], R = resident("main", holds); R.env.BYOK = ""; await R.hsRetainHold([500]); assert.equal(R.get("hs_refresh_at"), null, "no hold, no window (other plans)"); assert.equal(holds.length, 0); ok("other plans: nothing charged, no window recorded"); }
{ const holds = [], R = resident("main", holds); await R.hsRetainHold([0]); assert.equal(R.get("hs_refresh_at"), null, "an empty send takes no window"); ok("an empty send takes no window"); }

// ---- two sends at the same moment ----
{
  const holds = [], R = resident("main", holds, 15);
  await Promise.all([R.hsRetainHold([500]), R.hsRetainHold([700]), R.hsRetainHold([300])]);
  const total = holds.reduce((s, h) => s + h[1], 0), extra = total - base([500]) - base([700]) - base([300]);
  assert.equal(extra, runs(GEN), "three sends at once: the General models are charged once, not three times");
  ok("concurrent sends pay one window between them");
}

// ---- a window that was never used is given back ----
{
  const holds = [], R = resident("main", holds); R.refuse = true; NOW += 50e6;
  assert.equal(await R.hsRetainHold([500]), null); assert.ok(!(Number(R.get("hs_refresh_at")) > NOW - 1000), "refused (no credits): the window stays closed");
  R.refuse = false; const h = await R.hsRetainHold([500]); assert.equal(paidRuns(holds.at(-1)), GEN); await h.done(0); assert.ok(!(Number(R.get("hs_refresh_at")) > NOW - 1000), "a failed send: the window is given back");
  await R.hsRetainHold([500]); assert.equal(paidRuns(holds.at(-1)), GEN, "so the next send pays for it");
  // a window someone else took after ours is not undone by our failure
  NOW += 50e6; const a = await R.hsRetainHold([500]); const mine = R.get("hs_refresh_at"); NOW += 50000e3; await R.hsRetainHold([500]); const theirs = R.get("hs_refresh_at"); assert.notEqual(String(mine), String(theirs));
  await a.done(0); assert.equal(R.get("hs_refresh_at"), theirs, "an older send's failure doesn't undo a newer window");
  ok("a refused hold or a failed send gives the window back; a newer window is left alone");
}

// ---- a chat turn and a Bee conversation share General's window ----
function bee(general, { rpc = true } = {}) {
  const B = Object.create(BeeSync.prototype), s = kv(); B.get = s.get; B.put = s.put;
  B.hsGeneral = async () => rpc ? general : { hsRefreshWindow: undefined };
  return B;
}
{
  const holds = [], R = resident("main", holds); R.hsRefreshWindow = Resident.prototype.hsRefreshWindow;
  const B = bee(R); NOW += 50e6;
  const w1 = await B.hsRefreshTake(); assert.equal(w1.models, GEN, "Bee opens the window"); assert.equal(w1.via, "resident");
  await R.hsRetainHold([500]); assert.equal(paidRuns(holds.at(-1)), 0, "a chat turn right after: not charged again");
  const w2 = await B.hsRefreshTake(); assert.equal(w2.models, 0, "and Bee inside the window: nothing");
  await B.hsRefreshGive(w1); assert.equal((await B.hsRefreshTake()).models, GEN, "Bee's failed retain gives it back");
  NOW += 50e6; await R.hsRetainHold([500]); assert.equal(paidRuns(holds.at(-1)), GEN); const w3 = await B.hsRefreshTake(); assert.equal(w3.models, 0, "the other way round: the chat turn opened it, Bee pays nothing");
  assert.equal(B.get("hs_refresh_at"), null, "BeeSync keeps no clock of its own while General's Resident answers");
  ok("a chat turn and a Bee conversation in one window are charged once between them");
}
{
  const B = bee(null, { rpc: false }); NOW += 50e6;
  const w = await B.hsRefreshTake(); assert.equal(w.models, GEN); assert.equal(w.via, "local"); assert.equal((await B.hsRefreshTake()).models, 0, "its own clock works inside the window");
  NOW += 43201e3; assert.equal((await B.hsRefreshTake()).models, GEN, "and opens again after 43,200 s");
  const w4 = await B.hsRefreshTake(); NOW += 50e6; const w5 = await B.hsRefreshTake(); await B.hsRefreshGive(w4); assert.equal(B.get("hs_refresh_at"), String(w5.mark) === "null" ? null : w5.mark, "local give back leaves a newer window alone");
  ok("BeeSync falls back to its own clock when General's Resident can't answer");
}
Date.now = realNow;
