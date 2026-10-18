// Real store -> General wrapper -> next store page. No network/model calls.
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
const host = { sql, gen: 0, ctx: { storage: { transactionSync: fn => fn() } }, get: k => kv.get(k), put: (k, v) => v == null ? kv.delete(k) : kv.set(k, String(v)), tid: () => "pagination", arm: async () => {}, bump() {}, ledger: () => ({ settle: async () => {}, reserve: async () => ({ ok: true }) }), env: { ONEHELM_EE: "1hc",
  OPENROUTER_API_KEY: "unit-no-network", DB: { prepare: () => ({ bind() { return this; }, first: async () => ({ status: "active", plan: "plus" }) }) },
  RESIDENT: { idFromName: x => x, get: () => ({ ambientPrivacy: async lines => ({ mode: "on", allowed: lines.map((_, i) => i) }) }) },
} };
const store = new AmbientStore(host), T = Date.UTC(2026, 9, 10);
store.review = retainReview;
store.extract = async lines => ({ items: lines.map((l, i) => ({ line: i, quote: l.text, kind: "task", speech_act: "intention", status: "open" })) });
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error("pagination test must not call network"); };
try {
  for (let i = 1; i <= 3; i++) await store.ingest("fixture", i, { id: i, state: "COMPLETED", start_time: T + i * 60000, end_time: T + i * 60000 + 1000,
    primary_location: { address: `Library branch ${i}`, latitude: 37.8 + i / 100, longitude: -122.27, created_at: T + i * 60000 },
    transcriptions: [{ realtime: false, utterances: [{ id: `u${i}`, text: `I need to review library book ${i}.`, speaker: "wearer", is_user: true, spoken_at: T + i * 60000 }] }],
  });
  await store.run();
  let reads = 0, forgotten = false;
  const res = { get: k => ({ tenant: "pagination", channel: "main" })[k], memoryMode: () => "on", forgottenNow: text => forgotten && text.includes("book 3"), env: { ONEHELM_EE: "1hc",
    BEE_SYNC: { idFromName: x => x, get: () => ({ ambientQuery: async args => { reads++; return store.query(args); } }) },
    DB: { prepare: () => ({ bind() { return this; }, first: async () => null }) },
  } };
  const dates = { from: new Date(T).toISOString(), to: new Date(T + 86400000).toISOString() };
  for (const mode of ["items", "transcript", "locations"]) {
    const filters = { mode, ...dates, limit: 1 }, found = []; let cursor;
    do {
      const page = await ambientQuery(res, { ...filters, ...(cursor ? { cursor } : {}) });
      assert.equal(page.error, undefined); const list = page[mode === "items" ? "items" : mode === "transcript" ? "transcripts" : "locations"];
      assert.equal(list.length, 1); found.push(list[0].id);
      cursor = page.next_cursor;
      if (cursor) { assert.notEqual(cursor, "[secret removed]"); assert.equal(scrubSecrets(cursor), "[secret removed]", "actual backend cursor triggers the old bug"); }
      assert.ok(found.length <= 3, "pagination must advance, never loop");
    } while (cursor);
    assert.equal(new Set(found).size, 3, mode + " complete without duplicate or omitted record");
  }
  let cursor, places = [];
  do {
    const page = await locationQuery(res, { ...dates, limit: 1, ...(cursor ? { cursor } : {}) });
    assert.equal(page.coverage.bee_error, undefined); places.push(...page.bee_locations.map(x => x.id)); cursor = page.next_cursor;
    assert.ok(places.length <= 3);
  } while (cursor);
  assert.equal(new Set(places).size, 3, "unified location tool preserves real Bee pagination");
  forgotten = true;
  const hidden = await ambientQuery(res, { mode: "transcript", ...dates, limit: 1 });
  assert.equal(hidden.transcripts.length, 0); assert.equal(hidden.coverage.withheld_by_memory_preferences, 1); assert.ok(hidden.next_cursor);
  const next = await ambientQuery(res, { mode: "transcript", ...dates, limit: 1, cursor: hidden.next_cursor });
  assert.equal(next.transcripts.length, 1); assert.match(next.transcripts[0].text, /book 2/); forgotten = false;
  const valid = await ambientQuery(res, { ...dates, limit: 1 });
  for (const args of [
    { cursor: "[secret removed]" }, { cursor: "page-2" }, { cursor: valid.next_cursor, kind: "idea", ...dates },
    { evidence_id: "fictional-item" }, { mode: "transcript", evidence_id: valid.items[0].id },
    { ...dates, cursor: valid.next_cursor, evidence_id: valid.items[0].id },
  ]) { const before = reads, out = await ambientQuery(res, args); assert.equal(out.status, "invalid_query"); assert.equal(reads, before, "bad protocol rejected before storage"); }
  const evidence = await ambientQuery(res, { evidence_id: valid.items[0].id });
  assert.ok(evidence.evidence?.lines.length, "real extracted evidence lookup still works");
  const decoded = JSON.parse(atob(valid.next_cursor));
  const encode = x => btoa(JSON.stringify(x));
  const secret = "sk-proj-abcdefghijklmnopqrstuvwx1234567890";
  const duplicateId = btoa(JSON.stringify(decoded).replace('"id":', `"id":"${secret}","id":`));
  for (const bad of [secret, duplicateId, encode({ ...decoded, id: secret }), encode({ ...decoded, injected: secret }), encode({ ...decoded, revision: -1 }), encode({ ...decoded, signature: JSON.stringify(["items", null, "all", "all", secret, null, null, null]) })]) {
    const malicious = { ...res, env: { ONEHELM_EE: "1hc",  BEE_SYNC: { idFromName: x => x, get: () => ({ ambientQuery: async () => ({ items: [{ text: `API key ${secret}`, next_cursor: valid.next_cursor }], coverage: {}, next_cursor: bad }) }) } } };
    const out = await ambientQuery(malicious, dates);
    assert.equal(out.next_cursor, null); assert.equal(out.coverage.pagination_incomplete, true);
    assert.equal(out.items[0].next_cursor, "[secret removed]", "only top-level validated protocol may bypass scrubbing");
    assert.doesNotMatch(JSON.stringify(out), new RegExp(secret)); assert.match(out.items[0].text, /secret removed/);
  }
  const stale = valid.next_cursor;
  store.remove("fixture", 3);
  const changed = await ambientQuery(res, { ...dates, limit: 1, cursor: stale });
  assert.match(changed.error, /changed/); assert.equal(changed.next_cursor, null, "backend still rejects stale revision");
  const unicode = "図".repeat(500);
  for (let i = 4; i <= 5; i++) await store.ingest("fixture", i, { id: i, state: "COMPLETED", start_time: T + i * 60000, end_time: T + i * 60000 + 1000, primary_location: { address: unicode, latitude: 37.8, longitude: -122.27 }, transcriptions: [{ utterances: [{ text: unicode, spoken_at: T + i * 60000 }] }] });
  const placeUnicode = await locationQuery(res, { query: unicode, limit: 1 });
  assert.ok(placeUnicode.next_cursor.length > 2000);
  const placeNextUnicode = await locationQuery(res, { query: unicode, limit: 1, cursor: placeUnicode.next_cursor });
  assert.equal(placeNextUnicode.bee_locations.length, 1); assert.notEqual(placeUnicode.bee_locations[0].id, placeNextUnicode.bee_locations[0].id);
  console.log("PASS real item/transcript/location/unified-location pagination, hidden pages, exact evidence, invalid/stale cursors and secret isolation");
} finally { globalThis.fetch = originalFetch; db.close(); }
