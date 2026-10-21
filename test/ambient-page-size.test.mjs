// A full transcript page, with coverage and local times, stays under the 16000 character delivery limit.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { retainReview } from "./ambient-review-stub.mjs";
import { AmbientStore } from "../src/ee/ambient.js";
import { ambientQuery } from "../src/ee/ambient-query.js";
import { locationQuery } from "../src/location-query.js";
import { scrubSecrets } from "../src/secrets-scrub.js";
const db = new DatabaseSync(":memory:"), kv = new Map([["tenant", "pagination"], ["status", "active"]]);
db.exec("CREATE TABLE convs(id INTEGER PRIMARY KEY,start_time INTEGER,r2_key TEXT)");
const sql = { exec(q, ...args) { if (!args.length && q.split(";").filter(x => x.trim()).length > 1) { db.exec(q); return { toArray: () => [] }; } const s = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? s.all(...args) : (s.run(...args), []); return { toArray: () => rows }; } };
const host = { sql, gen: 0, ctx: { storage: { transactionSync: fn => fn() } }, get: k => kv.get(k), put: (k, v) => v == null ? kv.delete(k) : kv.set(k, String(v)), tid: () => "pagination", arm: async () => {}, bump() {}, ledger: () => ({ settle: async () => {}, reserve: async () => ({ ok: true }) }), env: {
  OPENROUTER_API_KEY: "unit-no-network", DB: { prepare: () => ({ bind() { return this; }, first: async () => ({ status: "active", plan: "plus" }) }) },
  RESIDENT: { idFromName: x => x, get: () => ({ ambientPrivacy: async lines => ({ mode: "on", allowed: lines.map((_, i) => i) }) }) },
} };
const store = new AmbientStore(host), T = Date.UTC(2026, 9, 10);
store.review = retainReview;
store.extract = async lines => ({ items: lines.map((l, i) => ({ line: i, quote: l.text, kind: "task", speech_act: "intention", status: "open" })) });
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error("no network"); };
try {
  const words = "so we talked about the budget and the schedule for the quarter and who owns each part of the launch plan with the vendor ".repeat(2).slice(0, 230);
  const utterances = Array.from({ length: 120 }, (_, i) => ({ id: `u${i}`, text: `${words} ${i}`, speaker: "S", is_user: false, spoken_at: T + i * 1000 }));
  await store.ingest("fixture", 1, { id: 1, state: "COMPLETED", start_time: T, end_time: T + 130000, transcriptions: [{ realtime: false, utterances }] });
  const res = { tz: () => "America/Los_Angeles", get: k => ({ tenant: "pagination", channel: "main" })[k], memoryMode: () => "on", forgottenNow: () => false, env: {
    ONEHELM_EE: "1hc", BEE_SYNC: { idFromName: x => x, get: () => ({ ambientQuery: async args => store.query(args) }) } } };
  const page = await ambientQuery(res, { mode: "transcript", limit: 50 });
  const size = JSON.stringify(page).length;
  console.log("lines", page.transcripts.length, "chars", size);
  assert.ok(size <= 15000, `a full transcript page is ${size} characters`);
  assert.ok(page.transcripts.length >= 10 && page.transcripts.length < 50, "the budget cut the page");
  assert.ok(page.next_cursor, "more lines remain");
  assert.match(page.transcripts[0].at_local, /^(Fri|Sat) 2026-10-\d\dT\d\d:\d\d:\d\d-07:00$/);
  assert.match(page.coverage.latest_source_at_local, /-07:00$/);
  const next = await ambientQuery(res, { mode: "transcript", limit: 50, cursor: page.next_cursor });
  assert.equal(next.transcripts.length > 0, true, "the cursor from a cut page still works");
  console.log("PASS ambient-page-size");
} finally { globalThis.fetch = originalFetch; db.close(); }
