// node --import ./test/stubs/register.mjs test/models-console-core.test.mjs
// The /models console: what the page renders from the real saved settings, which fields can be edited, the OR and CF badges,
// the edits the page sends through the real save path, admin-only writes, and that the old page is gone.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import worker from "../src/index.js";
import { consoleState, consoleHtml } from "../src/ee/models-console.js";
import { LIMIT_DEFS } from "../src/limits.js";
import * as C from "../app-assets/app-static/models-console-core.js";

globalThis.fetch = async () => { throw new Error("offline: this test does not use the network"); };
globalThis.HTMLRewriter = class { on() { return this; } transform(r) { return r; } };

function environment(name, extra = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT); CREATE TABLE sessions(token_hash TEXT,user_id TEXT,expires_at INTEGER);");
  for (const f of ["test/fixtures/migrations/migrations_055_model_settings.sql", "db/migrations/0050_model_job_settings.sql", "db/migrations/0058_model_served.sql"]) db.exec(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
  const hash = (v) => createHash("sha256").update(v).digest("hex");
  for (const [id, email, token] of [["admin", "admin@example.com", "aa11"], ["other", "other@example.com", "bb22"]]) { db.prepare("INSERT INTO users VALUES (?,?)").run(id, email); db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(hash(token), id, Date.now() + 3600000); }
  const DB = { prepare(q) { const st = db.prepare(q); let a = []; const s = { bind(...v) { a = v; return s; }, async first() { return st.get(...a) || null; }, async all() { return { results: st.all(...a) }; }, async run() { return { meta: { changes: Number(st.run(...a).changes) } }; } }; return s; } };
  return { ONEHELM_EE: "1hc", ENV_NAME: name, APP_HOST: "owner.example.com", MODEL_ADMINS: "admin@example.com", DYNAMIC_ROUTING: "on", DB, db, ...extra };
}
const dev = environment("dev");
const call = (path, { env = dev, token = "aa11", method = "GET", body, headers = {} } = {}) => worker.fetch(new Request(`https://${env.APP_HOST}${path}`, { method, headers: { ...(token ? { cookie: `hc_session=${token}` } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, { waitUntil() {} });
const post = (path, body, env = dev, token = "aa11") => call(path, { env, token, method: "POST", body, headers: { origin: `https://${env.APP_HOST}`, "content-type": "application/json", "x-model-settings": "1" } });
const read = async () => (await call("/models/api")).json();
const ui0 = (extra = {}) => ({ view: "all", q: "", sel: null, level: "unrestricted", ...extra });
const fields = (html) => html.match(/<(?:input|select)[^>]*data-(?:df|lim)=[^>]*>/g) || [];
const detail = (state, key, extra = {}) => { const ui = ui0({ sel: key, ...extra }); return C.drawerHtml(state, ui, C.view(state, ui), Date.now()).toString(); };
const page = (state, ui = ui0()) => C.pageHtml(state, ui, Date.now()).toString();
let checks = 0; const test = async (name, fn) => { await fn(); checks++; console.log(`ok ${checks} - ${name}`); };

const state = await read();
await test("the first page has the tabs, the search, History and one list", async () => {
  const html = await (await call("/models")).text();
  for (const piece of ["Jobs", "Sandbox", "Attention", "Limits", "Read only", 'data-act="hist"', "data-q", '<span class="kbd">/</span>', 'role="listbox"']) assert.ok(html.includes(piece), piece);
  for (const g of ["Chat categories", "Routing", "Background jobs", "Speech", "Search and media", "Other"]) assert.ok(html.includes(g), g);
  assert.match(html, /class="split"[\s\S]*class="detail"/, "the detail of a job sits beside the list and is shown at once");
  assert.match(html, /<h2>General<\/h2>/, "the first job is chosen when none was");
  assert.equal((html.match(/data-row="/g) || []).length, state.jobs.length + state.config.routing.categories.length, "one row per job, and one per routing category");
  assert.doesNotMatch(html, /Save|Reset to default|Push to prod|Differs|Changes|data-e=|data-act="review"|1helm\.com/);
  // the old per kind of request limits, the retry rows and the "Chat replies" row are gone: each routing category row carries the limits of its replies
  assert.doesNotMatch(html, /Reply limits|Retries|Retry:|Switch during a task|Everyday chat|Chat replies/);
  assert.ok(!C.rowsOf(state).some((r) => r.id === "chat" || r.group === "chatlimits"), "there is no chat job row");
  const general = C.rowsOf(state).find((r) => r.kind === "cat" && r.id === "general"); assert.ok(general, "General has a row");
  const v = C.viewOf(state, ui0(), general, C.snapshotFromConfig(state)); assert.ok(v.hasChain && v.chain.length === 3 && v.showOut && v.showSort && v.showTimeout, "its models and its limits can be edited on its own row");
  // a limit edited on a category row is saved on that category only
  const cfg = C.applyEdit(state.config, { t: "field", cat: "general", field: "max_output", value: 4000 }); assert.equal(cfg.routing.categories[0].max_output, 4000); assert.equal(cfg.jobs.label.max_output, state.config.jobs.label.max_output);
  assert.equal(C.viewOf(state, ui0(), general, C.snapshotFromConfig({ ...state, config: cfg })).max_output, 4000);
});

await test("every model in the detail carries an OR or CF badge, and the list marks the ones that are not on OpenRouter", () => {
  for (const r of C.rowsOf(state)) { const d = detail(state, r.key); if (/class="ent"/.test(d)) assert.match(d, /<span class="badge (OR|CF|SELF)"/, r.key); }
  assert.match(page(state, ui0({ view: "speech" })), /badge CF/, "a Cloudflare model says CF");
  for (const key of ["stt", "stt_cloudflare", "web_search"]) { const d = C.drawerHtml(state, ui0({ sel: key }), C.view(state, ui0({ sel: key })), Date.now()).toString(); assert.match(d, /class="badge (OR|CF)"/, key); }
  assert.match(C.drawerHtml(state, ui0({ sel: "stt_cloudflare" }), C.view(state, ui0()), Date.now()).toString(), /badge CF/);
  assert.equal(C.srcOf(state, "@cf/x/y"), "CF"); assert.equal(C.srcOf(state, "cloudflare/linkup"), "CF"); assert.equal(C.srcOf(state, "a/b"), "OR");
});

await test("every field an administrator can set has an input in the detail of its job", () => {
  assert.ok(fields(detail(state, "label")).some((t) => !/\sdisabled/.test(t)), "dev's fields are editable");
  // the detail of a chat model job: model, fallbacks, reasoning, max output, timeout, sort, max price
  const job = state.jobs.find((j) => j.id === "handoff"), v = C.view(state, ui0({ sel: "handoff" }));
  const d = C.drawerHtml(state, ui0({ sel: "handoff" }), v, Date.now()).toString();
  for (const f of ['data-act="chg"', 'data-act="add"', 'data-act="up"', 'data-act="dn"', 'data-act="rm"', 'data-df="effort"', 'data-df="max_output"', 'data-df="timeout"', 'data-df="sort"', 'data-df="pi"', 'data-df="po"']) assert.ok(d.includes(f), f);
  assert.ok(job.max_fallbacks > 0);
  // the web search job has a number of results; a category has a title, three models per privacy level and a delete button
  assert.match(C.drawerHtml(state, ui0({ sel: "web_search" }), C.view(state, ui0({ sel: "web_search" })), Date.now()).toString(), /data-df="results"/);
  const added = C.applyEdit(state.config, { t: "catAdd", newId: "cat_test" });
  const st2 = { ...state, config: added }, cd = C.drawerHtml(st2, ui0({ sel: "cat:cat_test" }), C.view(st2, ui0({ sel: "cat:cat_test" })), Date.now()).toString();
  for (const f of ['data-df="title"', 'data-act="catdelete"', 'data-lvl="zdr"', 'data-lvl="no_training"', 'data-act="chg"']) assert.ok(cd.includes(f), f);
  assert.equal((cd.match(/data-act="chg"/g) || []).length, 3, "three models in a chain");
  assert.doesNotMatch(C.drawerHtml(state, ui0({ sel: "cat:general" }), C.view(state, ui0()), Date.now()).toString(), /data-df="title"|catdelete/, "General can't be renamed or deleted");
  // the limits view has one input for every limit
  const lim = page(state, ui0({ view: "limits" }));
  for (const d of LIMIT_DEFS) assert.ok(lim.includes(`data-lim="${d.key}"`), d.key);
  assert.doesNotMatch(lim, /data-act="payout"|Affiliate payouts|Live:|lvn/);
});

await test("a model name from the catalog renders as text, in the table and the picker", () => {
  const evil = '<img src=x onerror=alert(1)>';
  const cfg = structuredClone(state.config); cfg.catalog[cfg.jobs.label.model].name = evil;
  const st = { ...state, config: cfg }, html = page(st);
  assert.doesNotMatch(html, /<img src=x/); assert.match(html, /&lt;img src=x/);
  const item = C.pickerItem(st, { id: "a/b", name: evil, allowed: true, levels: ["zdr"] }, 0, 0, "").toString(); assert.doesNotMatch(item, /<img src=x/);
});

await test("an empty search, an empty attention list and the save state are said plainly", () => {
  // search with no match, and nothing needing attention, are said plainly
  assert.match(page(state, ui0({ q: "zzzz" })), /No jobs match "zzzz"[\s\S]*Clear search/); assert.match(page(state, ui0({ view: "attention" })), /Nothing needs attention/);
  // a saved edit shows Saved with Undo, a refused one says so
  assert.match(page(state, ui0({ save: { k: "saved" }, undo: { revision: 3 } })), /Saved<\/span><button class="lnk" data-act="undo">Undo/); assert.match(page(state, ui0({ save: { k: "failed" } })), /Not saved/); assert.match(page(state, ui0({ save: { k: "saving" } })), /Saving/);
});

// ---- the edits go through the real save path, history and validation ----
const save = async (cfg) => { const v = await read(); return post("/models/api/save", C.saveBody(cfg, v.revision)); };
await test("each inline edit saves through the real save path and shows on the next read", async () => {
  let v = await read(), cfg = v.config;
  const edits = [{ t: "field", id: "label", field: "max_output", value: 2048 }, { t: "field", id: "notes", field: "sort", value: "latency" }, { t: "field", id: "notes", field: "max_price", value: { prompt: 1, completion: 4 } },
    { t: "effort", id: "label", idx: 0, value: v.config.catalog[v.config.jobs.label.model].efforts.at(-1) }, { t: "move", id: "handoff", idx: 1, d: -1 }, { t: "remove", id: "handoff", idx: 1 },
    { t: "title", cat: "cat_x", value: "Renamed" }];
  const rev = v.revision;
  for (const e of edits.slice(0, 6)) cfg = C.applyEdit(cfg, e) || cfg;
  cfg = C.applyEdit(cfg, { t: "catAdd", newId: "cat_x" }); cfg = C.applyEdit(cfg, edits[6]);
  const r = await save(cfg); assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  v = await r.json(); assert.equal(v.revision, rev + 1);
  assert.equal(v.config.jobs.label.max_output, 2048); assert.equal(v.config.jobs.notes.sort, "latency"); assert.deepEqual(v.config.jobs.notes.max_price, { prompt: 1, completion: 4 });
  assert.equal(v.config.jobs.handoff.fallbacks.length, 0); assert.equal(v.config.routing.categories.at(-1).title, "Renamed"); assert.equal(v.history[0].by, "admin@example.com");
  v = await read(); const del = await save(C.applyEdit(v.config, { t: "catDelete", cat: "cat_x" })); assert.equal(del.status, 200);
  assert.deepEqual((await del.json()).config.routing.categories.map((c) => c.id), ["general"]);
});

await test("a limit and a job timeout save through the real save path, and a starting value is stored as nothing", async () => {
  let v = await read(), cfg = C.applyEdit(v.config, { t: "limit", limitKey: "chat_steps", value: 80 });
  cfg = C.applyEdit(cfg, { t: "field", id: "label", field: "timeout_ms", value: 45000 });
  let r = await save(cfg); assert.equal(r.status, 200, JSON.stringify(await r.clone().json())); v = await r.json();
  assert.equal(v.limits.values.chat_steps, 80); assert.equal(v.config.jobs.label.timeout_ms, 45000);
  assert.match(detail(v, "label"), /data-df="timeout"[^>]*value="45"/);
  r = await save(C.applyEdit(v.config, { t: "limit", limitKey: "chat_steps", value: null })); v = await r.json(); assert.equal(v.limits.values.chat_steps, 60); assert.equal(v.config.limits?.chat_steps, undefined);
  r = await save(C.applyEdit(v.config, { t: "field", id: "label", field: "timeout_ms", value: 5 })); assert.equal(r.status, 400, "a timeout under a second is refused");
  r = await save(C.applyEdit(v.config, { t: "field", id: "label", field: "timeout_ms", value: null })); assert.equal((await r.json()).config.jobs.label.timeout_ms, null, "empty means no timeout");
});

await test("a bad value is refused by the server, nothing is saved, and the page shows the reason", async () => {
  const v = await read(), cfg = C.applyEdit(v.config, { t: "field", id: "label", field: "max_output", value: -5 });
  const r = await save(cfg); assert.equal(r.status, 400); assert.match((await r.json()).error, /max output/);
  assert.equal((await read()).revision, v.revision);
  const dup = C.applyEdit(v.config, { t: "catAdd", newId: "cat_dup" }); dup.routing.categories[1].title = "General";
  assert.equal((await save(dup)).status, 400);
  assert.equal(C.applyEdit(v.config, { t: "title", cat: "general", value: "x" }), null, "General's title is locked");
  assert.equal(C.applyEdit(v.config, { t: "catDelete", cat: "general" }), null);
});

await test("only MODEL_ADMINS can write, and only from the same site", async () => {
  const v = await read(), body = C.saveBody(C.applyEdit(v.config, { t: "field", id: "label", field: "max_output", value: 100 }), v.revision);
  assert.equal((await post("/models/api/save", body, dev, "bb22")).status, 403);
  assert.equal((await post("/models/api/save", body, dev, null)).status, 401);
  assert.equal((await call("/models/api/save", { method: "POST", body, headers: { origin: "https://evil.example", "content-type": "application/json", "x-model-settings": "1" } })).status, 403);
  assert.equal((await call("/models/api/save", { method: "POST", body, headers: { origin: "https://owner.example.com", "content-type": "application/json" } })).status, 403, "no custom header");
  assert.equal((await read()).revision, v.revision);
});

await test("last served: the flag comes from the requested list entry, never from the name the provider reported", () => {
  const now = Date.now(), row = C.rowByKey(state, "label"), snap = C.snapshotFromConfig(state), main = state.config.jobs.label.model, fb = state.config.jobs.label.fallbacks[0].model;
  const st = (sv) => C.servedState(state, row, C.chainsOf(state, row, snap), { label: sv && { since: 0, last_at: now - 60000, ...sv } });
  assert.equal(st({ requested: main, served_model: main + "-20261001", last_status: "ok" }).k, "ok", "the first entry is normal, whatever dated name answered");
  assert.equal(st({ requested: main, served_model: "other/unexpected", last_status: "ok" }).k, "ok", "the provider's name is information only");
  assert.equal(st({ requested: main, served_model: null, last_status: "ok" }).k, "ok", "an answer that names no model is still judged by the requested entry");
  assert.equal(st({ requested: fb, served_model: fb, last_status: "ok" }).k, "fallback");
  assert.equal(st({ requested: "other/not-in-the-list", served_model: main, last_status: "ok" }).k, "other", "a requested entry that is not in the list");
  assert.equal(st({ requested: main, served_model: main, last_status: "HTTP 502" }).k, "error");
  assert.equal(st({ served_model: main, last_status: "ok" }).k, "none", "a row with no requested entry gets no flag");
  assert.equal(st(undefined).k, "none");
  const withServed = { ...state, served: { label: { since: 0, requested: "other/not-in-the-list", served_model: "other/unexpected", served_provider: "openrouter", last_at: now - 120000, calls: 4, last_status: "ok" } } };
  const html = C.pageHtml(withServed, ui0({ sel: "label" }), now).toString(); assert.match(html, /unexpected/); assert.match(html, /Served an unlisted model/); assert.match(html, /mk bad[^>]*>Unlisted model/);
  assert.match(C.drawerHtml(withServed, ui0({ sel: "label" }), C.view(withServed, ui0({ sel: "label" })), now).toString(), /other\/unexpected[\s\S]*openrouter/);
});

await test("last served: a call is judged only against the models that were saved when it was served, never against a list saved after it", () => {
  const now = Date.now(), row = C.rowByKey(state, "label"), snap = C.snapshotFromConfig(state), main = state.config.jobs.label.model, fb = state.config.jobs.label.fallbacks[0].model;
  const chains = C.chainsOf(state, row, snap), k = (sv) => C.servedState(state, row, chains, { label: sv }).k;
  const hour = 3600000, served = { served_model: "x/y", last_status: "ok", calls: 3 };
  // the row's models changed 1 hour ago, and the last call was 5 hours ago: whatever it asked for, it is history, with nothing flagged
  for (const requested of [main, fb, "other/old-model"]) assert.equal(k({ ...served, requested, last_at: now - 5 * hour, since: now - hour }), "history", requested);
  assert.equal(k({ ...served, requested: main, last_at: now - 5 * hour, since: now - hour, last_status: "HTTP 502" }), "history", "a failure from before the change is history too");
  assert.equal(k({ ...served, requested: main, last_status: "HTTP 502", last_at: now - 9 * hour, last_error_at: now - 5 * hour, since: now - hour }), "history", "a failure is dated by its own time");
  // a call after the change is judged
  assert.equal(k({ ...served, requested: "other/old-model", last_at: now - 10 * 60000, since: now - hour }), "other");
  assert.equal(k({ ...served, requested: fb, last_at: now - 10 * 60000, since: now - hour }), "fallback");
  assert.equal(k({ ...served, requested: main, last_at: now - 10 * 60000, since: now - hour }), "ok");
  assert.equal(k({ ...served, requested: main, last_status: "HTTP 502", last_at: now - 3 * hour, last_error_at: now - 60000, since: now - hour }), "error", "a failure after the change is flagged");
  // a row that carries no change time (a Live from before this release) is not judged
  assert.equal(k({ ...served, requested: "other/old-model", last_at: now - 60000 }), "history");
  assert.equal(k({ ...served, requested: "other/old-model", last_at: now - 60000, since: null }), "history");
  // the page: an edit after the call raises no flag and no attention count
  const edited = { ...state, served: { label: { ...served, requested: main, last_at: now - 5 * hour, since: now - hour } } };
  const cfg = C.applyEdit(edited.config, { t: "entry", id: "label", idx: 0, entry: { model: "x/brand-new", effort: null } }), st = { ...edited, config: cfg };
  const info = C.view(st, ui0()).info.find((x) => x.row.key === "label");
  assert.equal(info.ss.k, "history"); assert.deepEqual(C.attentionKinds(info.flags), []);
  const html = page(st).split('data-row="label"')[1].split('data-row=')[0]; assert.doesNotMatch(html, /mk bad|mk warn/);
  const hist = detail(st, "label"); assert.match(hist, /Before the last change to this job/); assert.doesNotMatch(hist, /tag bad|tag warn|class="notice/);
  assert.equal(C.visibleInfo(st, ui0({ view: "attention" }), C.view(st, ui0({ view: "attention" }))).length, 0);
  const now2 = { ...st, served: { label: { ...served, requested: "other/old-model", last_at: now - 60000, since: now - hour } } };
  assert.ok(C.attentionKinds(C.view(now2, ui0()).info.find((x) => x.row.key === "label").flags).length, "the current flag is shown");
});

await test("last served, real dev cases: the embed prefix, alias entries, and a model from the same company", () => {
  const flag = (id, sv) => { const row = C.rowByKey(state, id), snap = C.snapshotFromConfig(state); return C.servedState(state, row, C.chainsOf(state, row, snap), { [id]: { since: 0, last_at: Date.now() - 60000, ...sv } }); };
  // embed_files asked for perplexity/pplx-embed-v1-0.6b and Perplexity reported pplx-embed-v1-0.6b with no prefix: normal
  const embed = state.config.jobs.embed_files; assert.ok(embed, "embed_files is saved");
  assert.equal(flag("embed_files", { requested: embed.model, served_model: "pplx-embed-v1-0.6b", served_provider: "Perplexity", last_status: "ok" }).k, "ok");
  // an alias entry: the requested alias is the entry, and a different model of the same company does not turn a fallback or an unlisted request into normal
  const label = state.config.jobs.label, alias = label.model;
  assert.equal(flag("label", { requested: alias, served_model: "anthropic/claude-haiku-4.5", last_status: "ok" }).k, "ok");
  assert.equal(flag("label", { requested: "anthropic/claude-opus-5", served_model: "anthropic/claude-haiku-4.5", last_status: "ok" }).k, "other", "same company is not the same entry");
  assert.equal(flag("label", { requested: alias, served_model: null, served_provider: null, last_status: "ok" }).k, "ok", "label with no served name");
});

await test("last served: each routing category reads its own row, and an older Live's single chat row serves General only", () => {
  const cfg = C.applyEdit(C.applyEdit(state.config, { t: "catAdd", newId: "technical" }), { t: "catAdd", newId: "research" });
  const st2 = { ...state, config: cfg }, snap = C.snapshotFromConfig(st2), cats = cfg.routing.categories, row = (id) => ({ key: "cat:" + id, kind: "cat", id });
  const general = cats.find((c) => c.id === "general"), other = cats.find((c) => c.id === "technical");
  assert.ok(general && other && cats.length >= 3, "the settings have General and two more categories");
  const first = (c) => c.chains.zdr[0].model;
  const served = { "chat:general": { since: 0, requested: first(general), served_model: "x/g", last_at: 1, calls: 3, last_status: "ok" }, ["chat:" + other.id]: { since: 0, requested: first(other), served_model: "x/o", last_at: 2, calls: 5, last_status: "ok" } };
  const sv = (id, data = served) => C.servedState(st2, row(id), C.chainsOf(st2, row(id), snap), data);
  assert.equal(sv("general").sv.served_model, "x/g"); assert.equal(sv(other.id).sv.served_model, "x/o");
  assert.equal(sv("research").k, "none", "a category with no reply yet shows nothing");
  assert.equal(C.servedKey(row(other.id)), "chat:" + other.id); assert.equal(C.servedKey(C.rowByKey(state, "label")), "label");
  // an older Live reports one "chat" row: General reads it, other categories do not, and a request outside General's list is not called unlisted
  const legacy = { chat: { requested: "some/other-categorys-model", served_model: "y/z", last_at: 3, calls: 9, last_status: "ok" } };
  assert.equal(sv("general", legacy).sv.served_model, "y/z"); assert.equal(sv("general", legacy).k, "history", "shown as information, never judged");
  assert.equal(sv(other.id, legacy).k, "none");
  assert.equal(sv("general", { ...legacy, "chat:technical": served["chat:general"] }).k, "none", "once a chat: row exists, the old row is ignored");
  assert.equal(sv("general", { chat: { since: 0, requested: first(general), last_at: 3, last_status: "ok" } }).k, "history", "the old row is history, never flagged, even when its entry is listed");
});

await test("Needs attention lists only jobs with a warning or a problem; search finds a job by its name or model", () => {
  const st = { ...state, served: { label: { since: 0, requested: "other/not-in-the-list", served_model: "other/unexpected", last_at: Date.now(), last_status: "ok" } } };
  const att = C.visibleInfo(st, ui0({ view: "attention" }), C.view(st, ui0({ view: "attention" }))).map((x) => x.row.key);
  assert.deepEqual(att, ["label"]);
  const found = C.visibleInfo(state, ui0({ q: "task summaries" }), C.view(state, ui0())).map((x) => x.row.key); assert.deepEqual(found, ["label"]);
});

await test("the picker lists every model, and shows a model that the chain's privacy level forbids as unavailable instead of hiding it", () => {
  const tg = { key: "label", kind: "job", jv: state.jobs.find((j) => j.id === "label"), idx: 1, level: "zdr" };
  const mk = (id, levels, extra = {}) => ({ id, name: id, levels, eligible: true, chat: true, kinds: ["chat"], ...extra });
  const fresh = [mk("x/zdr", ["unrestricted", "no_training", "zdr"]), mk("x/open", ["unrestricted"]), mk("x/unknown", undefined), mk("~x/family-latest", ["zdr"])];
  const list = C.pickerList(state, tg, "", fresh, "all"), by = Object.fromEntries(list.map((m) => [m.id, m]));
  assert.equal(by["x/zdr"].allowed, true); assert.equal(by["x/open"].allowed, false, "listed, but not allowed for a zero-data-retention job"); assert.equal(by["x/unknown"].allowed, true); assert.equal(by["~x/family-latest"].allowed, true);
  const cat = { key: "cat:general", kind: "cat", level: "zdr", idx: 0 };
  assert.equal(C.pickerList(state, cat, "", fresh, "all").find((m) => m.id === "x/open").allowed, false);
  assert.equal(C.pickerList(state, { ...cat, level: "unrestricted" }, "", fresh, "all").find((m) => m.id === "x/open").allowed, true);
  assert.deepEqual(C.pickerList(state, tg, "family", fresh, "all").map((m) => m.id), ["~x/family-latest"]);
  assert.ok(C.pickerList(state, { ...tg, key: "stt_cloudflare", jv: state.jobs.find((j) => j.id === "stt_cloudflare") }, "", [], "CF").every((m) => C.srcOf(state, m.id, m.source) === "CF"));
  // choosing a model gives the job a reasoning level that model supports, and marks a background job's entry strict
  const e = C.newEntry(state, tg.jv, { id: "x/zdr", efforts: ["low", "high"], default_effort: "low", chat: true }, { effort: "xhigh" });
  assert.equal(e.effort, "low"); assert.equal(e.strict, true);
});

await test("the list is quiet about defaults: only a limit that was changed from its starting value shows, and the detail offers a way back", () => {
  const html = page(state), list = html.split('class="lbody"')[1].split('class="detail"')[0];
  assert.doesNotMatch(list.replace(/<[^>]+>/g, " "), /Default|Provider max/, "a job on its starting values has no limit text in the list");
  assert.equal((list.match(/class="chip"/g) || []).length, 0, "the starting values of every job show no chip");
  const cfg = C.applyEdit(C.applyEdit(state.config, { t: "field", id: "label", field: "max_output", value: 2048 }), { t: "field", id: "label", field: "max_price", value: { prompt: 1, completion: 4 } });
  const st = { ...state, config: cfg }, row = C.rowByKey(st, "label"), v = C.viewOf(st, ui0(), row, C.snapshotFromConfig(st));
  assert.deepEqual(C.overridesOf(st, row, v).map((o) => o.k), ["max_output", "max_price"]);
  const item = page(st).split('data-row="label"')[1].split('data-row=')[0]; assert.match(item, /2,048 max output/); assert.match(item, /\$1\/\$4 max/);
  const d = detail(st, "label"); assert.match(d, /data-act="reset" data-field="max_output"/); assert.match(d, /data-act="reset" data-field="max_price"/); assert.doesNotMatch(d, /data-act="reset" data-field="sort"/, "a limit at its starting value has no Reset");
  // Reset writes the starting value of the field, and a limit's Reset on the Limits page writes nothing
  assert.equal(C.startOf(st, row, "max_output"), state.defaults.label.max_output ?? null);
  const back = C.applyEdit(cfg, { t: "field", id: "label", field: "max_output", value: C.startOf(st, row, "max_output") });
  assert.equal(C.overridesOf(st, row, C.viewOf(st, ui0(), row, C.snapshotFromConfig({ ...st, config: back }))).filter((o) => o.k === "max_output").length, 0);
  const lim = page({ ...st, limits: { ...st.limits, values: { ...st.limits.values, chat_steps: 80 } } }, ui0({ view: "limits" })); assert.match(lim, /data-act="limreset" data-key="chat_steps"/); assert.equal((lim.match(/data-act="limreset"/g) || []).length, 1);
  // a filter shows its first job in the detail, and a chosen job that this environment lacks falls back to the first one
  const V = C.view(state, ui0()); assert.equal(C.resolveSel(state, ui0({ sel: "label" }), V), "label"); assert.equal(C.resolveSel(state, ui0({ sel: "nope" }), V), C.rowsOf(state)[0].key);
});

await test("a job whose answer named no model shows the requested model marked as the requested name, never as the served model", () => {
  const main = state.config.jobs.label.model;
  const st = { ...state, served: { label: { since: 0, requested: main, served_model: null, served_provider: null, last_at: Date.now(), calls: 2, last_status: "ok" } } };
  const row = page(st).split('data-row="label"')[1].split('data-row=')[0];
  assert.doesNotMatch(row, /No calls yet|null|undefined/);
  const drawer = C.drawerHtml(st, ui0({ sel: "label" }), C.view(st, ui0({ sel: "label" })), Date.now()).toString();
  assert.match(drawer, /Last served/); assert.match(drawer, /requested name, the answer named no model/); assert.doesNotMatch(drawer, /<dt>Provider<\/dt>/);
});

await test("the old page is gone: no models-page.js, no inline script, and no private host or Live and push exports", () => {
  assert.equal(existsSync(new URL("../src/ee/models-page.js", import.meta.url)), false);
  const names = readdirSync(new URL("../src/ee", import.meta.url)).filter((f) => f.endsWith(".js"));
  for (const f of names) { const t = readFileSync(new URL(`../src/ee/${f}`, import.meta.url), "utf8"); assert.doesNotMatch(t, /models-page\.js|modelsHtml|JOB_DIFF_JS/, f); }
  const html = consoleHtml(state); assert.doesNotMatch(html, /<script>/);
  for (const name of ["snapshotFromReport", "diffSnapshots", "matchEdit", "pushModal", "pushResult", "diffRows", "pushWarnings", "changesView"]) assert.equal(name in C, false, name);
});

console.log(`PASS ${checks} models console checks`);
dev.db.close();

// A JSON reply in the Sandbox shows as labeled fields.
{
  assert.equal(C.parseJsonReply("plain text"), null); assert.equal(C.parseJsonReply("{broken"), null); assert.equal(C.parseJsonReply("[1,2]"), null); assert.equal(C.parseJsonReply('"x"'), null);
  assert.deepEqual(C.parseJsonReply(' {"a":1} '), { a: 1 }); assert.deepEqual(C.parseJsonReply('[{"a":1},{"b":2}]'), [{ a: 1 }, { b: 2 }]);
  assert.equal(C.humanizeKey("occurred_start"), "Occurred start"); assert.equal(C.humanizeKey("title"), "Title");
  const html = String(C.jsonFieldsHtml({ title: "T <i>x</i>", n: 3, ok: false, nil: null, why: { 1: "a", deep: { z: [1] } }, list: ["p", "q"] }));
  assert.ok(html.indexOf("Title") < html.indexOf("Why") && html.indexOf("Why") < html.indexOf("List"), "the model's key order is kept");
  assert.match(html, /<dt>Title<\/dt><dd><span class="sb-text">T &lt;i&gt;x&lt;\/i&gt;<\/span>/); assert.doesNotMatch(html, /<i>/);
  assert.match(html, /<dt>N<\/dt><dd><span class="sb-text">3</); assert.match(html, /<dt>Ok<\/dt><dd><span class="sb-text">false</);
  assert.match(html, /<dl class="sb-kv in"><dt>1<\/dt>/); assert.match(html, /<dt>Deep<\/dt><dd><pre class="sb-pre mono">\{\n  &quot;z&quot;: \[/);
}

await test("the Sandbox reasoning level starts on the saved level when the model has it, otherwise the model's default", () => {
  assert.equal(C.startEffort("low", ["low", "medium", "high"], "medium"), "low");
  assert.equal(C.startEffort("low", ["medium", "high"], "medium"), "medium");
  assert.equal(C.startEffort("low", ["high"], "medium"), "high");
  assert.equal(C.startEffort("low", [], null), null);
});
await test("the Sandbox reads the reasoning level a send carried from the recorded request", () => {
  const rq = (body) => ({ requests: [{ url: "x", body }] });
  assert.equal(C.sentEffort(rq({ model: "m", reasoning: { effort: "low" } })), "low");
  assert.equal(C.sentEffort(rq({ model: "m", reasoning: { enabled: false } })), "none");
  assert.equal(C.sentEffort(rq({ model: "m" })), null);
  assert.equal(C.sentEffort(null), null);
});
await test("a reply shows the reasoning tokens inside the output count and the level sent", () => {
  const state = { config: { catalog: {} }, jobs: [] };
  const html = C.sandboxInner(state, { jobs: [{ id: "x", label: "X", group: "g" }], job: "x", turns: [{ role: "reply", reply: { ok: true, served: "m/a", tokens_in: 10, tokens_out: 4856, tokens_reasoning: 4693, raw_request: { requests: [{ body: { reasoning: { effort: "medium" } } }] }, view: { type: "chat", text: "hi" } } }] }).toString();
  assert.match(html, /4,856 out \(4,693 reasoning\)/); assert.match(html, /reasoning medium/);
});
await test("Sandbox compare slots: slot 0 is the Sandbox state, up to three slots, one column each with its model name", () => {
  const state = { config: { catalog: { "a/one": { name: "One", efforts: ["low"] }, "b/two": { name: "Two", efforts: [] } }, jobs: { x: { model: "a/one", effort: "low" } }, routing: { categories: [] } }, jobs: [{ id: "x", has_effort: true }] };
  const job = { id: "x", label: "X", group: "g", model: "a/one" };
  const reply = (text) => ({ role: "reply", reply: { ok: true, served: "m", view: { type: "chat", text } } });
  const one = { jobs: [job], job: "x", turns: [] };
  assert.deepEqual(C.slotsOf(one), [one]); assert.equal(C.SLOTS_MAX, 3);
  assert.equal(C.slotModelName(state, job, one), "One"); assert.equal(C.slotModelName(state, job, { model: { id: "b/two", name: "Two <b>" } }), "Two <b>");
  assert.doesNotMatch(C.sandboxInner(state, one).toString(), /sb-cols|rmslot/); assert.match(C.sandboxInner(state, one).toString(), /data-sb-act="addslot"/);
  const two = { ...one, turns: [reply("first")], extra: [{ ...C.newSlot(), model: { id: "b/two", name: "Two <b>" }, turns: [reply("second <i>")] }] };
  const html = C.sandboxInner(state, two).toString();
  assert.match(html, /sb-cols c2/); assert.equal((html.match(/class="sb-col"/g) || []).length, 2); assert.match(html, /Two &lt;b&gt;/); assert.doesNotMatch(html, /Two <b>/);
  assert.match(html, /second &lt;i&gt;/); assert.equal((html.match(/data-sb-act="rmslot"/g) || []).length, 1); assert.match(html, /data-sb-raw="1\.0"/); assert.match(html, /data-sb-raw="0\.0"/);
  const three = { ...two, extra: [two.extra[0], C.newSlot()] };
  assert.doesNotMatch(C.sandboxInner(state, three).toString(), /data-sb-act="addslot"/); assert.match(C.sandboxInner(state, three).toString(), /sb-cols c3/);
});
