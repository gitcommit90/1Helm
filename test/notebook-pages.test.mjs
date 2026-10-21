// node --import ./test/stubs/register.mjs test/notebook-pages.test.mjs
// The Notebook as pages (src/notebook-pages.js and notebook-pages-do.js), on the REAL Worker routes and REAL Durable Object classes over node:sqlite, with the Mem0 memory
// fakes (D1 and Vectorize) and a recorded extraction model. A page is the facts of its categories, newest first.
//  1. Routes: the tree, the person and facts (General only), an empty page, a page with sources, the notes page, bad ids.
//  2. The edit round trip: the edit is a Notebook note saved in memory as note:<id> with a correction context, and it shows on the page at once.
//  3. Air gap, secrets, empty text, another account.
//  4. All pages in one read, with their state (ready or empty), and the person's photo.
import { sqlStatements } from "./sql-statements.mjs";
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync, readdirSync } from "node:fs"; import { createHash } from "node:crypto"; import { join } from "node:path";
const ROOT = new URL("..", import.meta.url).pathname;
const mod = await import("../src/index.js"), worker = mod.default, { Archive, Resident, ChannelComputer, Ledger, Computer } = mod;
const { PAGES, factsOf, pageOf } = await import("../src/notebook-pages.js");
const { memoriesList, memoryCounts } = await import("../src/mem0.js");
const { memEnv, fakeExtraction } = await import("./helpers/mem0-fakes.mjs");
const ok = (m) => console.log(`  ok ${m}`);
// The extraction model answers with one fact per saved note, picked by what the note says (the fake only records and answers, it grades nothing).
const FACTS = [[/oat milk/, "Sam likes oat milk in coffee", "preference"], [/niece/, "Maya is Sam's niece, not his daughter", "person"], [/birthday is in May/, "Jo's birthday is in May", "person"],
  [/gym/, "Sam goes to the gym in the mornings", "routine"], [/Osaka/, "The trip flies into Osaka", "decision"]];
const extraction = fakeExtraction((prompt) => FACTS.filter(([re]) => re.test(prompt.split("## New Messages").pop())).map(([, text, category]) => ({ text, category })));
const { env: mem } = memEnv(); delete mem.ENV_NAME;   // the dev banner needs HTMLRewriter
// ---- R2 ----
const r2 = new Map();
const WS = { put: async (k, b) => { r2.set(k, typeof b === "string" || b instanceof Uint8Array ? b : "bytes"); }, get: async (k) => { if (!r2.has(k)) return null; const v = r2.get(k); return v instanceof Uint8Array ? { size: v.length, body: new Blob([v]).stream(), httpEtag: '"e"', arrayBuffer: async () => v.buffer } : { size: 5, body: null, arrayBuffer: async () => new ArrayBuffer(5) }; },
   head: async (k) => r2.has(k) ? { size: r2.get(k)?.length ?? 5 } : null,
  delete: async (ks) => { for (const k of [].concat(ks)) r2.delete(k); },
  list: async ({ prefix = "", cursor, limit = 1000 }) => { const all = [...r2.keys()].filter((k) => k.startsWith(prefix)).sort(), s = Number(cursor || 0), page = all.slice(s, s + Math.min(limit, 2)); return { objects: page.map((key) => ({ key })), truncated: s + page.length < all.length, cursor: String(s + page.length) }; },
  resumeMultipartUpload: (key) => ({ abort: async () => { r2.delete(`${key}#parts`); } }) };
// ---- D1 ----
const d1 = new DatabaseSync(":memory:");
for (const f of readdirSync(join(ROOT, "db/migrations")).filter((x) => /\.sql$/.test(x)).sort().map((x) => `db/migrations/${x}`))
  for (const q of sqlStatements(readFileSync(join(ROOT, f), "utf8"))) { if (q) try { d1.exec(q); } catch {} }
