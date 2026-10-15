// node --import ./test/stubs/register.mjs test/walls.test.mjs
// Memory Overhaul phase 4B (flag HS_WALLS): General's front door and Contacts visibility per channel, on the real Resident and Archive
// (test/memjobs-fixtures.mjs world(): node:sqlite as the objects' storage and as D1, Hindsight and OpenRouter faked).
//   Part A, the front door: the flag off changes nothing; with it on and front_door 0, every cross-channel read (recall with other_channels,
//   memory_explain, forget, list_tasks and read_task in another channel) shows the "Inspect other channels?" card and reads nothing before
//   the answer; Allow once covers the turn, Always sets front_door to 1, Don't allow reads nothing, a late Allow resumes through a grant,
//   Settings turns it off again, writes into another channel never ask, and the nightly reflection reads other channels only with it on.
//   Part B, people_seen: written by remember, the people job's facts and saving from General into a channel; contactsBlock and recall
//   show a channel only the people seen in it (General sees all); the "+N more" line never counts a hidden person; the Contacts screen
//   lists everyone and edits "seen in" without ever widening on its own; delete, merge and channel deletion update the rows; the
//   backfill (dry run first) builds rows from facts and Notebook rows and leaves unplaced contacts General only.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { world } from "./memjobs-fixtures.mjs";
import { permsApi, KIND, KINDS, permView } from "../src/perms.js";
import { frontDoorGet, seenBackfillAdmin, canSee } from "../src/walls.js";
import { accountRoute } from "../src/account.js";
let passed = 0;
const ok = (name) => { passed++; console.log("  ok", name); };

const { env, A, RM, RT, RG, d1, settle } = await world();
d1.exec(readFileSync(new URL("../db/migrations/0053_front_door.sql", import.meta.url), "utf8"));
d1.exec(readFileSync(new URL("./fixtures/migrations/migrations_028_permissions.sql", import.meta.url), "utf8"));
const frontDoor = () => d1.prepare("SELECT front_door FROM tenants WHERE id='t1'").get().front_door;
const setDoor = (v) => d1.prepare("UPDATE tenants SET front_door=? WHERE id='t1'").run(v);
let nTurn = 0;
const turn = (o = {}) => { const seen = []; const t = { turn: `turn-${++nTurn}`, session: "s1", kind: "chat", subs: new Set([(e) => seen.push(e)]), seen, context: { version: 2 }, ...o }; t.emit = (e) => { for (const s of t.subs) s(e); }; return t; };
const until = async (f, ms = 3000) => { for (let i = 0; i < ms / 20; i++) { const v = f(); if (v) return v; await new Promise((z) => setTimeout(z, 20)); } throw new Error("timed out"); };
const pending = () => RG.sql.exec("SELECT COUNT(*) n FROM approvals WHERE status='pending'").one().n;
const asked = (tc) => tc.seen.find((e) => e.t === "approval");
const noCard = (tc) => assert.ok(!asked(tc), "no card was shown");
const handoffs = []; RG.handoff = (s, i) => { handoffs.push([s, i]); return { mode: "open" }; };
RG.sql.exec("INSERT OR IGNORE INTO sessions (id,title,created,updated) VALUES ('s1','General chat',1,1)");

// Spies: what each channel was asked to read.
const calls = { cross: 0, explain: 0, forgetPlan: 0, tasks: 0 };
RG.crossChannelRecall = async () => { calls.cross++; return { pack: "(#Trip:)\nthe Kyoto hotel is booked", ids: ["trip:1"], channels: 2, ms: 1 }; };
for (const R of [RM, RT]) {
  const ex = R.memoryExplainFor.bind(R), fp = R.forgetPlanHere.bind(R), ta = R.taskAccess.bind(R);
  R.memoryExplainFor = async (...a) => { calls.explain++; return ex(...a); };
  R.forgetPlanHere = async (...a) => { calls.forgetPlan++; return fp(...a); };
  R.taskAccess = async (...a) => { calls.tasks++; return ta(...a); };
}
const reset = () => { for (const k of Object.keys(calls)) calls[k] = 0; };
const recall = (tc, otherChannels, onDemand = true) => RG.crossChannelFor("Kyoto hotel", null, tc, { onDemand, otherChannels });
const answer = async (tc, decision) => { const ev = await until(() => asked(tc)); const r = await RG.decideApproval(ev.approval.id, decision); assert.equal(r.ok, true, JSON.stringify(r)); return ev.approval; };

