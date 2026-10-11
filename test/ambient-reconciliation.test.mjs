// Independent chronology regressions; model output is deterministic, not a
// semantic quality score. AMBIENT_MODULE supports the core owner's draft module.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { retainReview } from "./ambient-review-stub.mjs";
import { pathToFileURL } from "node:url";
const { AmbientStore } = await import(process.env.AMBIENT_MODULE ? pathToFileURL(process.env.AMBIENT_MODULE) : "../src/ee/ambient.js");
const T = Date.UTC(2026, 9, 10), original = "I should host the neighborhood seed swap.", cancellation = "Actually cancel the neighborhood seed swap idea.";
const topic = (text) => /seed swap/i.test(text) ? "seed" : /library books/i.test(text) ? "books" : null;
const line = (text, at = T, speaker = "Unknown", id = String(at)) => ({ text, spoken_at: at, speaker, id });
const conversation = (id, utterances) => ({ id, start_time: Math.min(...utterances.map((x) => x.spoken_at)), end_time: Math.max(...utterances.map((x) => x.spoken_at)) + 1000, state: "COMPLETED", transcriptions: [{ realtime: false, utterances }] });
const splitConversation = (text = original) => conversation(1, [line(text, T, "Unknown", "intention"),
  ...Array.from({ length: 6 }, (_, i) => line(`BACKGROUND${i} ${"room tone ".repeat(200)}`, T + (i + 1) * 60e3, null, `noise${i}`)),
  line(cancellation, T + 600e3, "Unknown", "cancellation")]);

function fixture() {
  const db = new DatabaseSync(":memory:"), kv = new Map([["tenant", "chronology"], ["status", "active"]]);
  db.exec("CREATE TABLE convs(id INTEGER PRIMARY KEY,start_time INTEGER,r2_key TEXT)");
  const sql = { exec(q, ...args) { if (!args.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [] }; } const st = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...args) : (st.run(...args), []); return { toArray: () => rows }; } };
  const F = { db, sql, calls: [], failFirst: false, failures: 0, arms: [] };
  const host = { sql, gen: 0, ctx: { storage: { transactionSync: (fn) => fn() } }, get: (k) => kv.get(k), put: (k, v) => v == null ? kv.delete(k) : kv.set(k, String(v)), tid: () => "chronology", arm: async (at) => F.arms.push(at), bump() {}, ledger: () => ({ settle: async () => {}, reserve: async () => ({ ok: true }) }), env: { ONEHELM_EE: "1hc",
    OPENROUTER_API_KEY: "unit-no-network", DB: { prepare(q) { return { bind() { return this; }, async first() { return q.includes("tenant_flags") ? null : { status: "active", plan: "plus" }; } }; } },
    WS: { get: async () => { throw Error("unexpected raw fetch"); } }, RESIDENT: { idFromName: (id) => id, get: (id) => { assert.equal(id, "res:chronology:main"); return { ambientPrivacy: async (texts) => ({ mode: "on", allowed: texts.map((_, i) => i) }) }; } },
  } };
  F.store = new AmbientStore(host);
  F.store.review = retainReview;
  F.store.extract = async (lines, previous, tenant, chunk) => {
    F.calls.push({ source: chunk.source_id, hash: chunk.hash, texts: lines.map((x) => x.text) });
    if (F.failFirst && !F.failures && lines.some((l) => l.text === original)) { F.failures++; throw Error("synthetic earlier-chunk failure"); }
    return { items: lines.flatMap((l, i) => {
      if (l.text.startsWith("BACKGROUND")) return [];
      const key = topic(l.text), completed = /returned/.test(l.text), cancelled = /cancel/.test(l.text), repeat = /Still/.test(l.text);
      const relation = cancelled ? "cancellation" : completed ? "completion" : repeat ? "repeat" : null;
      const supersedes = relation && key ? [
        ...previous.filter((p) => topic(p.text) === key).map((p) => p.id),
        ...lines.slice(0, i).flatMap((p, j) => topic(p.text) === key ? [`line:${j}`] : []),
      ] : [];
      return [{ kind: key === "seed" ? "idea" : "task", line: i, quote: l.text, status: cancelled ? "cancelled" : completed ? "completed" : "open", relation, supersedes }];
    }) };
  };
  F.drain = async () => {
    for (let i = 0; i < 20; i++) {
      const unfinished = db.prepare("SELECT count(*) n FROM ambient_chunks WHERE active=1 AND state<>'done'").get().n;
      if (!unfinished) return;
      await F.store.run(true);
    }
    assert.fail("chronological reconciliation did not drain in 20 batches");
  };
  return F;
}
const currentSeed = (F) => F.store.query({ query: "seed swap" }).items;
const expectCancelled = (F) => {
  const items = currentSeed(F); assert.equal(items.length, 1, "one current intention, not a reopened older duplicate");
  assert.equal(items[0].status, "cancelled"); assert.equal(items[0].owner, "Unknown"); assert.equal(items[0].needs_review, true);
  assert.ok(items[0].earlier_evidence?.some((x) => /should/.test(x.quote)), "later cancellation links to original evidence");
};
const failures = [];
async function check(name, fn) { try { await fn(); console.log(`PASS ${name}`); } catch (e) { failures.push(name); console.error(`FAIL ${name}\n${e.stack}`); } }