const DB = { batch: async (list) => { const out = []; for (const s of list) out.push(await s.run()); return out }, prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return o; } };
// ---- Durable Objects over node:sqlite, with deleteAll() and abort() like the platform ----
const pending = [];
function sqlOf(db) { return { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = db.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } }; }
function dropAll(db) {
  for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE 'CREATE VIRTUAL%'").all()) db.exec(`DROP TABLE "${t.name}"`);
  for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) db.exec(`DROP TABLE IF EXISTS "${t.name}"`);
  try { db.exec("DELETE FROM sqlite_sequence"); } catch {}
}
function ns(Cls, patch = () => {}) {
  const dbs = {}, inst = {}, wiped = new Set();
  const make = (n) => { const db = dbs[n] ||= new DatabaseSync(":memory:"); let alarm = null;
    const ctx = { id: n, storage: { sql: sqlOf(db), getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; }, deleteAlarm: async () => { alarm = null; }, transactionSync: (f) => f(), get: async () => undefined, put: async () => {},
      deleteAll: async () => { dropAll(db); wiped.add(n); } }, waitUntil: (p) => pending.push(p), abort: () => { delete inst[n]; }, container: { running: false, destroy: async () => {} } };
    const o = new Cls(ctx, env); patch(o); return o; };
  return { idFromName: (x) => x, get: (n) => inst[n] ||= make(n), db: (n) => dbs[n], wiped };
}
const env = { ...mem, DB, WS, MEMORY: "on", GENUI: "off", WORKMEM: "off", TEST_MODE: "1", HS_FOUNDATIONS: "on", HS_WRITERS: "on", HS_ENVELOPE: "on",
  APP_HOST: "selfhost.example", GATEWAY_HOST: "selfhost.example", STRIPE_SECRET_KEY: "sk_test", COMPOSIO_KEY: "ck", VAULT_KEY: Buffer.alloc(32, 7).toString("base64"),
  };