// ================= Part A: the front door =================
{ // the flag off: nothing changes
  env.HS_WALLS = "off"; reset(); const tc = turn();
  const xc = await recall(tc, false); assert.equal(calls.cross, 1, "flag off: General searches every channel as before"); assert.match(xc.pack, /Kyoto/); assert.equal(pending(), 0);
  assert.equal(KIND.channels.ask, "Inspect other channels?"); assert.match(KIND.channels.always, /General/);
  assert.equal((await permsApi(new Request("https://x/api/permissions"), env, { id: "t1" }, { channels: async () => [] })).status, 200);
  const view = await (await permsApi(new Request("https://x/api/permissions"), env, { id: "t1" }, { channels: async () => [] })).json();
  assert.ok(!view.kinds.some((k) => k.id === "channels") && view.front_door === undefined, "flag off: Settings does not list the kind");
  const names = RG.availableTools({ context: { version: 2 } }).find((t) => t.function.name === "recall_memory");
  assert.ok(!names.function.parameters.properties.other_channels, "flag off: recall_memory has no other_channels argument");
  ok("flag off: General searches every channel without asking, no new argument, no Settings entry");
}
env.HS_WALLS = "on";
{ // the argument
  const t = RG.availableTools({ context: { version: 2 } }).find((x) => x.function.name === "recall_memory");
  assert.equal(t.function.parameters.properties.other_channels.type, "boolean"); assert.deepEqual(t.function.parameters.required, ["query"]);
  const inTrip = RT.availableTools({ context: { version: 2 } }).find((x) => x.function.name === "recall_memory");
  assert.ok(!inTrip.function.parameters.properties.other_channels, "only General gets other_channels");
  ok("recall_memory in General has an optional other_channels argument; other channels do not");
}
{ // closed door, no argument: General's own bank only, nothing asked
  reset(); const tc = turn(); const xc = await recall(tc, false);
  assert.equal(calls.cross, 0); assert.equal(pending(), 0); assert.equal(xc.pack, ""); assert.match(xc.note, /General's own memory only/);
  const legacy = await recall(turn(), false, false); assert.equal(calls.cross, 0); assert.equal(legacy.pack, ""); assert.equal(pending(), 0);
  ok("front_door off: without other_channels General reads only its own bank, and the automatic path reads nothing from other channels");
}
{ // closed door, other_channels: the card, nothing read before the answer, Allow once covers the turn
  reset(); const tc = turn(); const p = recall(tc, true);
  const ev = await until(() => asked(tc));
  assert.equal(ev.approval.perm, "channels"); assert.equal(ev.approval.ask, "Inspect other channels?"); assert.match(ev.approval.always, /Always let General look in other channels/);
  assert.match(ev.approval.what, /Kyoto hotel/);
  await new Promise((z) => setTimeout(z, 120)); assert.equal(calls.cross, 0, "nothing is read before the person answers"); assert.equal(pending(), 1);
  await RG.decideApproval(ev.approval.id, "once"); const xc = await p;
  assert.equal(calls.cross, 1); assert.match(xc.pack, /Kyoto/); assert.equal(frontDoor(), 0, "once does not open the door");
  await recall(tc, true); assert.equal(calls.cross, 2); assert.equal(pending(), 0, "once covers the rest of the turn: no second card");
  const tc2 = turn(); const p2 = recall(tc2, true); await until(() => asked(tc2)); assert.equal(calls.cross, 2, "a new turn asks again"); await answer(tc2, "deny"); await p2;
  ok("front_door off: other_channels shows the Inspect other channels card, reads nothing before the answer, and Allow once covers only that turn");
}
{ // Don't allow
  reset(); const tc = turn(); const p = recall(tc, true); await answer(tc, "deny"); const xc = await p;
  assert.equal(calls.cross, 0); assert.match(xc.note, /NOT ALLOWED/); assert.match(xc.note, /other channels/);
  const again = await recall(tc, true); assert.equal(calls.cross, 0); assert.match(again.note, /NOT ALLOWED/); assert.equal(pending(), 0, "no more asks this turn");
  ok("front_door off: Don't allow reads nothing and does not ask again in that turn");
}
{ // nobody watching: NEEDS PERMISSION, then a late Allow once resumes the task through a grant
  reset(); const tc = turn({ subs: new Set() }); RG.textApproval = async () => false;
  const xc = await recall(tc, true); assert.equal(calls.cross, 0); assert.match(xc.note, /NEEDS PERMISSION/);
  const a = RG.sql.exec("SELECT * FROM approvals WHERE status='pending' AND perm='channels'").toArray().at(-1); assert.ok(a);
  handoffs.length = 0; const d = await RG.decideApproval(a.id, "once"); assert.equal(d.ok, true);
  assert.equal(handoffs.length, 1); assert.match(handoffs[0][1].text, /Look in your other channels/);
  const tc2 = turn(); const xc2 = await recall(tc2, true); assert.equal(calls.cross, 1, "the resumed turn's read goes through on the one-use grant"); assert.match(xc2.pack, /Kyoto/); assert.equal(pending(), 0);
  const tc3 = turn({ subs: new Set() }); const xc3 = await recall(tc3, true); assert.equal(calls.cross, 1, "the grant was used up"); assert.match(xc3.note, /NEEDS PERMISSION/);
  RG.sql.exec("UPDATE approvals SET status='denied' WHERE status='pending'");
  ok("a card nobody saw ends the turn with NEEDS PERMISSION, and a late Allow once resumes the task with a one-use grant");
}
{ // a turn with no live turn (a background caller) has no one to ask, and reads nothing
  reset(); const xc = await recall(null, true); assert.equal(calls.cross, 0); assert.match(xc.note, /NEEDS PERMISSION/);
  ok("no live turn: nothing is read and nothing is asked");
}
{ // Always: front_door becomes 1 and later turns do not ask
  reset(); const tc = turn(); const p = recall(tc, true); await answer(tc, "always"); await p;
  assert.equal(calls.cross, 1); assert.equal(frontDoor(), 1); assert.equal(await frontDoorGet(env, "t1"), 1);
  assert.equal(d1.prepare("SELECT COUNT(*) n FROM perm_allow WHERE kind='channels'").get().n, 0, "the setting is on the account, not a perm_allow row");
  const tc2 = turn(); await recall(tc2, true); assert.equal(calls.cross, 2); assert.equal(pending(), 0); noCard(tc2);
  reset(); const plain = await recall(turn(), false); assert.equal(calls.cross, 0, "on, but without other_channels General still searches only its own bank"); assert.equal(plain.pack, "");
  await recall(turn(), false, false); assert.equal(calls.cross, 1, "on: the automatic path reads other channels as today");
  ok("Always sets front_door to 1, later reads run with no card, and other_channels still decides when General looks");
}
{ // Settings: the permissions list shows it, and revoking turns it off again; the account API can set it
  const view = await (await permsApi(new Request("https://x/api/permissions"), env, { id: "t1" }, { channels: async () => [] })).json();
  assert.equal(view.front_door, true); assert.ok(view.allowed.some((a) => a.kind === "channels")); assert.ok(view.kinds.some((k) => k.id === "channels"));
  const rev = await (await permsApi(new Request("https://x/api/permissions", { method: "POST", body: JSON.stringify({ revoke: "channels" }) }), env, { id: "t1" }, { channels: async () => [] })).json();
  assert.equal(rev.front_door, false); assert.equal(frontDoor(), 0);
  reset(); const tc = turn(); const p = recall(tc, true); await until(() => asked(tc)); assert.equal(calls.cross, 0, "after Settings turned it off the card is back"); await answer(tc, "deny"); await p;
  const t = { id: "t1", front_door: 0 }, user = { email: "sam@example.com" };
  const url = new URL("https://selfhost.example/w/ck1/api/account/prefs");
  const post = (b) => accountRoute(new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }), env, t, user, url, "/api/account/prefs");
  assert.equal((await post({ front_door: "yes" })).status, 400); assert.equal(frontDoor(), 0);
  const on = await (await post({ front_door: true })).json(); assert.deepEqual(on, { ok: true, front_door: true }); assert.equal(frontDoor(), 1);
  const off = await (await post({ front_door: false })).json(); assert.equal(off.front_door, false); assert.equal(frontDoor(), 0);
  env.HS_WALLS = "off"; assert.equal((await post({ front_door: true })).status, 400, "flag off: the setting is not available"); env.HS_WALLS = "on";
  ok("Settings can turn the front door off again (permissions list and the account preference), and the preference is refused with the flag off");
}
{ // the real recall_memory tool: other_channels is what sends General to other channels, and the card comes first
  reset(); const tc0 = turn(); const own = await RG.localTool("recall_memory", { query: "the Kyoto hotel" }, tc0);
  assert.equal(calls.cross, 0); noCard(tc0); assert.match(own, /General's own memory only/); assert.doesNotMatch(own, /From their other channels/);
  const tc = turn(); const p = RG.localTool("recall_memory", { query: "the Kyoto hotel", other_channels: true }, tc);
  await until(() => asked(tc)); assert.equal(calls.cross, 0, "nothing is read before the answer"); await answer(tc, "once"); const out = await p;
  assert.equal(calls.cross, 1); assert.match(out, /From their other channels/); assert.match(out, /Kyoto hotel is booked/);
  const tc2 = turn(); const p2 = RG.localTool("recall_memory", { query: "the Kyoto hotel", other_channels: true }, tc2); await answer(tc2, "deny"); const no = await p2;
  assert.equal(calls.cross, 1); assert.match(no, /NOT ALLOWED/); assert.doesNotMatch(no, /Kyoto hotel is booked/);
  ok("recall_memory in General: without other_channels it says it searched General only; with it the card comes first and a refusal returns no other channel's text");
}
{ // phase 4A and 4B together: HS_USE (types, range) and HS_WALLS (other_channels gated) each keep their own behavior, on or off
  const rc = RG.recallContext.bind(RG), seenOpts = []; RG.recallContext = (q, t, o) => { seenOpts.push(o); return rc(q, t, o); };
  const tools = () => RG.availableTools({ context: { version: 2 } }).find((x) => x.function.name === "recall_memory").function.parameters.properties;
  const had = { u: env.HS_USE, f: env.HS_FOUNDATIONS }; env.HS_FOUNDATIONS = "on";
  try {
    env.HS_WALLS = "on"; env.HS_USE = "on"; reset(); seenOpts.length = 0;
    assert.ok(tools().other_channels && tools().types && tools().from, "both flags on: the tool has other_channels, types and from");
  assert.ok(!RG.availableTools({ context: { version: 2 } }).some((x) => x.function.name === "correct_memory"), "correct_memory is gone");
    const tc = turn(); const p = RG.localTool("recall_memory", { query: "the Kyoto hotel", types: ["observation"], from: "2026-10-01", to: "2026-10-09", other_channels: true }, tc);
    await until(() => asked(tc)); assert.equal(calls.cross, 0, "both on: nothing in other channels is read before the answer"); await answer(tc, "once"); const out = await p;
    assert.equal(calls.cross, 1); assert.match(out, /Kyoto hotel is booked/);
    assert.deepEqual(seenOpts[0].types, ["observation"]); assert.equal(seenOpts[0].otherChannels, true); assert.ok(seenOpts[0].range, "the date range reached recallContext");
    const tc1 = turn(); seenOpts.length = 0; reset(); const own = await RG.localTool("recall_memory", { query: "the Kyoto hotel", types: ["world"] }, tc1);
    noCard(tc1); assert.equal(calls.cross, 0); assert.deepEqual(seenOpts[0].types, ["world"]); assert.equal(seenOpts[0].otherChannels, false); assert.match(own, /General's own memory only/);
    env.HS_USE = "off"; assert.ok(tools().other_channels && !tools().types, "HS_USE off, HS_WALLS on: other_channels only");
    assert.ok(!RG.availableTools({ context: { version: 2 } }).some((x) => x.function.name === "correct_memory"));
    seenOpts.length = 0; reset(); const tc2 = turn(); await RG.localTool("recall_memory", { query: "the Kyoto hotel" }, tc2); noCard(tc2); assert.equal(calls.cross, 0); assert.equal(seenOpts[0].types, undefined);
    env.HS_USE = "on"; env.HS_WALLS = "off"; assert.ok(!tools().other_channels && tools().types, "HS_WALLS off, HS_USE on: types only");
    reset(); seenOpts.length = 0; const tc3 = turn(); const all = await RG.localTool("recall_memory", { query: "the Kyoto hotel", types: ["world"] }, tc3);
    noCard(tc3); assert.equal(calls.cross, 1, "HS_WALLS off: General searches every channel as before"); assert.match(all, /Kyoto hotel is booked/); assert.deepEqual(seenOpts[0].types, ["world"]);
    env.HS_USE = "off"; assert.ok(!tools().other_channels && !tools().types, "both off: the plain tool");
  } finally { RG.recallContext = rc; env.HS_WALLS = "on"; if (had.u === undefined) delete env.HS_USE; else env.HS_USE = had.u; if (had.f === undefined) delete env.HS_FOUNDATIONS; else env.HS_FOUNDATIONS = had.f; }
  ok("recall_memory with HS_USE and HS_WALLS: types and range pass through and other_channels is gated by the card; each flag alone keeps its own behavior");
}
{ // writes into another channel need no card
  reset(); const tc = turn(); const out = await RG.localTool("remember", { about: "me", fact: "Sam wants a quiet Kyoto hotel near the station.", channel: "trip" }, tc); await settle();
  assert.match(out, /Saved in #trip's notebook only/, out); assert.equal(pending(), 0); noCard(tc);
  assert.ok((await A.channel("3")).memory.some((m) => /quiet Kyoto hotel/.test(m.content)));
  ok("front_door off: remember into another channel writes without a card");
}
{ // memory_explain across channels
  reset(); const tc = turn(); const p = RG.localTool("memory_explain", { about: "Denver" }, tc);
  await until(() => asked(tc)); await new Promise((z) => setTimeout(z, 100)); assert.equal(calls.explain, 0, "no other channel is read before approval");
  await answer(tc, "deny"); const out = await p; assert.equal(calls.explain, 0); assert.match(out, /NOT ALLOWED/);
  const tc2 = turn(); const p2 = RG.localTool("memory_explain", { about: "Denver" }, tc2); await answer(tc2, "once"); await p2; assert.ok(calls.explain >= 2, "approved: both other channels are read");
  const tc3 = turn(); const p3 = RG.localTool("memory_explain", { about: "Denver", id: "moving/m:n1" }, tc3); await until(() => asked(tc3)); const before = calls.explain; await answer(tc3, "deny"); await p3; assert.equal(calls.explain, before);
  setDoor(1); reset(); const tc4 = turn(); await RG.localTool("memory_explain", { about: "Denver" }, tc4); assert.ok(calls.explain >= 2); noCard(tc4); setDoor(0);
  ok("memory_explain across channels waits for the card, reads nothing before it, and runs with no card when front_door is 1");
}
{ // tasks in other channels: reads ask, an id in another channel needs the card too, and the channel's own tasks never ask
  reset(); const tc = turn(); const p = RG.localTool("list_tasks", { channel: "trip" }, tc);
  await until(() => asked(tc)); assert.equal(calls.tasks, 0); await answer(tc, "deny"); const out = JSON.parse(await p); assert.match(out.error, /NOT ALLOWED/); assert.equal(calls.tasks, 0);
  const tc2 = turn(); const p2 = RG.localTool("read_task", { channel: "trip", task: "Flights" }, tc2); await until(() => asked(tc2)); assert.equal(calls.tasks, 0); await answer(tc2, "once"); await p2; assert.equal(calls.tasks, 1);
  const tc3 = turn(); await RG.localTool("list_tasks", {}, tc3); noCard(tc3);
  setDoor(1); reset(); const tc4 = turn(); await RG.localTool("list_tasks", { channel: "trip" }, tc4); assert.equal(calls.tasks, 1); noCard(tc4); setDoor(0);
  ok("list_tasks and read_task in another channel wait for the card (General's own never ask), and run with no card when front_door is 1");
}

// ================= Part B: Contacts visibility =================
const people = async () => Object.fromEntries((await A.peopleList()).map((p) => [p.name, p]));
const SIS = "Dana Reyes";
{ // writes
  assert.deepEqual((await people())[SIS].seen, [], "a contact typed on the Contacts screen is seen nowhere");
  const sam = await RM.localTool("remember", { about: "Odalys Marin", fact: "is a pilot", relation: "friend" }, turn()); await settle();
  assert.match(sam, /Odalys Marin/, sam);
  let P = await people(); assert.deepEqual(P["Odalys Marin"].seen, ["moving"], "remember records the channel");
  await RT.localTool("remember", { about: "Odalys Marin", fact: "likes sushi" }, turn()); await settle();
  P = await people(); assert.deepEqual(P["Odalys Marin"].seen, ["moving", "trip"], "an existing person first mentioned in another channel gains that channel");
  await RG.localTool("remember", { about: "Priya Shah", fact: "is my dentist", relation: "dentist" }, turn()); await settle();
  assert.deepEqual((await people())["Priya Shah"].seen, [], "General is never recorded: General sees everyone");
  await RG.localTool("remember", { about: "Priya Shah", fact: "wants a Kyoto tea tour", channel: "trip" }, turn()); await settle();
  assert.deepEqual((await people())["Priya Shah"].seen, ["trip"], "saving from General into a channel records that channel");
  const dana = (await people())[SIS];
  await A.personFact(dana.id, "Is driving to Denver with Sam", "Learned in #moving", null, { channel: "moving", quote: "x" });
  assert.deepEqual((await people())[SIS].seen, ["moving"], "the people job's fact records its channel");
  await A.personFact(dana.id, "Loves gardening", "You added");
  assert.deepEqual((await people())[SIS].seen, ["moving"], "a fact typed on the Contacts screen never widens");
  const up = await A.personUpsert({ id: dana.id, name: SIS, rel: "Your sister", phone: "+1 415 555 0101", replaceAka: true, aka: [] }, "You added");
  assert.deepEqual(up.seen, ["moving"]); assert.deepEqual((await people())["Priya Shah"].seen, ["trip"]);
  // a contact found only by its relation is reused only where it is seen: #trip cannot rename or reveal #moving's "my sister"
  const viaRel = await RT.localTool("remember", { about: "Marisol Vega", fact: "is visiting in June", relation: "sister" }, turn()); await settle();
  assert.doesNotMatch(viaRel, /Dana/, viaRel); P = await people(); assert.equal(P[SIS].rel, "Your sister", "the hidden contact was not touched"); assert.deepEqual(P["Marisol Vega"].seen, ["trip"]);
  await A.personRemove(P["Marisol Vega"].id);
  const typed = await A.personUpsert({ name: "Zed Typed", create: true, rel: "Neighbor" }, "You added"); assert.deepEqual(typed.seen, []);
  await A.personUpsert({ id: typed.id, name: "Zed Typed", rel: "Neighbor", phone: "+1 415 555 0177" }, "You added"); assert.deepEqual((await A.personGet(typed.id)).seen, [], "editing never widens visibility by itself");
  ok("people_seen is written by remember (here, and from General into a channel) and by the people job's facts; General is never recorded; the Contacts screen never widens");
}
{ // filtering
  const list = await A.peopleList(), names = (b) => list.filter((p) => b.includes(p.name.split(" ")[0])).map((p) => p.name);
  assert.ok(canSee(["a"], { channel: "a" }) && !canSee(["a"], { channel: "b" }) && canSee([], { general: true }) && !canSee(undefined, { channel: "a" }));
  // recall
  const rec = (q, o) => A.wsRecall(q, o);
  let r = await rec("Priya called about the tea tour", { channel: "moving", general: false }); assert.deepEqual(r.people, []); assert.equal(r.pack, "");
  r = await rec("Priya called about the tea tour", { channel: "trip", general: false }); assert.equal(r.people.length, 1); assert.match(r.pack, /Priya Shah/);
  r = await rec("Priya called about the tea tour", { channel: "main", general: true }); assert.equal(r.people.length, 1);
  r = await rec("Zed Typed and Dana", { channel: "moving", general: false }); assert.deepEqual(r.people.map((p) => p.name), ["Dana Reyes"], "only the seen person is answered");
  env.HS_WALLS = "off"; r = await rec("Priya called about the tea tour", { channel: "moving", general: false }); assert.equal(r.people.length, 1, "flag off: the whole book, as before");
  assert.equal((await A.peopleList())[0].seen, undefined, "flag off: no seen field"); env.HS_WALLS = "on";
  ok("People.recall shows a channel only the people seen in it, General sees everyone, the flag off shows the whole book (the Contacts block in the prompt is gone)");
}
{ // the Contacts screen keeps listing everyone, and edits "seen in"
  const all = await A.peopleList(); assert.ok(["Dana Reyes", "Odalys Marin", "Priya Shah", "Zed Typed"].every((n) => all.some((p) => p.name === n)), "everyone is listed");
  const zed = all.find((p) => p.name === "Zed Typed");
  const bad = await A.personSeenSet(zed.id, ["trip", "nope", "main", "moving"]); assert.deepEqual(bad.seen, ["moving", "trip"], "unknown channels and General are dropped");
  assert.deepEqual((await A.personSeenSet(zed.id, ["trip"])).seen, ["trip"], "the list is replaced"); assert.deepEqual((await A.personSeenSet(zed.id, [])).seen, []);
  assert.equal((await A.personSeenSet("nope", ["trip"])).error, "no such contact");
  assert.deepEqual((await A.personSeenAdd(zed.id, ["moving"])).added, 1); assert.deepEqual((await A.personGet(zed.id)).seen, ["moving"]);
  await A.personSeenSet(zed.id, []);
  ok("the Contacts screen lists everyone, and the seen-in edit replaces the list, drops unknown channels and General");
}
{ // delete, merge, channel deletion
  const sql = A.sql, rows = (id) => sql.exec("SELECT channel FROM people_seen WHERE person=? ORDER BY channel", id).toArray().map((r) => r.channel);
  const a = await A.personUpsert({ name: "Merge Keep", create: true }, "You added", "moving"), b = await A.personUpsert({ name: "Merge Drop", create: true }, "You added", "trip");
  assert.deepEqual(rows(a.id), ["moving"]); assert.deepEqual(rows(b.id), ["trip"]);
  const m = await A.personMerge(a.id, b.id, {}); assert.deepEqual(m.seen, ["moving", "trip"], "the survivor is seen wherever either was"); assert.deepEqual(rows(b.id), []);
  const c = await A.personUpsert({ name: "Delete Me", create: true }, "You added", "trip"); assert.deepEqual(rows(c.id), ["trip"]);
  await A.personRemove(c.id); assert.deepEqual(rows(c.id), [], "deleting a contact removes its rows");
  const before = sql.exec("SELECT COUNT(*) n FROM people_seen WHERE channel='trip'").one().n; assert.ok(before > 0);
  await A.deleteChannelRows("3"); assert.equal(sql.exec("SELECT COUNT(*) n FROM people_seen WHERE channel='trip'").one().n, 0, "deleting a channel removes its rows");
  assert.ok(sql.exec("SELECT COUNT(*) n FROM people_seen WHERE channel='moving'").one().n > 0, "other channels keep theirs");
  ok("deleting a contact, merging two (union on the survivor) and deleting a channel update people_seen");
}
{ // backfill
  const sql = A.sql; sql.exec("DELETE FROM people_seen");
  await A.ingest([{ t: "channels", r: { id: 4, slug: "garden", name: "Garden", kind: "channel" } }]);
  const P = await people(), id = (n) => P[n].id;
  await A.personFact(id("Dana Reyes"), "Waters the ferns", "Learned in #garden", null, { channel: "garden", quote: "x" });   // records garden; wipe it again so the backfill has to rebuild it
  await A.personFact(id("Dana Reyes"), "Old fact from a deleted channel", "Learned in #gone", null, { channel: "gone", quote: "x" });
  sql.exec("DELETE FROM people_seen");
  await A.noteAdd("2", "people", "Odalys Marin: is a pilot", "agent");               // #moving's Notebook
  await A.noteAdd("4", "people", "Priya's tea tour is on Friday", "agent", { src: "from General" });   // saved from General into #garden
  await A.noteAdd("2", "about", "Zed Typed lives nearby", "agent");                  // not the people section: no match
  await A.noteAdd("1", "people", "Zed Typed is a neighbor", "agent");                // General's own: never recorded
  const dry = await A.peopleSeenBackfill(false);
  assert.equal(dry.dry, true); assert.equal(sql.exec("SELECT COUNT(*) n FROM people_seen").one().n, 0, "a dry run changes nothing");
  assert.equal(dry.from_facts, 2, "Dana has a fact from #moving (earlier test) and one from #garden"); assert.equal(dry.ignored_facts_in_missing_channels, 1); assert.equal(dry.from_notes, 2); assert.equal(dry.rows_to_add, 4);
  assert.deepEqual(dry.per_channel, { garden: 2, moving: 2 }); assert.equal(dry.general_only, 2, "Zed and Merge Keep have no source: General only"); assert.equal(dry.contacts, 5);
  const real = await A.peopleSeenBackfill(true); assert.equal(real.dry, false);
  const after = await people();
  assert.deepEqual(after["Dana Reyes"].seen, ["garden", "moving"]); assert.deepEqual(after["Odalys Marin"].seen, ["moving"]); assert.deepEqual(after["Priya Shah"].seen, ["garden"]); assert.deepEqual(after["Zed Typed"].seen, []);
  const again = await A.peopleSeenBackfill(true); assert.equal(again.rows_to_add, 0, "running it again adds nothing");
  // the admin route: dev only, flag on, dry first
  const admin = await seenBackfillAdmin(env, { dry: true, slug: "ck1", archive: (e, tid) => A });
  assert.equal(admin.dry, true); assert.equal(admin.results[0].slug, "ck1"); assert.equal(admin.results[0].rows_to_add, 0);
  assert.match((await seenBackfillAdmin({ ...env, ENV_NAME: "live" }, { archive: () => A })).error, /dev only/); assert.match((await seenBackfillAdmin({ ...env, HS_WALLS: "off" }, { archive: () => A })).error, /HS_WALLS is off/);
  assert.equal((await seenBackfillAdmin(env, { slug: "nope", archive: () => A })).error, "no such workspace");
  ok("the backfill builds rows from facts and Notebook people rows, ignores General and missing channels, is dry by default and idempotent, and leaves unplaced contacts General only");
}

console.log(`walls: ${passed} passed`);
process.exit(0);
