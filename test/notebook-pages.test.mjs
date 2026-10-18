// node --import ./test/stubs/register.mjs test/notebook-pages.test.mjs
// The Notebook as pages (Memory Overhaul phase 6, src/notebook-pages.js and notebook-pages-do.js), on the REAL Worker routes and REAL Durable
// Object classes over node:sqlite, with a fake Hindsight that keeps mental models, retained documents, operations and consolidation state.
//  1. Template: the page to model map, no duplicated model, triggers (a cron twice a day), version after p9-1,
//     and what a bank import does with the new template (only the new models are created and refreshed).
//  2. Routes: the tree, the person and facts (General only), a page not built yet, a built page with sources, the notes page, bad ids.
//  3. The edit round trip: the edit is a Notebook note retained as note:<id> with a correction context, the page refresh waits for the retain and
//     the consolidation, then runs, the page shows the edit, and the edit is still there after later refreshes.
//  4. Air gap, secrets, empty text, another account.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync, readdirSync } from "node:fs"; import { createHash } from "node:crypto"; import { join } from "node:path";
const ROOT = new URL("..", import.meta.url).pathname;
const mod = await import("../src/index.js"), worker = mod.default, { Archive, Resident, ChannelComputer, Ledger, Computer } = mod;
const { PAGES, pagesFor, factsOf, sourcesOf } = await import("../src/notebook-pages.js");
const { TEMPLATE_VERSION, fillTemplate, templateModelCount } = await import("../src/hindsight-template.js");
const ok = (m) => console.log(`  ok ${m}`);
globalThis.fetch = async (u, init = {}) => { throw new Error(`unexpected network call ${init.method || "GET"} ${u}`); };
// ---- fake Hindsight: per bank, config, mental models, documents, operations, consolidation ----
const HS = new Map(), LOG = [];
const bankOf = (id) => { if (!HS.has(id)) HS.set(id, { models: new Map(), docs: new Map(), pendingConsolidation: 0, ops: [], seq: 0 }); return HS.get(id); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function refresh(b, id, bankName) {
  const m = b.models.get(id); if (!m) return;
  const facts = [...b.docs.entries()].map(([d, x]) => ({ d, ...x })), fixes = facts.filter((f) => /correction/i.test(f.context || "")), rest = facts.filter((f) => !/correction/i.test(f.context || ""));
  m.content = `## Summary\n${rest.map((f) => `- ${f.content.slice(0, 80)}`).join("\n") || "Nothing yet."}${fixes.length ? `\n\n## Corrections\n${fixes.map((f) => f.content).join("\n")}` : ""}`;
  m.last_refreshed_at = new Date().toISOString(); m.refreshes = (m.refreshes || 0) + 1;
  // Hindsight 1.0.0 stores based_on keyed by fact type, each fact with only id, text, type and context (memory_engine.py, reflect_response_payload)
  m.based_on = { world: facts.map((f) => ({ id: `mem-${f.d}`, text: f.content, type: "world", context: f.context || null })), observation: facts.length ? [{ id: "obs-1", text: `Observation: ${facts[0].content}`, type: "observation", context: null }] : [], "mental-models": [], directives: [{ id: "dir-1", text: "Honor the person's corrections", type: "directives", context: null }] };
  LOG.push(`refresh ${bankName} ${id}`);
}
const HINDSIGHT = { fetch: async (u, init = {}) => {
  const url = new URL(u), m = init.method || "GET", p = decodeURIComponent(url.pathname), J = (b, s = 200) => new Response(JSON.stringify(b), { status: s }), body = init.body ? JSON.parse(init.body) : null;
  let x; if (!(x = p.match(/^\/v1\/default\/banks\/([^/]+)(\/.*)?$/))) return J({ detail: `fake: ${p}` }, 404);
  const name = x[1], rest = x[2] || "", has = HS.has(name), b = bankOf(name);
  if (rest === "" && m === "PUT") return J({});
  if (rest === "/import") { LOG.push(`import ${name}`); const created = [], updated = [];
    for (const mm of body.mental_models || []) { const cur = b.models.get(mm.id); const def = { id: mm.id, name: mm.name, source_query: mm.source_query, max_tokens: mm.max_tokens, trigger: mm.trigger, content: "", last_refreshed_at: null };
      if (cur && same([cur.name, cur.source_query, cur.max_tokens, cur.trigger], [def.name, def.source_query, def.max_tokens, def.trigger])) continue;
      if (cur) { Object.assign(cur, def, { content: cur.content, last_refreshed_at: cur.last_refreshed_at }); updated.push(mm.id); } else { b.models.set(mm.id, def); created.push(mm.id); }
      b.ops.push({ kind: "refresh_mental_model", model: mm.id }); }
    return J({ mental_models_created: created, mental_models_updated: updated, operation_ids: [...created, ...updated].map((i) => `op-${i}`) }); }
  if (rest === "/memories" && m === "POST") { for (const it of body.items) b.docs.set(it.document_id, { content: it.content, context: it.context || "", tags: it.tags || [], metadata: it.metadata || {} }); b.pendingConsolidation++; b.ops.push({ kind: "retain", pending: true }); return J({ operation_id: body.operation_id }); }
  if (rest === "/mental-models" && m === "GET") return J({ items: [...b.models.values()].map(({ id, name, last_refreshed_at, trigger }) => ({ id, name, last_refreshed_at, last_refresh_failed_at: null, is_stale: false, ...(url.searchParams.get("detail") ? { trigger } : {}) })) });
  // PATCH changes the trigger only (no refresh operation), merging what is sent over the stored trigger; unset defaults (false, null) are dropped like Hindsight's defaults
  if ((x = rest.match(/^\/mental-models\/([^/]+)$/)) && m === "PATCH") { const cur = b.models.get(x[1]); if (!cur) return J({ detail: "no model" }, 404); LOG.push(`patch ${name} ${x[1]}`); cur.trigger = Object.fromEntries(Object.entries({ ...cur.trigger, ...body.trigger }).filter(([, v]) => v !== false && v !== null)); return J({ id: cur.id }); }
  if ((x = rest.match(/^\/mental-models\/([^/]+)$/)) && m === "GET") { const mm = b.models.get(x[1]); if (!mm) return J({ detail: "no model" }, 404); return J({ ...mm, reflect_response: mm.based_on ? { text: mm.content, based_on: mm.based_on, mental_models: [] } : null }); }
  if ((x = rest.match(/^\/mental-models\/([^/]+)\/refresh$/)) && m === "POST") { if (!b.models.has(x[1])) return J({ detail: "no model" }, 404); refresh(b, x[1], name); return J({ operation_id: "r" }); }
  if (rest.startsWith("/operations") && m === "GET") return J({ operations: b.ops.filter((o) => o.pending && url.searchParams.get("status") === "pending").map((o, i) => ({ id: `o${i}`, task_type: o.kind, status: "pending" })) });
  if (rest.startsWith("/stats")) return J({ pending_consolidation: b.pendingConsolidation, failed_consolidation: 0, total_nodes: 10, total_documents: b.docs.size });
  if (rest.startsWith("/config")) return J({ config: {}, overrides: {} });
  return J({ detail: `fake hindsight: ${m} ${rest}` }, 404);
} };
// Hindsight finishes the retains and the consolidation of a bank, and runs the queued first refreshes of the models the import created.
const settleHs = (name) => { const b = bankOf(name); b.pendingConsolidation = 0; for (const o of b.ops) o.pending = false; for (const o of b.ops.splice(0).filter((o) => o.kind === "refresh_mental_model")) refresh(b, o.model, name); };


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
  for (const st of readFileSync(join(ROOT, f), "utf8").split(/;\s*\n/)) { const q = st.replace(/^\s*--.*$/gm, "").trim(); if (q) try { d1.exec(q); } catch {} }
const DB = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return o; } };
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
const env = { DB, WS, HINDSIGHT, HINDSIGHT_API_KEY: "k", MEMORY_BACKEND: "hindsight", MEMORY: "on", GENUI: "off", WORKMEM: "off", TEST_MODE: "1", HS_FOUNDATIONS: "on", HS_WRITERS: "on", HS_ENVELOPE: "on",
  APP_HOST: "selfhost.example", GATEWAY_HOST: "selfhost.example", STRIPE_SECRET_KEY: "sk_test", COMPOSIO_KEY: "ck", VAULT_KEY: Buffer.alloc(32, 7).toString("base64"),
  AI: { run: async () => ({ data: [] }) } };
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

