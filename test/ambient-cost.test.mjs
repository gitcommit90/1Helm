// node --import ./test/stubs/register.mjs test/ambient-cost.test.mjs
// Cost rules of ambient pick-up: the model waits for a finished conversation, runs in one session at most every 30 minutes, and skips near-empty speech.
// Storing and searching speech stay immediate. The model is a counting stub, not a quality check.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { retainReview } from "./ambient-review-stub.mjs";
import { AmbientStore, QUIET_MS, RUN_GAP_MS, MIN_SPEECH_WORDS } from "../src/ee/ambient.js";

const T0 = Date.UTC(2026, 9, 20, 9), realNow = Date.now; let clock = T0; Date.now = () => clock;
const MIN = 60e3;
function fixture() {
  const db = new DatabaseSync(":memory:"), kv = new Map([["tenant", "cost"], ["status", "active"]]);
  db.exec("CREATE TABLE convs(id INTEGER PRIMARY KEY,start_time INTEGER,r2_key TEXT)");
  const sql = { exec(q, ...args) { if (!args.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [] }; } const st = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...args) : (st.run(...args), []); return { toArray: () => rows }; } };
  const F = { db, kv, extract: 0, review: 0 };
  F.host = { sql, gen: 0, ctx: { storage: { transactionSync: (fn) => fn() } }, get: (k) => kv.get(k), put: (k, v) => v == null ? kv.delete(k) : kv.set(k, String(v)), tid: () => "cost", arm: async () => {}, bump() {}, ledger: () => ({ settle: async () => {}, reserve: async () => ({ ok: true }) }), env: { ONEHELM_EE: "1hc",
    OPENROUTER_API_KEY: "unit-no-network", DB: { prepare() { return { bind() { return this; }, async first() { return { status: "active", plan: "plus" }; } }; } }, WS: { get: async () => null },
    RESIDENT: { idFromName: (i) => i, get: () => ({ ambientPrivacy: async (texts) => ({ mode: "on", allowed: texts.map((_, i) => i) }) }) } } };
  F.attach = () => { F.store = new AmbientStore(F.host); F.store.extract = async (lines) => { F.extract++; return { items: lines.flatMap((l, i) => /need/.test(l.text) ? [{ kind: "task", quote: l.text, line: i, status: "open", relation: null, supersedes: [] }] : []) }; }; F.store.review = async (input) => { F.review++; return retainReview(input); }; };
  F.attach(); F.calls = () => F.extract + F.review;
  F.gated = () => F.store.run(false, true);   // the alarm path
  return F;
}
const talk = (id, n, at = clock) => Array.from({ length: n }, (_, k) => ({ id: `u${id}-${k}`, text: `I need to handle thing number ${k} for the project today ${"and some more words ".repeat(7)}`, speaker: { name: "Ana", is_user: true }, spoken_at: at + k * 1000 }));
const conv = (id, utterances, end = null) => ({ id, start_time: T0, end_time: end, updated_at: 1, transcriptions: [{ realtime: end == null, utterances }] });
const failures = [];
async function check(name, fn) { clock = T0; try { await fn(); console.log(`PASS ${name}`); } catch (e) { failures.push(name); console.error(`FAIL ${name}\n${e.stack}`); } }

await check("an open conversation never calls the model, is extracted once after end_time, and stays searchable meanwhile", async () => {
  const F = fixture();
  for (let i = 0; i < 6; i++) { clock = T0 + i * 5 * MIN; await F.store.ingest("bee", 1, conv(1, talk(1, 3 + i * 3, T0))); await F.gated(); }
  assert.equal(F.calls(), 0, "no model call while the conversation is open");
  const q = F.store.query({ mode: "transcript" }); assert.ok(q.transcripts.length >= 18, "stored speech is searchable at once");
  assert.equal(q.coverage.live_sources, 1); assert.ok(q.coverage.queued > 0); assert.equal(q.coverage.processing_complete, false, "pending, so the helper reads the transcript");
  clock += 5 * MIN; await F.store.ingest("bee", 1, conv(1, talk(1, 20, T0), clock)); await F.gated();
  assert.ok(F.extract > 0); const after = F.calls(); clock += 5 * MIN; await F.gated(); await F.gated(); assert.equal(F.calls(), after, "extracted once");
  assert.equal(F.store.query().coverage.processing_complete, true);
});

await check("a growing conversation synced 24 times costs model calls only once, at the end", async () => {
  const F = fixture(), us = [];
  for (let s = 0; s < 24; s++) { clock = T0 + s * 5 * MIN; us.push(...talk(`g${s}`, 8, clock)); const last = s === 23; await F.store.ingest("bee", 1, conv(1, us.slice(), last ? clock : null)); await F.gated(); if (!last) assert.equal(F.calls(), 0); }
  for (let i = 0; i < 4; i++) { clock += 5 * MIN; await F.gated(); }
  const chunks = F.db.prepare("SELECT count(*) n FROM ambient_chunks WHERE active=1 AND state='done'").get().n;
  assert.equal(F.extract, chunks, "one extraction per chunk, none repeated"); assert.ok(chunks > 1);
});

