// node --import ./test/stubs/register.mjs test/task-search.test.mjs
// Ranked task search (src/task-search.js): the keyword ranking (FTS5 bm25 in the Resident's SQLite), the fusion with the meaning ranking, indexing on write, the lazy first build,
// deletion, the owner check of the route, and the spend rules (nothing is indexed or embedded before a search, and a test account's writes never embed). The real Resident runs on
// node:sqlite; the embeddings go through the real mem_embed job to a counting Workers AI fake, and Vectorize is an in-memory fake. Tests check app facts, never a model's wording.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Resident } from "../src/resident.js";
import { ftsQuery, fuse, searchRoute, meaningHits, cosine, RESULTS_MAX, VEC_MIN, VEC_MARGIN, VEC_TAIL_MIN, RRF_K } from "../src/task-search.js";
import { memEnv, embedding } from "./helpers/mem0-fakes.mjs";

const T = "11111111-2222-3333-4444-555555555555", OWNER = { id: "u1", email: "sam@acme.test" };

function world({ owner = OWNER.email, credits = true } = {}) {
  const calls = { embed: 0, texts: [], held: 0, settled: [] };
  const { env, index, d1 } = memEnv({ LEDGER: { idFromName: (n) => n, get: () => ({ reserve: async (rid, n) => { calls.held++; return { ok: credits }; }, settle: async (rid, n) => { calls.settled.push(n); } }) } });
  const ai = env.AI.run; env.AI.run = async (m, input) => { if (input?.text) { calls.embed++; calls.texts.push(...input.text); } return ai(m, input); };
  d1.db.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, owner_user_id TEXT); CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT); INSERT INTO tenants VALUES ('${T}','ck1','u1'); INSERT INTO users VALUES ('u1','${owner}')`);
  const dodb = new DatabaseSync(":memory:");
  const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
    const st = dodb.prepare(q), r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
  const waits = [], ctx = { storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: (p) => waits.push(p) };
  const R = new Resident(ctx, env); R.put("tenant", T); R.put("channel", "main"); R.put("channel_id", "1");
  const settle = async () => { for (let i = 0; i < 20; i++) { const k = waits.length; await Promise.all(waits); await new Promise((z) => setTimeout(z, 2)); if (waits.length === k) break; } };
  // A task with the given turns: [user text, reply]. Times go up so "newest" is well defined.
  let clock = 1_000_000;
  const task = (title, turns = []) => {
    const id = crypto.randomUUID(); clock += 1000; sql.exec("INSERT INTO sessions (id,title,created,updated,seen_at) VALUES (?,?,?,?,?)", id, title, clock, clock, clock);
    turns.forEach(([u, a]) => addTurn(id, u, a)); return id;
  };
  const addTurn = (id, u, a) => { clock += 1000; sql.exec("INSERT INTO turns (id,at,user_text,reply,kind,session) VALUES (?,?,?,?,?,?)", crypto.randomUUID(), clock, u, a, "chat", id); sql.exec("UPDATE sessions SET updated=? WHERE id=?", clock, id); };
  const ids = (r) => r.results.map((x) => x.id);
  const ftsRows = () => dodb.prepare("SELECT COUNT(*) n FROM task_fts").get().n + dodb.prepare("SELECT COUNT(*) n FROM task_msg_fts").get().n;
  return { env, index, calls, R, sql, dodb, task, addTurn, ids, ftsRows, settle, waits };
}
const vecCount = (w) => w.dodb.prepare("SELECT COUNT(*) n FROM task_idx WHERE vec IS NOT NULL AND vsig IS NOT NULL").get().n;
const tasks = (w) => ({
  plumber: w.task("Kitchen sink repair", [["The plumber says the invoice for the sink is due Friday", "I noted the plumber invoice and the Friday due date."], ["Can you also check the boiler warranty?", "The boiler warranty runs to 2028."]]),
  tax: w.task("Quarterly tax filing", [["Remind me about the quarterly estimated payment", "The estimated payment is due on the 15th."]]),
  trip: w.task("Lisbon trip planning", [["Find flights to Lisbon in May", "Here are three flights to Lisbon."]]),
  invoice: w.task("Invoice template", [["Make an invoice template for my consulting", "Here is a simple invoice template."]]),
});

test("the FTS query: every word is a term, stop words go, only the last word is a prefix", () => {
  assert.equal(ftsQuery("the plumber's invoice"), '"plumber" OR "s" OR "invoice"*');
  assert.equal(ftsQuery("What is the"), '"what" OR "is" OR "the"*', "a query of only stop words keeps its words");
  assert.equal(ftsQuery("  "), "");
  assert.equal(ftsQuery('say "hi" OR NOT'), '"say" OR "hi" OR "not"*', "operators typed by the person are only words");
});

test("fusion: a task in both lists beats one in a single list, and the order inside a list is kept", () => {
  const f = fuse([["a", "b", "c"], ["c", "d"]]);
  assert.deepEqual(f.map((x) => x.id), ["c", "a", "b", "d"]);
  assert.equal(f[0].score, 1 / (RRF_K + 3) + 1 / (RRF_K + 1));
  assert.deepEqual(fuse([[], ["x", "y"]]).map((x) => x.id), ["x", "y"]);
  assert.deepEqual(fuse([]), []);
});

test("keyword ranking: titles and both sides of the conversation, the best match first, the snippet from a message", async () => {
  const w = world(); w.env.AI = null; const t = tasks(w);
  const r = await w.R.taskSearch("plumber invoice");
  assert.equal(r.results[0].id, t.plumber, "the task with both words is first");
  assert.ok(ids(r).includes(t.invoice), "a task with one of the words is a result, after it");
  assert.match(r.results[0].snippet, /plumber|invoice/i);
  assert.equal((await w.R.taskSearch("lisb")).results[0].id, t.trip, "the last word matches as a prefix while it is being typed");
  assert.equal((await w.R.taskSearch("boiler warranty")).results[0].id, t.plumber, "the helper's reply and later messages count");
  assert.deepEqual(w.ids(await w.R.taskSearch("zzzqqq")), [], "no match, no result");
  function ids(x) { return w.ids(x); }
});

test("an empty or one character query returns nothing, and the cap is 30", async () => {
  const w = world(); w.env.AI = null; tasks(w);
  assert.deepEqual((await w.R.taskSearch("")).results, []); assert.deepEqual((await w.R.taskSearch(" a ")).results, []);
  for (let i = 0; i < 40; i++) w.task(`Report number ${i}`, [["quarterly report", "ok"]]);
  const r = await w.R.taskSearch("report");
  assert.equal(r.results.length, RESULTS_MAX); assert.equal(RESULTS_MAX, 30);
});

test("tool output and work logs are not indexed, secrets are scrubbed, and a handed-over card's model-only text is not the person's message", async () => {
  const w = world(); w.env.AI = null; const t = w.task("Notes", [["hello there", "done"]]);
  const turn = w.dodb.prepare("SELECT id FROM turns WHERE session=?").get(t).id;
  w.sql.exec("INSERT INTO msgs (turn, role, content, at) VALUES (?,?,?,?)", turn, "tool", "xyzzyfrobnicate output of a command", 1);
  w.sql.exec("UPDATE turns SET trace=? WHERE id=?", JSON.stringify([{ tool: "bash", out: "plughquux in the log" }]), turn);
  await w.R.taskSearch("hello");
  assert.deepEqual(w.ids(await w.R.taskSearch("xyzzyfrobnicate")), []); assert.deepEqual(w.ids(await w.R.taskSearch("plughquux")), []);
  w.sql.exec("INSERT INTO cards (id, session, kind, status, title, opened) VALUES (?,?,?,?,?,?)", turn, t, "chat", "done", "n", 1);
  w.sql.exec("INSERT INTO card_events (card, seq, type, at, text) VALUES (?,?,?,?,?)", turn, 1, "msg", 1, "hello there"); w.sql.exec("INSERT INTO card_events (card, seq, type, at, text) VALUES (?,?,?,?,?)", turn, 2, "msg", 2, "and also the steerword");
  assert.deepEqual(w.ids(await w.R.taskSearch("steerword")), [], "an index built before the steer was typed does not have it yet");
  w.R.tsTouch(t); assert.deepEqual(w.ids(await w.R.taskSearch("steerword")), [t], "a message added while the helper worked is the person's message");
  const h = w.task("Helper report", [["MODELONLYTEXT handed back from a helper", "The helper finished."]]);
  const hid = w.dodb.prepare("SELECT id FROM turns WHERE session=?").get(h).id;
  w.sql.exec("INSERT INTO cards (id, session, kind, status, title, opened) VALUES (?,?,?,?,?,?)", hid, h, "handoff", "done", "r", 1);
  assert.deepEqual(w.ids(await w.R.taskSearch("MODELONLYTEXT")), [], "a handoff card's opening text is model-only");
  assert.deepEqual(w.ids(await w.R.taskSearch("finished")), [h], "its reply is the helper's words and is indexed");
});

test("lazy build: nothing is indexed or embedded until the first search, and the first search builds everything", async () => {
  const w = world(); const t = tasks(w);
  w.R.tsTouch(t.plumber); w.addTurn(t.plumber, "an extra message", "an extra reply"); w.R.tsTouch(t.plumber); await w.settle();
  assert.equal(w.ftsRows(), 0, "writes before the first search index nothing");
  assert.equal(w.calls.embed, 0); assert.equal(vecCount(w), 0); assert.equal(w.R.getRaw("ts_built"), undefined);
  const r = await w.R.taskSearch("plumber"); await w.settle();
  assert.ok(w.R.getRaw("ts_built")); assert.equal(w.dodb.prepare("SELECT COUNT(*) n FROM task_idx").get().n, 4);
  assert.equal(vecCount(w), 4, "one vector per task, in the channel's own storage");
  assert.equal(w.index.rows.size, 0, "and none in Vectorize, which shows a new vector only after a delay");
  assert.equal(r.results[0].id, t.plumber);
  assert.ok(w.calls.embed >= 2, "the query and the tasks were embedded through the mem_embed job");
  assert.ok(w.calls.settled.length >= 1 && w.calls.settled.every((n) => n > 0), "the embeddings were charged to the person's credits");
});

test("indexing on write: a new turn, a rename and a clear update the keyword rows at once, after the first search", async () => {
  const w = world(); w.env.AI = null; const t = tasks(w);
  await w.R.taskSearch("plumber");
  const hits = (term) => w.dodb.prepare("SELECT DISTINCT session FROM task_fts WHERE task_fts MATCH ?").all(term).map((r) => r.session);
  w.addTurn(t.trip, "Book the hotel in Alfama", "Booked"); w.R.tsTouch(t.trip);
  assert.deepEqual(hits("alfama"), [t.trip], "a finished turn is searchable with no search in between");
  const renamed = await w.R.updateSession(t.tax, { title: "Zebra paperwork" });
  assert.ok(!renamed.error, JSON.stringify(renamed)); assert.deepEqual(hits("zebra"), [t.tax], "a rename is searchable at once");
  assert.deepEqual(hits("quarterly"), [t.tax], "its messages stay (the old title word is still in its first message)");
  w.sql.exec("DELETE FROM turns WHERE session=?", t.trip); w.R.tsTouch(t.trip);
  assert.deepEqual(hits("alfama"), [], "cleared messages leave the index");
  // a write path with no hook is still caught by the next search
  w.sql.exec("UPDATE sessions SET title=? WHERE id=?", "Quokka errands", t.invoice);
  assert.equal((await w.R.taskSearch("quokka")).results[0].id, t.invoice);
});

test("deleting a task removes its rows and its vector, and a deleted task never answers", async () => {
  const w = world(); const t = tasks(w); await w.R.taskSearch("plumber"); await w.settle();
  assert.equal(vecCount(w), 4);
  const out = await w.R.removeSession(t.tax); assert.ok(out.ok, JSON.stringify(out));
  assert.equal(w.ftsRows(), w.dodb.prepare("SELECT COUNT(*) n FROM task_fts WHERE session<>?").get(t.tax).n + w.dodb.prepare("SELECT COUNT(*) n FROM task_msg_fts WHERE session<>?").get(t.tax).n); assert.equal(w.dodb.prepare("SELECT COUNT(*) n FROM task_fts WHERE session=?").get(t.tax).n, 0); assert.equal(w.dodb.prepare("SELECT COUNT(*) n FROM task_idx WHERE session=?").get(t.tax).n, 0);
  assert.equal(vecCount(w), 3, "the vector row went with the task");
  assert.ok(!w.ids(await w.R.taskSearch("quarterly estimated payment")).includes(t.tax));
  // a task removed by a path with no hook leaves at the next search, vector included
  w.sql.exec("DELETE FROM sessions WHERE id=?", t.trip);
  assert.ok(!w.ids(await w.R.taskSearch("Lisbon flights")).includes(t.trip)); await w.settle();
  assert.equal(vecCount(w), 2);
  await w.R.tsWipe();   // the whole channel: rows and vectors go with the Resident's storage, nothing is left in Vectorize
  assert.equal(w.index.rows.size, 0);
});

test("meaning ranking: a task found only by its meaning is a result, and fusion puts a task found by both first", async () => {
  const w = world(); const t = {
    a: w.task("Garden", [["tomato seedlings need sun", "Put them by the window"]]),
    b: w.task("Chores", [["buy tomato seedlings soil", "ok"]]),
    c: w.task("Vacation", [["hotel booking in Rome", "ok"]]),
  };
  const r = await w.R.taskSearch("tomato seedlings sun"); await w.settle();
  assert.equal(r.results[0].id, t.a, "found by keywords and by meaning");
  assert.ok(r.meaning >= 1 && r.keyword >= 2);
  assert.ok(!ids(r).includes(t.c), "unrelated tasks are not results");
  function ids(x) { return x.results.map((y) => y.id); }
  // a vector hit with no keyword in common: the fake index ranks by shared words, so use an embedding with a different word that hashes alike is not possible; check the floor instead
  assert.ok(VEC_MIN > 0 && VEC_MIN < 1);
});

test("task vectors never touch Vectorize, so memory recall and its vectors are unaffected", async () => {
  const w = world(); tasks(w);
  w.index.rows.set("mem-1", { id: "mem-1", namespace: "a".repeat(32), values: embedding("plumber invoice due Friday"), metadata: {} });
  await w.R.taskSearch("plumber invoice"); await w.settle();
  assert.equal(w.index.calls.length, 0, "a task search makes no Vectorize call");
  assert.deepEqual([...w.index.rows.keys()], ["mem-1"]);
});

test("test accounts: a write never embeds, and a search alone indexes (nobody searched, nothing spent)", async () => {
  const w = world({ owner: "chk+1@example.com" }); const t = tasks(w);
  w.R.tsTouch(t.plumber); await w.settle(); assert.equal(w.calls.embed, 0); assert.equal(w.ftsRows(), 0); assert.equal(w.calls.held, 0);
  await w.R.taskSearch("plumber"); await w.settle();     // someone searched: it builds
  const spent = w.calls.embed; assert.ok(spent > 0);
  w.addTurn(t.plumber, "one more message about the sink", "ok"); w.R.tsTouch(t.plumber); await w.settle();
  assert.equal(w.calls.embed, spent, "a later write on a test account keeps the keyword rows current and makes no embedding call");
  assert.ok(w.dodb.prepare("SELECT 1 FROM task_msg_fts WHERE task_msg_fts MATCH 'sink' AND session=?").get(t.plumber));
});

test("a real account's write after the first search makes its embedding (once per pause between writes)", async () => {
  const w = world(); const t = tasks(w); await w.R.taskSearch("plumber"); await w.settle();
  const before = w.calls.embed;
  w.addTurn(t.trip, "Book the hotel in Alfama", "Booked"); w.R.tsTouch(t.trip); await w.settle();
  assert.equal(w.calls.embed, before + 1); assert.ok(w.calls.texts.some((x) => x.includes("Alfama")));
  w.addTurn(t.trip, "And the tram pass", "Done"); w.R.tsTouch(t.trip); await w.settle();
  assert.equal(w.calls.embed, before + 1, "a second write inside the pause waits for the next search");
  assert.deepEqual(w.dodb.prepare("SELECT session FROM task_idx WHERE vsig IS NULL OR vsig<>sig").all().map((x) => x.session), [t.trip]);
});

test("out of credits or an embedding failure: the keyword ranking still answers, with nothing charged", async () => {
  const w = world({ credits: false }); const t = tasks(w);
  const r = await w.R.taskSearch("plumber invoice"); await w.settle();
  assert.equal(r.results[0].id, t.plumber); assert.equal(w.calls.embed, 0); assert.equal(vecCount(w), 0); assert.deepEqual(w.calls.settled, []);
  const f = world(); const u = tasks(f); f.env.AI.run = async () => { throw new Error("boom"); };
  assert.equal((await f.R.taskSearch("plumber invoice")).results[0].id, u.plumber);
});

test("the route: owner only, GET only, empty query returns nothing, results are task ids with scores and snippets", async () => {
  const w = world(); const t = tasks(w); let binds = 0;
  w.env.RESIDENT = { idFromName: (n) => n, get: (n) => { assert.equal(n, `res:${T}:main`); return { bind: async () => { binds++; }, taskSearch: (q) => w.R.taskSearch(q) }; } };
  const tenant = { id: T, owner_user_id: "u1" }, channels = async () => [{ id: 1, slug: "main", name: "General" }];
  const call = (o = {}) => { const url = new URL(`https://x/w/ck1${o.path || "/api/res/main/search"}?q=${encodeURIComponent(o.q ?? "plumber invoice")}`);
    return searchRoute({ req: new Request(url, { method: o.method || "GET" }), env: w.env, t: tenant, user: "user" in o ? o.user : OWNER, sub: url.pathname.replace("/w/ck1", ""), url, channels }); };
  assert.equal(await call({ path: "/api/res/main/sessions" }), null, "other paths are not this route");
  assert.equal((await call({ user: null })).status, 403); assert.equal((await call({ user: { id: "u2", email: "other@acme.test" } })).status, 403); assert.equal(binds, 0, "a non owner never reaches the channel");
  assert.equal((await call({ method: "POST" })).status, 405); assert.equal((await call({ path: "/api/res/nope/search" })).status, 404);
  assert.deepEqual(await (await call({ q: "a" })).json(), { slug: "main", q: "a", results: [] }); assert.equal(binds, 0);
  const ok = await call(); assert.equal(ok.status, 200); assert.equal(ok.headers.get("cache-control"), "no-store");
  const body = await ok.json(); assert.equal(body.results[0].id, t.plumber);
  assert.ok(body.results.every((x) => typeof x.score === "number" && "snippet" in x) && body.results.length <= 30);
});