// ======================= 1. the template =======================
{
  assert.ok(Number(TEMPLATE_VERSION.slice(1).split("-")[0]) > 9, `template version ${TEMPLATE_VERSION} comes after p9-1`);
  for (const kind of ["general", "channel"]) {
    const t = fillTemplate(kind, { first: "Sam", helper: "Skipper", channel: "trip", purpose: "x" }), ids = t.mental_models.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length, "no model twice");
    for (const p of PAGES[kind]) assert.ok(ids.includes(p.model), `${kind} page ${p.id} maps to model ${p.model}, which the template holds`);
    for (const m of t.mental_models) { assert.equal(m.trigger.refresh_cron, "0 10,22 * * *", `${m.id} refreshes twice a day`); assert.ok(!("refresh_after_consolidation" in m.trigger) && !("min_refresh_interval_seconds" in m.trigger), `${m.id}: no refresh after consolidation, no minimum interval`); }
    assert.ok(!("mental_model_min_refresh_interval_seconds" in t.bank), `${kind}: no bank minimum refresh interval`);
    assert.ok(t.directives.some((d) => /correction/i.test(d.content)), "a directive makes the person's corrections win");
    assert.equal(templateModelCount(kind), ids.length);
  }
  assert.deepEqual(PAGES.general.map((p) => [p.id, p.model]), [["about", "profile"], ["people", "people"], ["places", "places"], ["routines", "routines"], ["whats-going-on", "active-tasks"]]);
  assert.deepEqual(PAGES.channel.map((p) => [p.id, p.model]), [["brief", "brief"], ["decisions", "decisions"], ["open-items", "active-tasks"]]);
  assert.equal(templateModelCount("general"), 5); assert.equal(templateModelCount("channel"), 3);
  ok("template: page to model map (General reuses 3 models and adds 2, a channel reuses 2 and adds 1), triggers, directive, version");
}