env.RESIDENT = ns(Resident, (o) => { o.callModel = async () => { throw new Error("no model"); }; });
env.ARCHIVE = ns(Archive); env.LEDGER = ns(Ledger); env.COMPUTER = ns(Computer);
env.CHANNEL_COMPUTER = ns(ChannelComputer, (o) => Object.assign(o, { rmFile: async () => ({ ok: true }), save: async () => ({ ok: true }) }));
const settle = async () => { while (pending.length) await Promise.allSettled(pending.splice(0)); };
const sha = (s) => createHash("sha256").update(s).digest("hex");
const cols = d1.prepare("PRAGMA table_info(tenants)").all().map((c) => c.name);
for (const [n, slug] of [[1, "ck1"], [2, "ck2"]]) {
  d1.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run(`u${n}`, `chk+nb${n}@example.com`, Date.now());
  const t = { id: `t${n}`, slug, owner_user_id: `u${n}`, status: "active", onboarding_completed: 1, onboard_step: "done", slug_chosen: 1, host_ready: 0, helper_name: "Skipper", first_name: n === 1 ? "Sam" : "Rae", plan: "plus", created_at: Date.now(), updated_at: Date.now() };
  const k = Object.keys(t).filter((x) => cols.includes(x)); d1.prepare(`INSERT INTO tenants (${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(...k.map((x) => t[x]));
  d1.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)").run(sha(`c${n}c${n}`), `u${n}`, Date.now() + 864e5);
  await env.ARCHIVE.get(`archive:t${n}`).provisionFresh();
}
const { createChannel } = await import("../src/channels.js");
const trip = await createChannel(env, "t1", { name: "Japan trip", purpose: "Planning the trip", by: "person" });
const req = (path, { cookie = "c1c1", body, method } = {}) => worker.fetch(new Request(`https://selfhost.example${path}`, { method: method || (body === undefined ? "GET" : "POST"), headers: { cookie: `hc_session=${cookie}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil: (p) => pending.push(p) });
const get = async (path, o) => { const r = await req(path, o); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = async (path, body, o = {}) => { const r = await req(path, { ...o, body }); return { status: r.status, body: await r.json().catch(() => null) }; };
const R1 = () => env.RESIDENT.get("res:t1:main"), RT = () => env.RESIDENT.get(`res:t1:${trip.slug}`);
await R1().bind("t1", "main", "1"); await RT().bind("t1", trip.slug, String(trip.id));
const BANK = (slug) => R1().hsBankId.call({ env, get: (k) => ({ tenant: "t1", channel: slug })[k] }, slug);

// ======================= 1. routes =======================
const MAIN = "/w/ck1/api/notebook/main/pages", NB = "/w/ck1/api/notebook";
{
  // Before anything is saved: pages exist and are empty.
  let r = await get(MAIN); assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.tree.map((x) => [x.id, x.title, x.group, x.kind, x.updated_at]), [["about", "About Sam", "pages", "page", null], ["people", "People", "pages", "page", null], ["places", "Places", "pages", "page", null], ["routines", "Routines", "pages", "page", null], ["whats-going-on", "What's going on", "pages", "page", null], ["notes", "All notes", "more", "notes", null]]);
  assert.deepEqual([r.body.person.first, r.body.person.name, r.body.person.photo], ["Sam", "Sam", null]); assert.deepEqual(r.body.facts, []);
  r = await get(`${MAIN}/people`); assert.deepEqual(r.body, { id: "people", title: "People", markdown: "", updated_at: null, sources: [], state: "empty" }, "a page with no facts");
  assert.equal((await get(`${MAIN}/nope`)).status, 404); assert.equal((await get("/w/ck1/api/notebook/nochannel/pages")).status, 404);
  // The person's data: a Get to know you answer, a partner and a child in Contacts, the person's own card with a birthday.
  d1.prepare("INSERT INTO interviews (tenant_id,session_id,status,answers,known,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("t1", "s", "open", JSON.stringify({ home: { pick: "other", text: "Portland, Oregon" } }), JSON.stringify({ tz: "America/Los_Angeles" }), Date.now(), Date.now());
  const A = env.ARCHIVE.get("archive:t1"); await A.personUpsert({ name: "Sam Rivera", rel: "Me", bday: "March 9, 1988" }); await A.personUpsert({ name: "Jo Rivera", rel: "Your wife" }); await A.personUpsert({ name: "Maya", rel: "Your daughter" });
  r = await get(MAIN); assert.deepEqual(r.body.facts, [{ label: "Born", value: "March 9, 1988" }, { label: "Lives in", value: "Portland, Oregon" }, { label: "Partner", value: "Jo Rivera" }, { label: "Child", value: "Maya" }, { label: "Time zone", value: "Pacific Time" }]);
  assert.equal(r.body.person.name, "Sam Rivera");
  assert.deepEqual(factsOf({ interview: null, people: [] }), [], "no data, no facts");
  // A project channel: its own three pages, no facts.
  r = await get(`${NB}/${trip.slug}/pages`); assert.deepEqual(r.body.tree.map((x) => x.id), ["brief", "decisions", "open-items", "notes"]); assert.deepEqual(r.body.facts, []);
  assert.equal(r.body.tree[0].title, "Brief");
  assert.equal((await get(`${NB}/${trip.slug}/pages/people`)).status, 404, "General's pages are not a channel's");
  ok("routes: tree and person for General and a channel, facts from data 1HC has (General only), an empty page, bad ids");
}
{
  // A note the person wrote is saved in memory, and its fact shows on the page of its category with the fact as its source.
  const A = env.ARCHIVE.get("archive:t1"), ch = (await A.channels()).find((c) => c.slug === "main");
  const row = await A.noteAdd(ch.id, "about", "Sam likes oat milk in coffee."); await R1().hsNoteSync(row.id); await settle();
  const fact = (await memoriesList(env, BANK("main"), { doc: `note:${row.id}` })).items[0];
  const r = await get(`${MAIN}/about`); assert.equal(r.status, 200); assert.equal(r.body.markdown, "## Preference\n- Sam likes oat milk in coffee"); assert.equal(r.body.state, "ready"); assert.ok(r.body.updated_at > 1e12);
  assert.deepEqual(r.body.sources.map((s) => [s.kind, s.id, s.title]), [["memory", fact.id, "Sam likes oat milk in coffee"]]);
  assert.equal((await get(`${MAIN}/people`)).body.state, "empty", "a fact of another category is not on this page");
  const tr = await get(MAIN); assert.equal(tr.body.tree.find((x) => x.id === "about").updated_at, r.body.updated_at); assert.equal(tr.body.tree.find((x) => x.id === "people").updated_at, null);
  const nt = await get(`${MAIN}/notes`); assert.deepEqual([nt.body.id, nt.body.title, nt.body.markdown], ["notes", "All notes", ""]);
  // pageOf alone: only the page's categories, newest first, long text cut in the source title.
  const f = (id, type, text, at) => ({ id, type, text, mentioned_at: new Date(at).toISOString() }), page = PAGES.channel[0];
  const out = pageOf(page, [f("a", "other", "old", 1000), f("b", "decision", "not here", 3000), f("c", "preference", `new ${"x ".repeat(80)}`, 2000)]);
  assert.deepEqual(out.sources.map((s) => s.id), ["c", "a"]); assert.equal(out.updated_at, 2000); assert.ok(out.sources[0].title.length <= 90, "long text is cut");
  ok("a page lists the facts of its categories newest first, with the facts as sources, and a page with none is empty");
}

// ======================= 2. the edit round trip =======================
let noteId;
{
  const bank = BANK("main"), A = env.ARCHIVE.get("archive:t1"), docOf = async (id) => (await memoriesList(env, bank, { doc: `note:${id}` })).items;
  const text = "Maya is my niece, not my daughter.";
  const r = await post(`${MAIN}/people/edit`, { section: "Maya", text }); await settle(); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.ok, true); noteId = r.body.note_id;
  // 1. saved as the person's Notebook note, in the People section, exactly as typed
  const ch = (await A.channels()).find((c) => c.slug === "main"), note = await A.noteRow(String(ch.id), noteId);
  assert.deepEqual([note.content, note.sec, note.author_type, note.page.id, note.page.section], [text, "people", "human", "people", "Maya"]);
  assert.ok((await get(NB + "/main")).body.notes.some((n) => n.id === noteId && n.text === text), "it shows in All notes");
  // 2. saved in memory as note:<id>: the model was given the text and a context that says it is the person's correction to that page
  const sent = extraction.calls.map((c) => JSON.stringify(c.messages)).find((m) => m.includes("my niece"));
  assert.ok(sent, "the note went to the extraction model"); assert.match(sent, /correction Sam made to the \\"People\\" page of their 1Helm Notebook, in the section \\"Maya\\"/);
  const [fact] = await docOf(noteId); assert.ok(fact, "a fact of the note is in memory"); assert.deepEqual([fact.metadata.page, fact.metadata.page_section, fact.metadata.source], ["people", "Maya", "note"]);
  // 3. the page shows it at once, and a later note is listed too, newest first
  let pg = await get(`${MAIN}/people`); assert.equal(pg.body.markdown, "## Person\n- Maya is Sam's niece, not his daughter"); assert.deepEqual(pg.body.sources.map((x) => x.id), [fact.id]);
  const row2 = await A.noteAdd(ch.id, "people", "Jo's birthday is in May."); await R1().hsNoteSync(row2.id); await settle();
  pg = await get(`${MAIN}/people`); assert.deepEqual(pg.body.markdown.split("\n"), ["## Person", "- Jo's birthday is in May", "- Maya is Sam's niece, not his daughter"], "the edit stays on the page after later notes");
  // A whole page edit (section null) is filed the same way.
  const w = await post(`${MAIN}/routines/edit`, { section: null, text: "Mornings are for the gym." }); await settle(); assert.equal(w.status, 200);
  assert.match(extraction.calls.map((c) => JSON.stringify(c.messages)).find((m) => m.includes("Mornings are for the gym")), /\\"Routines\\" page of their 1Helm Notebook\. It is Sam's own statement/); assert.equal((await A.noteRow(String(ch.id), w.body.note_id)).sec, "how");
  assert.match((await get(`${MAIN}/routines`)).body.markdown, /gym/);
  // The text is stored whole: no cap
  const long = "x".repeat(5000), l = await post(`${MAIN}/about/edit`, { text: long }); await settle(); assert.equal((await A.noteRow(String(ch.id), l.body.note_id)).content.length, 5000);
  ok("edit round trip: saved as a note exactly as typed, saved in memory as note:<id> with the correction context, shown on the page, stays after later notes, whole page and long text");
}

// ======================= 3. air gap, refusals, other accounts =======================
{
  const A = env.ARCHIVE.get("archive:t1"), tb = BANK(trip.slug), docs = async (bank, id) => (await memoriesList(env, bank, { doc: `note:${id}` })).items;
  const r = await post(`${NB}/${trip.slug}/pages/decisions/edit`, { section: null, text: "We decided to fly into Osaka." }); await settle(); assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await docs(tb, r.body.note_id)).length, 1, "the channel's own memory has it"); assert.equal((await docs(BANK("main"), r.body.note_id)).length, 0, "General's memory does not");
  assert.equal((await docs(tb, noteId)).length, 0, "and the channel's memory has nothing of General's edit");
  assert.ok(!(await get(`${NB}/main`)).body.notes.some((n) => n.text.includes("Osaka")), "the Notebook notes stay per channel");
  const pg = await get(`${NB}/${trip.slug}/pages/decisions`); assert.ok(pg.body.markdown.includes("Osaka") && !pg.body.markdown.includes("niece"), "a channel page is built from its own memory only");
  // Refusals
  assert.equal((await post(`${MAIN}/people/edit`, { text: "  " })).status, 400);
  const sec = await post(`${MAIN}/people/edit`, { text: "my password is hunter2 and the key is sk-live-abcdefghijklmnopqrstuvwx1234567890" }); assert.equal(sec.status, 400); assert.equal(sec.body.secret, true);
  assert.equal((await post(`${MAIN}/notes/edit`, { text: "x" })).status, 400); assert.equal((await post(`${MAIN}/nope/edit`, { text: "x" })).status, 404);
  assert.equal((await req(`${MAIN}/people/edit`)).status, 404, "an edit is a POST");
  // Another account: its own cookie reads its own General, never this one's
  const other = await get("/w/ck1/api/notebook/main/pages", { cookie: "c2c2" }); assert.ok(other.status !== 200 || other.body?.tree?.[0]?.title !== "About Sam", "another account never gets this account's pages");
  const own = await get("/w/ck2/api/notebook/main/pages", { cookie: "c2c2" }); assert.equal(own.status, 200); assert.equal(own.body.tree[0].title, "About Rae"); assert.equal(own.body.tree[0].updated_at, null, "and sees none of the other account's pages");
  ok("air gap (each channel's own memory, own pages, own notes), empty text, secrets, notes page, GET only for reads, another account refused");
}

// ======================= 4. GET .../pages returns every page, with its state =======================
{
  const ids = PAGES.general.map((p) => p.id);
  let r = await get(MAIN); assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body.pages).sort(), [...ids].sort(), "one entry per page in the tree (not the notes page)");
  for (const id of ids) { const one = (await get(`${MAIN}/${id}`)).body, pg = r.body.pages[id]; assert.deepEqual(Object.keys(pg).sort(), ["markdown", "sources", "state", "updated_at"]); assert.equal(pg.markdown, one.markdown); assert.equal(pg.updated_at, one.updated_at); assert.deepEqual(pg.sources, one.sources); }
  assert.deepEqual(Object.fromEntries(ids.map((id) => [id, r.body.pages[id].state])), { about: "ready", people: "ready", places: "empty", routines: "ready", "whats-going-on": "empty" });
  assert.deepEqual(r.body.tree.filter((x) => x.kind === "page").map((x) => x.id), ids); assert.ok(r.body.person && r.body.facts);
  r = await get("/w/ck2/api/notebook/main/pages", { cookie: "c2c2" }); assert.equal(r.status, 200);
  assert.ok(Object.values(r.body.pages).every((p) => p.state === "empty" && p.markdown === "" && p.updated_at === null && p.sources.length === 0), "an account with no memory has only empty pages");
  r = await get(`${NB}/${trip.slug}/pages`); assert.deepEqual(Object.keys(r.body.pages).sort(), ["brief", "decisions", "open-items"]);
  assert.ok(r.body.pages.decisions.markdown.includes("Osaka") && !JSON.stringify(r.body.pages).includes("niece") && !JSON.stringify(r.body.pages).includes("oat milk"), "a channel's pages come from its own memory only");
  ok("all pages in one read: state ready or empty, the same text as the one-page route, a channel's pages stay in its own memory");
}