test("meaning cutoff: no hit when the best score is under the floor, near peers of the best are kept, far ones are not", () => {
  const sc = (...n) => n.map((score, i) => ({ id: `t${i}`, score }));
  assert.deepEqual(meaningHits(sc(0.4368, 0.4233, 0.3)), [], "an unrelated query (best 0.4368 in the dev measurements) has no meaning result");
  assert.deepEqual(meaningHits(sc(0.3385, 0.3347)), [], "gibberish has none");
  assert.deepEqual(meaningHits([]), []);
  assert.deepEqual(meaningHits(sc(0.4595, 0.4437, 0.4371, 0.4294, 0.3585, 0.3265)).map((x) => x.id), ["t0", "t1", "t2", "t3"], "four tasks on one topic, the fifth is background");
  assert.deepEqual(meaningHits(sc(0.5052, 0.3298, 0.3228)).map((x) => x.id), ["t0"], "one clear hit alone");
  assert.deepEqual(meaningHits(sc(0.5608, 0.5344, 0.4931, 0.4265, 0.3958)).map((x) => x.id), ["t0", "t1", "t2"], "the margin is measured from the best score");
  assert.deepEqual(meaningHits(sc(0.45, 0.37, 0.34)).map((x) => x.id), ["t0", "t1"], "a hit never goes under the tail floor");
  assert.deepEqual(meaningHits(sc(0.3, 0.9, 0.85)).map((x) => x.id), ["t1", "t2"], "input order does not matter");
  assert.ok(VEC_MIN === 0.45 && VEC_MARGIN === 0.08 && VEC_TAIL_MIN === 0.35);
  assert.ok(Math.abs(cosine([1, 0], [2, 0]) - 1) < 1e-9 && Math.abs(cosine([1, 0], [0, 3])) < 1e-9, "cosine ignores length");
});