await check("failed earlier chunk blocks its suffix, not unrelated source; alarm honors retry time", async () => {
  const F = fixture(); F.failFirst = true;
  await F.store.ingest("bee", 1, splitConversation());
  assert.ok(F.db.prepare("SELECT count(*) n FROM ambient_chunks WHERE source_id='1'").get().n > 1);
  await F.store.ingest("bee", 2, conversation(2, [line("I need to buy printer ink.", T + 900e3)]));
  await F.store.run(true);
  assert.equal(F.failures, 1);
  assert.ok(!F.calls.some((c) => c.texts.includes(cancellation)), "later cancellation must not run past failed predecessor");
  assert.equal(F.store.query({ query: "printer ink" }).items.length, 1, "independent source progresses");
  const due = F.db.prepare("SELECT retry_at FROM ambient_chunks WHERE state='failed'").get().retry_at;
  assert.equal(F.store.dueAt(), due, "blocked zero-retry suffix must not cause 1-second alarm spin");
  F.sql.exec("UPDATE ambient_chunks SET retry_at=0 WHERE state='failed'"); await F.drain(); expectCancelled(F);
});

await check("revised earlier source reuses then reconciles later unchanged cancellation chunk", async () => {
  const F = fixture(); await F.store.ingest("bee", 1, splitConversation()); await F.drain(); expectCancelled(F);
  const oldSuffix = F.db.prepare("SELECT hash FROM ambient_chunks WHERE ordinal>0").all().map((r) => r.hash), before = F.calls.length;
  await F.store.ingest("bee", 1, splitConversation(original.replace("host", "lead")));
  const suffix = F.db.prepare("SELECT hash FROM ambient_chunks WHERE ordinal>0").all().map((r) => r.hash);
  assert.ok(oldSuffix.some((h) => suffix.includes(h)), "fixture really retains an unchanged suffix hash");
  await F.drain(); expectCancelled(F);
  assert.ok(F.calls.slice(before).some((c) => c.texts.includes(cancellation)), "later semantic dependencies must be reconciled again");
  assert.ok(currentSeed(F)[0].earlier_evidence.some((x) => /lead/.test(x.quote)));
});

await check("late historical source reconciles existing later cancellation without disturbing unrelated work", async () => {
  const F = fixture();
  await F.store.ingest("bee", 2, conversation(2, [line(cancellation, T + 600e3)]));
  await F.store.ingest("bee", 3, conversation(3, [line("I need to buy printer ink.", T + 900e3)]));
  await F.drain(); const unrelated = F.store.query({ query: "printer ink" }).items[0], before = F.calls.filter((c) => c.source === "3").length;
  await F.store.ingest("bee", 1, conversation(1, [line(original, T)])); await F.drain(); expectCancelled(F);
  assert.equal(F.store.query({ query: "printer ink" }).items[0].id, unrelated.id);
  assert.equal(F.calls.filter((c) => c.source === "3").length, before, "unrelated transcript need not incur another extraction");
});

await check("same-chunk line references consolidate repeat/completion and cancellation, preserving unknown owner", async () => {
  const F = fixture(); await F.store.ingest("bee", 1, conversation(1, [
    line(original, T), line("Still should host the neighborhood seed swap.", T + 1000), line(cancellation, T + 2000),
    line("I need to return the library books.", T + 3000), line("I returned the library books.", T + 4000), line("I need to buy printer ink.", T + 5000),
  ])); await F.drain(); expectCancelled(F);
  const books = F.store.query({ query: "library books" }).items; assert.equal(books.length, 1); assert.equal(books[0].status, "completed");
  assert.ok(books[0].earlier_evidence?.some((e) => /need to/.test(e.quote))); assert.equal(F.store.query({ query: "printer ink" }).items.length, 1);
  assert.ok(F.store.query().items.every((i) => i.owner !== "wearer"));
});

await check("same-chunk cross-speaker cancellation cannot resolve wearer task", async () => {
  const F = fixture(); await F.store.ingest("bee", 1, conversation(1, [line(original, T, { id: "me", is_user: true }), line(cancellation, T + 1000, "Morgan")])); await F.drain();
  const items = currentSeed(F); assert.equal(items.length, 2);
  assert.ok(items.some((x) => x.owner === "wearer" && x.status === "open")); assert.ok(items.some((x) => x.owner === "Morgan" && x.status === "cancelled"));
  assert.ok(items.every((x) => !x.previous_ids?.length));
});

await check("identical spoken text at different times retains distinct evidence identities", async () => {
  const F = fixture(); await F.store.ingest("bee", 1, conversation(1, [line(original, T, "Unknown", "one"), line(original, T + 60000, "Unknown", "two")])); await F.drain();
  const rows = F.db.prepare("SELECT id,data FROM ambient_items").all(); assert.equal(rows.length, 2, "item identity must not collapse distinct source occurrences");
  assert.notEqual(rows[0].id, rows[1].id); assert.deepEqual(rows.map((r) => JSON.parse(r.data).evidence[0].at).sort(), [T, T + 60000]);
});
if (failures.length) { console.error(`${failures.length} reconciliation regression(s) failed: ${failures.join("; ")}`); process.exitCode = 1; }
else console.log("ambient chronology reconciliation tests passed");
