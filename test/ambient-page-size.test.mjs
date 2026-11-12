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
  // The words are about 235 characters a line. A page holds as many compact lines as fit, oldest first for a named recording, and the cursor continues it.
  const page = await ambientQuery(res, { mode: "transcript", source_id: "1", limit: 50 });
  const size = JSON.stringify(page).length, lines = page.transcript.split("\n").filter(l => l.startsWith("["));
  console.log("lines", lines.length, "chars", size);
  assert.ok(size <= 15000, `a full transcript page is ${size} characters`);
  assert.ok(lines.length >= 40 && lines.length < 120, "the budget cut the page");
  assert.ok(page.next_cursor, "more lines remain");
  assert.match(lines[0], /^\[\d\d:\d\d:\d\d\] S: so we talked about the budget.* 0$/, "the oldest line comes first, with Bee's label");
  assert.match(page.transcript.split("\n")[0], /^recording 1, .*local time -07:00; \d+ of 120 lines, oldest first, more in next_cursor$/);
  assert.match(page.coverage.latest_source_at_local, /-07:00$/);
  assert.doesNotMatch(page.transcript, /utterance_id|source_revision|extraction_state|untrusted|is_user|speaker_id/);
  const next = await ambientQuery(res, { mode: "transcript", source_id: "1", cursor: page.next_cursor });
  const more = next.transcript.split("\n").filter(l => l.startsWith("["));
  assert.match(more[0], / (\d+)$/); assert.equal(Number(/ (\d+)$/.exec(more[0])[1]), lines.length, "the next page starts at the next line");
  const whole = [...lines, ...more]; let c = next.next_cursor; while (c) { const p = await ambientQuery(res, { mode: "transcript", source_id: "1", cursor: c }); whole.push(...p.transcript.split("\n").filter(l => l.startsWith("["))); c = p.next_cursor; }
  assert.equal(whole.length, 120, "paging reaches every line once");
  console.log("PASS ambient-page-size");
} finally { globalThis.fetch = originalFetch; db.close(); }