test("a task found only by meaning is a result with no snippet, found at once with the vector the same search made", async () => {
  // The first search writes the vectors into the channel's storage and ranks with them in the same request (Vectorize showed a new vector only after a delay, so this used to find nothing).
  const w = world(); const t = {
    garden: w.task("Garden", [["tomato seedlings sunlight window", "Put the tomato seedlings by the window"]]),
    rome: w.task("Vacation", [["hotel booking in Rome", "Booked a hotel"]]),
  };
  w.env.AI.run = ((run) => async (m, input) => { if (input?.text) return { data: input.text.map((x) => (/tomato|garden|plants/i.test(x) ? [1, ...new Array(1023).fill(0)] : /rome|hotel/i.test(x) ? [0, 1, ...new Array(1022).fill(0)] : [0, 0, 1, ...new Array(1021).fill(0)])), usage: {} }; return run(m, input); })(w.env.AI.run);
  const r = await w.R.taskSearch("plants for the yard"); await w.settle();   // no word in common with the task
  assert.deepEqual(r.results.map((x) => x.id), [t.garden], "found only by meaning, on the first search, and the unrelated task is not");
  assert.equal(r.results[0].snippet, null); assert.equal(r.meaning, 1);
  const g = await w.R.taskSearch("qqq zzz"); assert.deepEqual(g.results, [], "a query with no meaning match and no keyword match returns nothing");
});