// ======================= 2. routes =======================
const MAIN = "/w/ck1/api/notebook/main/pages", NB = "/w/ck1/api/notebook";
{
  // Before the bank has its template: pages exist, empty, never built.
  let r = await get(MAIN); assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.tree.map((x) => [x.id, x.title, x.group, x.kind, x.updated_at]), [["about", "About Sam", "pages", "page", null], ["people", "People", "pages", "page", null], ["places", "Places", "pages", "page", null], ["routines", "Routines", "pages", "page", null], ["whats-going-on", "What's going on", "pages", "page", null], ["notes", "All notes", "more", "notes", null]]);
  assert.deepEqual([r.body.person.first, r.body.person.name, r.body.person.photo], ["Sam", "Sam", null]); assert.deepEqual(r.body.facts, []);
  r = await get(`${MAIN}/people`); assert.deepEqual(r.body, { id: "people", title: "People", markdown: "", updated_at: null, sources: [] }, "a page not built yet");
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
  ok("routes: tree and person for General and a channel, facts from data 1HC has (General only), a page not built, bad ids");
}
{
  // The bank gets its template (a retain makes the Resident import it), Hindsight builds the pages, and the route returns them.
  const A = env.ARCHIVE.get("archive:t1"), ch = (await A.channels()).find((c) => c.slug === "main");
  const row = await A.noteAdd(ch.id, "about", "Sam likes oat milk in coffee."); await R1().hsNoteSync(row.id); await settleHs(BANK("main"));
  const imp = LOG.filter((l) => l.startsWith("import")).length; assert.ok(imp >= 1);
  const b = bankOf(BANK("main")); assert.deepEqual([...b.models.keys()].sort(), ["active-tasks", "people", "places", "profile", "routines"]);
  const r = await get(`${MAIN}/about`); assert.equal(r.status, 200); assert.match(r.body.markdown, /^## Summary/); assert.ok(Number.isFinite(r.body.updated_at) && r.body.updated_at > 1e12);
  assert.deepEqual(r.body.sources.map((s) => s.kind), ["observation", "memory"], "sources read the 1.0.0 shape: observations first, then facts, no directives"); assert.match(r.body.sources[0].title, /^Observation: Sam likes oat milk/); assert.match(r.body.sources[1].title, /oat milk/);
  assert.deepEqual(r.body.sources.map((s) => s.id), ["obs-1", `mem-note:${row.id}`]);
  const tr = await get(MAIN); assert.ok(tr.body.tree.filter((x) => x.group === "pages").every((x) => x.updated_at > 1e12), "every page has refreshed once"); assert.ok(tr.body.tree.find((x) => x.id === "notes").updated_at > 1e12);
  const nt = await get(`${MAIN}/notes`); assert.deepEqual([nt.body.id, nt.body.title, nt.body.markdown], ["notes", "All notes", ""]);
  // A re-import of the same template changes nothing and starts no refresh (Hindsight 1.0.0 skips unchanged models).
  const before = LOG.length; await R1().hsBank(); assert.equal(LOG.length, before, "an unchanged template costs nothing");
  // A response shaped as Hindsight 1.0.0 stores it: keyed by fact type, one fact twice, directives and mental models ignored, the old flat shape gives nothing.
  assert.deepEqual(sourcesOf({ reflect_response: { based_on: { world: [{ id: "m2", text: "y", type: "world", context: "c" }, { id: "m2", text: "y", type: "world", context: "c" }], experience: [{ id: "e1", text: "z", type: "experience", context: null }], observation: [{ id: "o1", text: "x ".repeat(80), type: "observation", context: null }], "mental-models": [{ id: "mm1", text: "t", type: "mental-models" }], directives: [{ id: "d1", text: "u", type: "directives" }] } } }).map((s) => [s.kind, s.id]), [["observation", "o1"], ["memory", "m2"], ["memory", "e1"]]);
  assert.ok(sourcesOf({ reflect_response: { based_on: { observation: [{ id: "o1", text: "x ".repeat(80), type: "observation" }] } } })[0].title.length <= 90, "long text is cut");
  assert.deepEqual(sourcesOf({ reflect_response: { based_on: { memories: [{ id: "m", text: "t" }] } } }), [], "the flat shape is not what 1.0.0 stores");
  assert.deepEqual(sourcesOf({ reflect_response: null }), []); assert.deepEqual(sourcesOf(null), []);
  ok("pages built by Hindsight: markdown as returned, updated_at, sources from the 1.0.0 based_on shape (by fact type), an unchanged template re-import is free");
}

// ======================= 3. the edit round trip =======================
let noteId;
{
  const bank = BANK("main"), b = bankOf(bank), A = env.ARCHIVE.get("archive:t1");
  const refreshesBefore = b.models.get("people").refreshes, text = "Maya is my niece, not my daughter.";
  const r = await post(`${MAIN}/people/edit`, { section: "Maya", text }); await settle(); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.ok, true); noteId = r.body.note_id;
  // 1. saved as the person's Notebook note, in the People section, exactly as typed
  const ch = (await A.channels()).find((c) => c.slug === "main"), note = await A.noteRow(String(ch.id), noteId);
  assert.deepEqual([note.content, note.sec, note.author_type, note.page.id, note.page.section], [text, "people", "human", "people", "Maya"]);
  assert.ok((await get(NB + "/main")).body.notes.some((n) => n.id === noteId && n.text === text), "it shows in All notes");
  // 2. retained as note:<id> with a context that says it is the person's correction to that page
  const d = b.docs.get(`note:${noteId}`); assert.equal(d.content, text); assert.match(d.context, /correction Sam made to the "People" page of their 1Helm Notebook, in the section "Maya"/); assert.deepEqual([d.metadata.page, d.metadata.page_section], ["people", "Maya"]);
  assert.deepEqual(d.tags, ["source:note"]);
  // 3. the refresh waits for Hindsight to finish the retain and the consolidation
  assert.ok(R1().hsPageNext() != null, "a refresh is waiting"); R1().put("hs_pr", JSON.stringify({ ...JSON.parse(R1().get("hs_pr")), due: 0 }));
  assert.equal((await R1().hsPageAlarm()).waiting, true, "consolidation not done: not yet"); assert.equal(b.models.get("people").refreshes, refreshesBefore);
  settleHs(bank); R1().put("hs_pr", JSON.stringify({ ...JSON.parse(R1().get("hs_pr")), due: 0 }));
  const done = await R1().hsPageAlarm(); assert.equal(done.refreshed, 1); assert.equal(b.models.get("people").refreshes, refreshesBefore + 1, "one refresh of that page, no other");
  assert.equal(R1().hsPageNext(), null, "the job is done");
  // 4. the page shows the edit; later refreshes (Hindsight's own, after more notes) still show it
  let pg = await get(`${MAIN}/people`); assert.ok(pg.body.markdown.includes(text), pg.body.markdown); assert.ok(pg.body.sources.some((s) => s.id === `mem-note:${noteId}` && s.title.includes(text)));
  const row2 = await A.noteAdd(ch.id, "people", "Jo's birthday is in May."); await R1().hsNoteSync(row2.id); settleHs(bank); refresh(b, "people", bank); refresh(b, "people", bank);
  pg = await get(`${MAIN}/people`); assert.ok(pg.body.markdown.includes(text) && pg.body.markdown.includes("birthday"), "the edit survives every later refresh");
  // A whole page edit (section null) is filed the same way.
  const w = await post(`${MAIN}/routines/edit`, { section: null, text: "Mornings are for the gym." }); await settle(); assert.equal(w.status, 200);
  assert.match(b.docs.get(`note:${w.body.note_id}`).context, /"Routines" page of their 1Helm Notebook\. It is Sam's own statement/); assert.equal((await A.noteRow(String(ch.id), w.body.note_id)).sec, "how");
  // The text is stored whole: no cap
  const long = "x".repeat(5000), l = await post(`${MAIN}/about/edit`, { text: long }); await settle(); assert.equal((await A.noteRow(String(ch.id), l.body.note_id)).content.length, 5000); assert.equal(b.docs.get(`note:${l.body.note_id}`).content.length, 5000);
  ok("edit round trip: saved as a note exactly as typed, retained as note:<id> with the correction context, one refresh after retain and consolidation, shown on the page, survives later refreshes, whole page and long text");
}

// ======================= 4. air gap, refusals, other accounts =======================
{
  const A = env.ARCHIVE.get("archive:t1"), main = bankOf(BANK("main")), tb = BANK(trip.slug);
  const r = await post(`${NB}/${trip.slug}/pages/decisions/edit`, { section: null, text: "We decided to fly into Osaka." }); await settle(); assert.equal(r.status, 200, JSON.stringify(r.body));
  const tbank = bankOf(tb); assert.ok(tbank.docs.has(`note:${r.body.note_id}`), "the channel's own bank has it"); assert.ok(!main.docs.has(`note:${r.body.note_id}`), "General's bank does not");
  assert.ok(![...tbank.docs.keys()].some((k) => k === `note:${noteId}`), "and the channel's bank has nothing of General's edit");
  assert.ok(!(await get(`${NB}/main`)).body.notes.some((n) => n.text.includes("Osaka")), "the Notebook notes stay per channel");
  settleHs(tb); const pg = await get(`${NB}/${trip.slug}/pages/decisions`); assert.ok(pg.body.markdown.includes("Osaka") && !pg.body.markdown.includes("niece"), "a channel page is built from its own bank only");
  assert.ok(LOG.filter((l) => l.startsWith("refresh")).every((l) => l.includes(BANK("main")) || l.includes(tb)));
  // Refusals
  assert.equal((await post(`${MAIN}/people/edit`, { text: "  " })).status, 400);
  const sec = await post(`${MAIN}/people/edit`, { text: "my password is hunter2 and the key is sk-live-abcdefghijklmnopqrstuvwx1234567890" }); assert.equal(sec.status, 400); assert.equal(sec.body.secret, true);
  assert.equal((await post(`${MAIN}/notes/edit`, { text: "x" })).status, 400); assert.equal((await post(`${MAIN}/nope/edit`, { text: "x" })).status, 404);
  assert.equal((await req(`${MAIN}/people/edit`)).status, 404, "an edit is a POST");
  // Another account: its own cookie reads its own General, never this one's
  const other = await get("/w/ck1/api/notebook/main/pages", { cookie: "c2c2" }); assert.ok(other.status !== 200 || other.body?.tree?.[0]?.title !== "About Sam", "another account never gets this account's pages");
  const own = await get("/w/ck2/api/notebook/main/pages", { cookie: "c2c2" }); assert.equal(own.status, 200); assert.equal(own.body.tree[0].title, "About Rae"); assert.equal(own.body.tree[0].updated_at, null, "and sees none of the other account's pages");
  ok("air gap (each channel's own bank, own pages, own notes), empty text, secrets, notes page, GET only for reads, another account refused");
}

// ======================= 5. a page that was never built (first refresh ran on an empty bank, the interval parked the rest) =======================
{
  const bank = BANK("main"), b = bankOf(bank), mm = b.models.get("places"), before = LOG.length;
  const blank = () => { mm.content = ""; mm.based_on = { world: [], observation: [], "mental-models": [], directives: [] }; };   // reflect_skipped: no_sources_in_scope
  const { ASK_EVERY_MS } = await import("../src/notebook-pages-do.js");
  assert.equal(ASK_EVERY_MS, 1800e3);
  R1().put("hs_pr", ""); R1().put("hs_pr_asked", "");
  // The bank has no documents yet: nothing is asked.
  const docs = b.docs; b.docs = new Map(); blank();
  let pg = await get(`${MAIN}/places`); assert.equal(pg.body.markdown, ""); assert.equal(R1().hsPageNext(), null, "an empty bank asks for nothing"); assert.equal(R1().get("hs_pr_asked") || "", "", "and records nothing");
  b.docs = docs;
  // The bank now has documents: one refresh is requested, through the same waiting job an edit uses.
  pg = await get(`${MAIN}/places`); assert.equal(pg.body.markdown, ""); assert.deepEqual(JSON.parse(R1().get("hs_pr")).models, ["places"]); const t1 = JSON.parse(R1().get("hs_pr_asked")).places; assert.ok(t1 > 1e12);
  assert.equal(LOG.length, before, "nothing is refreshed while the Worker answers the read");
  // Opening the page again, any number of times, does not request again.
  for (let i = 0; i < 3; i++) await get(`${MAIN}/places`); assert.equal(JSON.parse(R1().get("hs_pr_asked")).places, t1, "the request time is kept"); assert.deepEqual(JSON.parse(R1().get("hs_pr")).models, ["places"]);
  // The job waits for the retain and the consolidation, then refreshes that page once, and the page has text.
  const refreshes = mm.refreshes || 0; R1().put("hs_pr", JSON.stringify({ ...JSON.parse(R1().get("hs_pr")), due: 0 })); settleHs(bank);
  const rr = await R1().hsPageAlarm(); assert.equal(rr.refreshed, 1); assert.equal(mm.refreshes, refreshes + 1, "one refresh");
  pg = await get(`${MAIN}/places`); assert.match(pg.body.markdown, /^## Summary/); assert.ok(pg.body.sources.length > 0);
  assert.deepEqual(LOG.slice(before).filter((l) => l.startsWith("refresh")), [`refresh ${bank} places`]);
  // A built page never asks. A page that goes blank again asks again only after the interval.
  const built = (await get(`${MAIN}/people`)).body.markdown; assert.ok(built); assert.equal(R1().hsPageNext(), null);
  blank(); await get(`${MAIN}/places`); assert.equal(R1().hsPageNext(), null, "within 1,800 seconds: not again");
  R1().put("hs_pr_asked", JSON.stringify({ places: Date.now() - ASK_EVERY_MS - 1000 })); await get(`${MAIN}/places`); assert.deepEqual(JSON.parse(R1().get("hs_pr")).models, ["places"], "after the interval: once more");
  // A background prefetch (?prefetch=1) never asks, even for a never-built page with documents in the bank; the real open right after still does.
  R1().put("hs_pr", ""); R1().put("hs_pr_asked", ""); blank();
  pg = await get(`${MAIN}/places?prefetch=1`); assert.equal(pg.status, 200); assert.equal(pg.body.markdown, ""); assert.equal(R1().hsPageNext(), null, "a prefetch asks for nothing"); assert.equal(R1().get("hs_pr_asked") || "", "", "and records nothing");
  pg = await get(`${MAIN}/places`); assert.deepEqual(JSON.parse(R1().get("hs_pr")).models, ["places"], "the real open still asks");
  ok("a page never built: one refresh requested once the bank has documents, at most once per page per 1,800 seconds, not for an empty bank, and the page then has text");
}

const ASK_EVERY = 1800e3;
// ======================= 6. GET .../pages returns every page, with its state =======================
{
  const bank = BANK("main"), b = bankOf(bank), ids = PAGES.general.map((p) => p.id);
  // ready: every page has text, equal to what the one-page route returns
  for (const id of b.models.keys()) refresh(b, id, bank); R1().put("hs_pr", ""); R1().put("hs_pr_asked", "");
  let r = await get(MAIN); assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body.pages).sort(), [...ids].sort(), "one entry per page in the tree (not the notes page)");
  for (const id of ids) { const one = (await get(`${MAIN}/${id}`)).body, pg = r.body.pages[id]; assert.deepEqual(Object.keys(pg).sort(), ["markdown", "sources", "state", "updated_at"]); assert.equal(pg.state, "ready"); assert.equal(pg.markdown, one.markdown); assert.equal(pg.updated_at, one.updated_at); assert.deepEqual(pg.sources, one.sources); }
  assert.deepEqual(r.body.tree.filter((x) => x.kind === "page").map((x) => x.id), ids); assert.ok(r.body.person && r.body.facts);
  // reads run at once: one list read plus one read per page, all in flight together
  let inflight = 0, peak = 0, calls = 0; const orig = HINDSIGHT.fetch;
  HINDSIGHT.fetch = async (u, i) => { inflight++; peak = Math.max(peak, inflight); calls++; await new Promise((z) => setTimeout(z, 25)); try { return await orig(u, i); } finally { inflight--; } };
  const t0 = Date.now(); r = await get(MAIN); const ms = Date.now() - t0; HINDSIGHT.fetch = orig;
  assert.ok(peak >= ids.length, `the page reads are in flight together (peak ${peak})`); assert.equal(calls, ids.length + 1, "one list read and one read per page, nothing else when every page is ready");
  assert.ok(ms < 25 * (ids.length + 1), `not a serial loop (${ms} ms for ${calls} calls of 25 ms each)`);
  // an account whose bank is empty: the real open imports the template, nothing to build from, every page is empty
  const R2m = env.RESIDENT.get("res:t2:main"); await R2m.bind("t2", "main", "1");
  r = await get("/w/ck2/api/notebook/main/pages", { cookie: "c2c2" }); assert.equal(r.status, 200);
  assert.deepEqual(Object.values(r.body.pages).map((p) => p.state), ids.map(() => "empty"), "no documents: empty, not building"); assert.ok(Object.values(r.body.pages).every((p) => p.markdown === "" && p.updated_at === null && p.sources.length === 0));
  assert.equal(R2m.hsPageNext(), null, "and nothing is requested");
  // an old bank (template before the people and places models): the person's real open repairs it, a prefetch does not
  b.models.delete("people"); b.models.delete("places"); R1().put("hs_tpl", ""); R1().put("hs_pr", ""); R1().put("hs_pr_asked", "");
  const imports = () => LOG.filter((l) => l === `import ${bank}`).length, i0 = imports();
  r = await get(`${MAIN}?prefetch=1`); assert.equal(imports(), i0, "a prefetch does not import"); assert.ok(!b.models.has("people")); assert.equal(R1().hsPageNext(), null); assert.equal(R1().get("hs_pr_asked") || "", "");
  assert.equal(r.body.pages.people.state, "building", "its first refresh has not run: building"); assert.equal(r.body.pages.about.state, "ready");
  r = await get(MAIN); assert.equal(imports(), i0 + 1, "the real open imports the current template once"); assert.ok(b.models.has("people") && b.models.has("places"), "the missing models now exist");
  assert.equal(r.body.pages.people.state, "building"); assert.equal(r.body.pages.places.state, "building"); assert.deepEqual(JSON.parse(R1().get("hs_pr")).models.sort(), ["people", "places"], "one waiting refresh each");
  const asked = R1().get("hs_pr_asked"); await get(MAIN); await get(MAIN); assert.equal(R1().get("hs_pr_asked"), asked, "more opens do not ask again within the interval"); assert.equal(imports(), i0 + 1);
  settleHs(bank); R1().put("hs_pr", JSON.stringify({ ...JSON.parse(R1().get("hs_pr")), due: 0 })); await R1().hsPageAlarm();
  r = await get(MAIN); assert.equal(r.body.pages.people.state, "ready"); assert.match(r.body.pages.people.markdown, /^## Summary/);
  // blank page with documents and an interval that has run out: asked once (building), and a prefetch of the same never asks
  const blank = (id) => { const m = b.models.get(id); m.content = ""; m.based_on = { world: [], observation: [] }; };
  blank("places"); R1().put("hs_pr", ""); R1().put("hs_pr_asked", JSON.stringify({ places: Date.now() - ASK_EVERY - 1000 }));
  r = await get(`${MAIN}?prefetch=1`); assert.equal(r.body.pages.places.state, "empty", "refreshed once with nothing in scope and nothing asked: empty"); assert.equal(R1().hsPageNext(), null, "a prefetch never builds");
  r = await get(MAIN); assert.equal(r.body.pages.places.state, "building"); assert.deepEqual(JSON.parse(R1().get("hs_pr")).models, ["places"]);
  // air gap: a channel lists its own pages, built from its own bank, and General's text is not in them
  const tb = bankOf(BANK(trip.slug)); r = await get(`${NB}/${trip.slug}/pages`); assert.deepEqual(Object.keys(r.body.pages).sort(), ["brief", "decisions", "open-items"]);
  assert.ok(r.body.pages.decisions.markdown.includes("Osaka") && !JSON.stringify(r.body.pages).includes("niece") && !JSON.stringify(r.body.pages).includes("oat milk"), "a channel's pages come from its own bank only"); assert.ok(tb.docs.size > 0);
  ok("all pages in one read: state ready, building or empty, parallel reads, an old bank repaired by a real open only, prefetch never builds, a channel's pages stay in its own bank");
}

// ======================= 7. the person's photo =======================
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