await check("a conversation that never closes is extracted once it has had no new revision for 30 minutes", async () => {
  const F = fixture(); await F.store.ingest("bee", 1, conv(1, talk(1, 6, T0)));
  clock = T0 + QUIET_MS - MIN; await F.gated(); assert.equal(F.calls(), 0);
  assert.ok(F.store.dueAt() >= T0 + QUIET_MS, "the alarm waits for the quiet time");
  clock = T0 + QUIET_MS + MIN; await F.gated(); assert.ok(F.extract > 0);
  const n = F.calls(); clock += 10 * MIN; await F.gated(); assert.equal(F.calls(), n);
});

await check("a finished conversation that Bee revises is queued again and runs in the next session", async () => {
  const F = fixture(); await F.store.ingest("bee", 1, conv(1, talk(1, 4, T0), T0 + 1000)); await F.gated(); const first = F.extract; assert.ok(first > 0);
  clock += 10 * MIN; await F.store.ingest("bee", 1, conv(1, talk(1, 8, T0), T0 + 1000)); await F.gated(); assert.equal(F.extract, first, "inside the 30 minute gap");
  clock = T0 + RUN_GAP_MS + MIN; await F.gated(); assert.ok(F.extract > first);
});

await check("two runs inside 30 minutes call the model once; the spacing survives a restart", async () => {
  const F = fixture(); await F.store.ingest("bee", 1, conv(1, talk(1, 4, T0), T0 + 1000)); await F.gated(); const first = F.calls(); assert.ok(first > 0);
  clock += 10 * MIN; await F.store.ingest("bee", 2, conv(2, talk(2, 4, clock), clock)); await F.gated(); assert.equal(F.calls(), first);
  F.attach(); clock += 10 * MIN; await F.gated(); assert.equal(F.calls(), first, "restart does not reset the gap");
  assert.ok(F.store.dueAt() >= T0 + RUN_GAP_MS, "the alarm is set for when the gap ends");
  clock = T0 + RUN_GAP_MS + MIN; await F.gated(); assert.ok(F.calls() > first, "the waiting conversation is extracted in the next session");
});

await check("a backlog drains inside one session across several alarms", async () => {
  const F = fixture(); for (let i = 1; i <= 8; i++) await F.store.ingest("bee", i, conv(i, talk(i, 3, T0 + i * 1000), T0 + 5000));
  await F.gated(); const afterFirst = F.extract; assert.ok(afterFirst > 0 && afterFirst < 8, "one batch per alarm");
  for (let i = 0; i < 4; i++) { clock += 2000; await F.gated(); }
  assert.equal(F.extract, 8); assert.equal(F.host.get("ambient_model_open"), undefined, "session closes when the work is done");
});

await check("near-empty speech makes no model call and is counted as processed", async () => {
  const F = fixture(), short = [{ id: "a", text: "Mm. Yeah.", speaker: "Unknown", spoken_at: T0 }, { id: "b", text: "Uh, okay", speaker: "Unknown", spoken_at: T0 + 1000 }];
  assert.equal(MIN_SPEECH_WORDS, 2);
  await F.store.ingest("bee", 1, conv(1, short, T0 + 5000)); await F.gated();
  assert.equal(F.calls(), 0); const row = F.db.prepare("SELECT state,grounding_json FROM ambient_chunks").get(); assert.equal(row.state, "done"); assert.equal(JSON.parse(row.grounding_json).skipped_short, 1);
  const q = F.store.query(); assert.equal(q.items.length, 0); assert.equal(q.coverage.processing_complete, true); assert.equal(q.coverage.queued, 0); assert.equal(q.coverage.grounding.chunks_without_counts, 0);
  assert.equal(F.host.get("ambient_model_at"), undefined, "skipping needs no session, so it does not start the 30 minute gap");
  await F.store.ingest("bee", 2, conv(2, talk(2, 3, T0), T0 + 5000)); await F.gated(); assert.ok(F.extract > 0, "real speech right after is not delayed");
});

await check("short real voice notes reach the model; only filler or one word is skipped", async () => {
  const one = (id, text) => conv(id, [{ id: `s${id}`, text, speaker: { name: "Ana", is_user: true }, spoken_at: T0 }], T0 + 5000);
  for (const text of ["Buy milk tomorrow", "Call mom"]) { const F = fixture(); await F.store.ingest("bee", 1, one(1, text)); await F.gated(); assert.equal(F.extract, 1, text); }
  for (const text of ["um yeah okay", "Groceries"]) { const F = fixture(); await F.store.ingest("bee", 1, one(1, text)); await F.gated(); assert.equal(F.calls(), 0, text); assert.equal(F.db.prepare("SELECT state FROM ambient_chunks").get().state, "done"); }
});

await check("old re-queue by shared topic words is gone", async () => {
  const F = fixture(); assert.equal(F.store.reconcileLater, undefined);
});
Date.now = realNow;
if (failures.length) { console.error(`${failures.length} ambient cost check(s) failed: ${failures.join("; ")}`); process.exitCode = 1; } else console.log("ambient cost tests passed");