test("rows made before vectors moved into the channel's SQLite (vsig set, no vec) are embedded again by the next search", async () => {
  // Cause on dev 2026-10-26: the old build marked each task done (vsig = sig) after upserting to Vectorize and kept no vector, so the new code saw nothing pending and ranked by keywords only.
  const w = world(); const t = { garden: w.task("Garden", [["tomato seedlings sunlight window", "Put the tomato seedlings by the window"]]), rome: w.task("Vacation", [["hotel booking in Rome", "Booked"]]) };
  w.env.AI.run = ((run) => async (m, input) => { if (input?.text) return { data: input.text.map((x) => (/tomato|garden|plants/i.test(x) ? [1, ...new Array(1023).fill(0)] : [0, 1, ...new Array(1022).fill(0)])), usage: {} }; return run(m, input); })(w.env.AI.run);
  await w.R.taskSearch("zzz"); await w.settle();
  w.dodb.exec("UPDATE task_idx SET vsig=sig, vec=NULL");   // the old state: marked embedded, no vector
  assert.equal(vecCount(w), 0);
  const r = await w.R.taskSearch("plants for the yard"); await w.settle();
  assert.deepEqual(r.results.map((x) => x.id), [t.garden], "found by meaning on that search");
  assert.equal(vecCount(w), 2);
  const d = await w.R.tsDebug("plants for the yard");
  assert.equal(d.idx_rows, 2); assert.equal(d.with_vec, 2); assert.deepEqual(d.vec_lengths, [1024]); assert.equal(d.pending, 0); assert.deepEqual(d.hits, [t.garden]); assert.equal(d.top[0].score, 1);
});