// ======================= 5. the person's photo =======================
{
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 40 }, (_, i) => i + 1)]), png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 30 }, (_, i) => 200 - i)]);
  const P = "/w/ck1/api/notebook/main/photo", raw = (path, bytes, { cookie = "c1c1", method = "POST" } = {}) => worker.fetch(new Request(`https://selfhost.example${path}`, { method, headers: { cookie: `hc_session=${cookie}`, "content-type": "image/jpeg", "content-length": String(bytes?.length ?? 0) }, body: bytes }), env, { waitUntil: (p) => pending.push(p), passThroughOnException() {} });
  const files = async () => (await R1().listFiles()).filter((f) => /^Profile photo\./.test(f.name)), keys = () => [...r2.keys()].filter((k) => k.startsWith("t/t1/files/main/")).length;
  const same = async (path, want, o) => { const r = await worker.fetch(new Request(`https://selfhost.example${path}`, { headers: { cookie: `hc_session=${o?.cookie || "c1c1"}` } }), env, { waitUntil: () => {}, passThroughOnException() {} }); return r.status === 200 && Buffer.compare(Buffer.from(await r.arrayBuffer()), Buffer.from(want)) === 0 ? r : null; };
  assert.equal((await get(P)).status, 404, "no photo yet"); assert.equal((await get(MAIN)).body.person.photo, null);
  // upload: stored as given, shown in person.photo
  let r = await raw(P, jpg); const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.ok, true); assert.match(j.photo, /^\/w\/ck1\/api\/notebook\/main\/photo\?v=\d+$/);
  const url1 = (await get(MAIN)).body.person.photo; assert.equal(url1, j.photo, "person.photo is the authenticated URL");
  const g = await same(P, jpg); assert.ok(g, "the original bytes come back unchanged"); assert.equal(g.headers.get("content-type"), "image/jpeg");
  assert.equal((await files()).length, 1, "kept as the person's own file"); assert.equal((await files())[0].bytes, jpg.length); assert.equal(keys(), 1);
  { const o = await req(P, { cookie: "c2c2" }); assert.ok(!/^image\//.test(o.headers.get("content-type") || "") && (await o.arrayBuffer()).byteLength !== jpg.length, "another account's cookie never gets the photo"); }
  assert.equal((await get("/w/ck2/api/notebook/main/photo", { cookie: "c2c2" })).status, 404, "and has no photo of its own");
  // the same bytes again: nothing new
  r = await raw(P, jpg); assert.equal((await r.json()).same, true); assert.equal((await files()).length, 1); assert.equal(keys(), 1, "no duplicate in storage");
  // replace: the old original is gone, one file remains
  r = await raw(P, png); assert.equal(r.status, 200); const url2 = (await get(MAIN)).body.person.photo; assert.notEqual(url2, url1); assert.ok(await same(P, png), "now the new bytes"); assert.equal((await files()).length, 1); assert.equal(keys(), 1, "replacing keeps no duplicate");
  assert.equal((await files())[0].mime, "image/png");
  // account wide: a project channel reads the same photo and shows it on its own pages response
  assert.ok(await same(`/w/ck1/api/notebook/${trip.slug}/photo`, png)); assert.match((await get(`${NB}/${trip.slug}/pages`)).body.person.photo, new RegExp(`/api/notebook/${trip.slug}/photo\\?v=\\d+$`));
  // refusals: not an image, too big, no length
  r = await raw(P, new TextEncoder().encode("hello, not an image")); assert.equal(r.status, 400);
  r = await raw(P, new Uint8Array(26 * 1024 * 1024).fill(1)); assert.equal(r.status, 413); assert.ok(await same(P, png), "a refused upload changes nothing");
  assert.equal((await raw(P, jpg, { method: "PUT" })).status, 405);
  // delete
  r = await raw(`${P}/delete`, new Uint8Array(0)); assert.equal((await r.json()).removed, true); assert.equal((await get(P)).status, 404); assert.equal((await get(MAIN)).body.person.photo, null); assert.equal((await files()).length, 0); assert.equal(keys(), 0, "the original is deleted from storage");
  r = await raw(P, jpg); assert.equal(r.status, 200); assert.ok(await same(P, jpg)); assert.equal((await files()).length, 1);
  ok("photo: uploaded as given and shown in person.photo, same bytes change nothing, replace keeps one file, account wide, non-images and oversize refused, delete removes the original");
}
console.log("notebook pages: all checks passed");
