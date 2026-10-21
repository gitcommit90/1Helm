// Items and locations pages stay under the 16000 character delivery limit with a working cursor, and the helper sees Bee's raw speaker label but none of 1Helm's own reading of who spoke.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { retainReview } from "./ambient-review-stub.mjs";
import { AmbientStore } from "../src/ee/ambient.js";
import { ambientQuery } from "../src/ee/ambient-query.js";
import { locationQuery } from "../src/location-query.js";
import { scrubSecrets } from "../src/secrets-scrub.js";
const db = new DatabaseSync(":memory:"), kv = new Map([["tenant", "itemspage"], ["status", "active"]]);
db.exec("CREATE TABLE convs(id INTEGER PRIMARY KEY,start_time INTEGER,r2_key TEXT)");
const sql = { exec(q, ...args) { if (!args.length && q.split(";").filter(x => x.trim()).length > 1) { db.exec(q); return { toArray: () => [] }; } const s = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? s.all(...args) : (s.run(...args), []); return { toArray: () => rows }; } };
const host = { sql, gen: 0, ctx: { storage: { transactionSync: fn => fn() } }, get: k => kv.get(k), put: (k, v) => v == null ? kv.delete(k) : kv.set(k, String(v)), tid: () => "itemspage", arm: async () => {}, bump() {}, ledger: () => ({ settle: async () => {}, reserve: async () => ({ ok: true }) }), env: {
  OPENROUTER_API_KEY: "unit-no-network", DB: { prepare: () => ({ bind() { return this; }, first: async () => ({ status: "active", plan: "plus" }) }) },
  RESIDENT: { idFromName: x => x, get: () => ({ ambientPrivacy: async lines => ({ mode: "on", allowed: lines.map((_, i) => i) }) }) },
} };
const store = new AmbientStore(host), T = Date.UTC(2026, 9, 10);
store.review = retainReview;
store.extract = async lines => ({ items: lines.map((l, i) => ({ line: i, quote: l.text, kind: "task", speech_act: "intention", status: "open" })) });
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error("no network"); };
try {
  const words = "so we talked about the budget and the schedule for the quarter and who owns each part of the launch plan with the vendor ".repeat(2).slice(0, 200);
  const utterances = Array.from({ length: 60 }, (_, i) => ({ id: `u${i}`, text: `${words} ${i}`, speaker: "Unknown", is_user: false, spoken_at: T + i * 1000 }));
  await store.ingest("fixture", 1, { id: 1, state: "COMPLETED", start_time: T, end_time: T + 70000, transcriptions: [{ realtime: false, utterances }] });
  for (let i = 2; i <= 61; i++) await store.ingest("fixture", i, { id: i, state: "COMPLETED", start_time: T + i * 100000, end_time: T + i * 100000 + 1000,
    primary_location: { address: `3003 Exposition Boulevard, Santa Monica, California, Los Angeles County, 90404, United States ${i}`, latitude: 34.03, longitude: -118.46, created_at: T + i * 100000 },
    transcriptions: [{ realtime: false, utterances: [{ id: `l${i}`, text: `I will be at place ${i}.`, speaker: "Unknown", is_user: false, spoken_at: T + i * 100000 }] }] });
  await store.run();
  const res = { tz: () => "America/Los_Angeles", get: k => ({ tenant: "itemspage", channel: "main" })[k], memoryMode: () => "on", forgottenNow: () => false, env: {
    ONEHELM_EE: "1hc", BEE_SYNC: { idFromName: x => x, get: () => ({ ambientQuery: async args => store.query(args) }) }, DB: { prepare: () => ({ bind() { return this; }, first: async () => null }) } } };
  // Items: whole pages stay at 15000 characters or less, the cursor continues without gaps, and the count stays the stored total.
  const seen = []; let cursor, pages = 0, first;
  do {
    const page = await ambientQuery(res, { mode: "items", source_id: "1", limit: 50, ...(cursor ? { cursor } : {}) });
    const size = JSON.stringify(page).length; assert.equal(page.error, undefined);
    assert.ok(size <= 15000, `an items page is ${size} characters`);
    if (!first) { first = page; console.log("items first page", page.items.length, "chars", size, "total", page.total); }
    seen.push(...page.items, ...(page.possibly_said || [])); cursor = page.next_cursor; pages++;
  } while (cursor && pages < 30);
  assert.ok(first.items.length >= 8 && first.items.length < 50 && first.next_cursor, "the budget cut the first page");
  assert.ok(first.total >= 55, "the count is the stored total");
  assert.equal(new Set(seen.map(x => x.id)).size, first.total, "paging by cursor returns every item once");
  // Model-facing items: the raw speaker label stays, the speaker reading is gone.
  const text = JSON.stringify(first);
  for (const k of ["attribution", "is_user", "speaker_id", "capture_attribution", '"owner"']) assert.ok(!text.includes(k), `${k} is left out`);
  assert.ok(!/ambiguous speakers/.test(text), "no coverage note about ambiguous speakers");
  assert.match(first.items[0].said, /^Unknown: so we talked/, "the raw speaker label stays with the quote");
  assert.deepEqual(Object.keys(first.items[0]).sort(), ["at", "id", "kind", "recording", "said", "status", "text"], "a plain item is only what the helper reads");
  assert.equal(first.items[0].needs_review, undefined, "a speaker that is not the wearer is not a reason to review");
  assert.match(first.items[0].at, /^\w{3} 2026-10-\d\dT\d\d:\d\d:\d\d-07:00$/);
  const stored = store.query({ mode: "items", source_id: "1", limit: 1 }).items[0];
  assert.equal(stored.attribution.is_user, false, "stored items keep the attribution"); assert.equal(stored.owner != null, true);
  // Transcript lines keep the raw label and lose the speaker fields.
  const tr = await ambientQuery(res, { mode: "transcript", source_id: "1", limit: 5 });
  assert.match(tr.transcript, /\n-- 2026-10-09 --\n\[17:00:00\] Unknown: so we talked/); assert.ok(!/is_user|speaker_id|attribution/.test(JSON.stringify(tr)));
  // Locations: the same budget, through ambient_query and through location_query.
  const locSeen = []; cursor = undefined; pages = 0;
  do {
    const page = await ambientQuery(res, { mode: "locations", limit: 50, ...(cursor ? { cursor } : {}) });
    assert.ok(JSON.stringify(page).length <= 15000, "a locations page stays under the bound"); locSeen.push(...page.locations); cursor = page.next_cursor; pages++;
    if (pages === 1) { assert.ok(page.locations.length < 50 && page.next_cursor); assert.equal(page.total, 60); }
  } while (cursor && pages < 30);
  assert.equal(new Set(locSeen.map(x => x.id)).size, 60, "location paging returns every place once");
  const placeCursor = (await ambientQuery(res, { mode: "locations", limit: 50 })).next_cursor;
  const viaTool = await locationQuery(res, { limit: 50 }), toolSize = JSON.stringify(viaTool).length;
  assert.ok(toolSize <= 15000, `a location_query page is ${toolSize} characters`);
  assert.ok(viaTool.coverage.bee.locations_matching === 60 && (await locationQuery(res, { limit: 50, cursor: placeCursor })).bee_locations.length > 0);
  console.log("PASS ambient-items-page");
} finally { globalThis.fetch = originalFetch; db.close(); }
