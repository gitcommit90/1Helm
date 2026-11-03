// BeeSync's ambient store must not read every chunk or item on each alarm. A Durable Object bills rows read, and these statements read the whole
// chunk table once per open chunk (dueAt) or once per page (inbox), which came to billions of rows a month for one Bee account.
// node:sqlite has no rowsRead, so the test pins the query plans (an index search or a partial index, never a scan of ambient_chunks) and the
// number of statements previous() runs for a repeated check. Needs: node --import ./test/stubs/register.mjs
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite";
import * as S from "../src/ee/bee-sync.js";
const db = new DatabaseSync(":memory:"), seen = [];
const sql = { exec: (q, ...a) => { seen.push(q); if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = db.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
const b = new S.BeeSync({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, transactionSync: (f) => f() } }, { OPENROUTER_API_KEY: "k" });
const N = 400;
db.exec("BEGIN");
for (let i = 1; i <= N; i++) {
  db.prepare("INSERT INTO ambient_sources (source,source_id,revision,source_at,live,ingested_at,processed_at,chunks,source_until,location_version,projection_version) VALUES ('bee',?,'r',?,0,?,?,5,?,1,2)").run(String(i), i * 1000, i, i, i * 1000);
  for (let c = 0; c < 5; c++) {
    const state = i > N - 3 && c < 2 ? "failed" : "done";
    db.prepare("INSERT INTO ambient_chunks (source,source_id,hash,ordinal,active,lines,state,retry_at) VALUES ('bee',?,?,?,1,'[]',?,?)").run(String(i), `h${i}_${c}`, c, state, state === "failed" ? 9e15 : 0);
    if (state === "done") db.prepare("INSERT INTO ambient_items VALUES (?,?,?,?,?,?)").run(`ambient:${i}_${c}`, "bee", String(i), `h${i}_${c}`, i * 1000 + c, JSON.stringify({ kind: "task", text: "buy milk", status: "open" }));
  }
}
db.exec("COMMIT");
const plan = (q, args) => db.prepare("EXPLAIN QUERY PLAN " + q).all(...args).map((r) => r.detail);
const take = (fn) => { seen.length = 0; const out = fn(); return { out, stmts: seen.filter((q) => /^\s*SELECT/i.test(q)).slice() }; };
const scansChunks = (p) => p.some((d) => (/^(SCAN|SEARCH) (c|p|ambient_chunks)\b/.test(d) && !/ambient_chunk_open|ambient_chunk_processing|autoindex/.test(d)) || /USING INDEX ambient_queue \(active=\?\)$/.test(d));
// dueAt and eligible: the statements they run use the partial index on open chunks for the outer and the inner chunk.
const due = take(() => b.ambient.dueAt()); assert.ok(due.out >= 0);
const dueQ = due.stmts.find((q) => /MIN\(MAX\(c\.retry_at/.test(q)); assert.ok(dueQ, "dueAt ran its aggregate");
const dp = plan(dueQ, [30 * 60e3]); assert.ok(dp.some((d) => /ambient_chunk_open/.test(d)), dp.join("|")); assert.ok(!scansChunks(dp), dp.join("|"));
const el = take(() => b.ambient.eligible(false, 6)); const elQ = el.stmts.find((q) => /SELECT c\.\* FROM ambient_chunks/.test(q));
const ep = plan(elQ, [Date.now(), 0, Date.now(), 6]); assert.ok(ep.some((d) => /ambient_chunk_open/.test(d)) && !scansChunks(ep), ep.join("|"));
assert.ok(plan("UPDATE ambient_chunks SET claim_token=NULL WHERE state='processing'", []).some((d) => /ambient_chunk_processing/.test(d)), "claim reset uses the partial index");
// The inbox page and the item page start from ambient_items in index order, so a page reads about a page of rows.
const ip = plan("SELECT i.id FROM ambient_items i CROSS JOIN ambient_chunks c ON c.source=i.source AND c.source_id=i.source_id AND c.hash=i.chunk_hash WHERE c.active=1 AND c.state='done' AND i.id>? ORDER BY i.id LIMIT 200", [""]);
assert.ok(/ambient_items/.test(ip[0]) && !/SEARCH c USING INDEX ambient_queue/.test(ip[0]), ip.join("|"));
// previous(): the same lines at the same revision are answered without a second read, and the lean item queries run no coverage statements.
const lines = [{ text: "remind me to buy milk tomorrow morning please" }];
const first = take(() => b.ambient.previous(lines)), again = take(() => b.ambient.previous(lines));
assert.deepEqual(again.stmts.filter((q) => !/FROM kv WHERE k=/.test(q)), [], "a repeated check reads only the revision");
assert.ok(!first.stmts.some((q) => /COUNT\(\*\) n,MIN\(s\.source_at\)/.test(q) || /GROUP BY c\.state/.test(q) || /SUM\(COALESCE\(json_extract\(c\.grounding_json/.test(q)), "previous reads no coverage counts");
assert.ok(first.out.length > 0 && first.out.every((x) => x.kind === "task"));
b.put("ambient_revision", 5); assert.ok(take(() => b.ambient.previous(lines)).stmts.filter((q) => !/FROM kv WHERE k=/.test(q)).length > 0, "a new revision reads again");
// Same answer as the full query's items.
assert.deepEqual(b.ambient.query({ limit: 30, lean: true }).items.map((x) => x.id), b.ambient.query({ limit: 30 }).items.map((x) => x.id));
console.log("  ok do-rows ambient plans and previous() cache");
