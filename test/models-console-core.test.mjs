// node --import ./test/stubs/register.mjs test/models-console-core.test.mjs
// The /models console: what the page renders from the real saved settings, which fields can be edited, the OR and CF badges, the push diff,
// the edits the page sends through the real save path, admin-only writes, and that the old page is gone.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import worker from "../src/index.js";
import { consoleState, consoleHtml } from "../src/ee/models-console.js";
import { LIMIT_DEFS } from "../src/ee/limits.js";
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
const fields = (html) => html.match(/<(?:input|select)[^>]*data-f=[^>]*>/g) || [];
const page = (state, ui = ui0()) => C.pageHtml(state, ui, Date.now()).toString();
let checks = 0; const test = async (name, fn) => { await fn(); checks++; console.log(`ok ${checks} - ${name}`); };

const state = await read();
await test("the first page has the sidebar, the search, History and one table", async () => {
  const html = await (await call("/models")).text();
  for (const piece of ["All jobs", "Needs attention", "Limits", "Read only", 'data-act="hist"', "data-q", '<span class="kbd">/</span>', 'role="table"']) assert.ok(html.includes(piece), piece);
  for (const g of ["Chat categories", "Reply limits", "Retries", "Routing", "Background jobs", "Speech", "Search and media", "Other"]) assert.ok(html.includes(g), g);
  assert.equal((html.match(/data-row="/g) || []).length, state.jobs.length - 0 + state.config.routing.categories.length, "one row per job, and one per routing category");
  assert.doesNotMatch(html, /Save|Reset to default|Push to prod|Differs from Live|data-e=|1helm\.com/);
});

await test("every model on the table and the inspector carries an OR or CF badge", () => {
  const html = page(state);
  for (const row of html.split('class="rw"').slice(1)) {
    const cell = row.split('<div class="cm">')[1].split("</div><div>")[0];
    if (cell.trim() === "" || /None</.test(cell)) continue;
    assert.match(cell, /<span class="badge (OR|CF)"/, cell);
  }
  assert.match(page(state, ui0({ view: "speech" })), /badge CF/, "a Cloudflare model says CF");
  for (const key of ["stt", "stt_cloudflare", "web_search"]) { const d = C.drawerHtml(state, ui0({ sel: key }), C.view(state, ui0({ sel: key })), Date.now()).toString(); assert.match(d, /class="badge (OR|CF)"/, key); }
  assert.match(C.drawerHtml(state, ui0({ sel: "stt_cloudflare" }), C.view(state, ui0()), Date.now()).toString(), /badge CF/);
  assert.equal(C.srcOf(state, "@cf/x/y"), "CF"); assert.equal(C.srcOf(state, "cloudflare/linkup"), "CF"); assert.equal(C.srcOf(state, "a/b"), "OR");
});

await test("every field an administrator can set has an input in the table or the inspector", () => {
  const html = page(state), has = (s) => assert.ok(html.includes(s), s);
  assert.ok(fields(html).some((t) => !/\sdisabled/.test(t)), "dev's fields are editable");
  for (const f of ['data-f="effort"', 'data-f="max_output"', 'data-f="sort"', 'data-f="price" data-w="prompt"', 'data-f="price" data-w="completion"', 'data-f="timeout"']) has(f);
  // the inspector of a chat model job: model, fallbacks, reasoning, max output, timeout, sort, max price
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
  assert.doesNotMatch(lim, /payout|Live/i);
});

await test("a model name from the catalog renders as text, in the table and the picker", () => {
  const evil = '<img src=x onerror=alert(1)>';
  const cfg = structuredClone(state.config); cfg.catalog[cfg.jobs.label.model].name = evil;
  const st = { ...state, config: cfg }, html = page(st);
  assert.doesNotMatch(html, /<img src=x/); assert.match(html, /&lt;img src=x/);
  const item = C.pickerItem(st, { id: "a/b", name: evil, allowed: true, levels: ["zdr"] }, 0, 0, "").toString(); assert.doesNotMatch(item, /<img src=x/);
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
  assert.match(page(v), /data-f="timeout"[^>]*value="45"/);
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

await test("last served: the model that answered is shown, and a model off the saved list or a failed call is flagged", () => {
  const now = Date.now(), row = C.rowByKey(state, "label"), snap = C.snapshotFromConfig(state), main = state.config.jobs.label.model;
  const st = (sv) => C.servedState(state, row, C.chainsOf(state, row, snap), { label: sv });
  assert.equal(st({ served_model: main + "-20261001", last_status: "ok" }).k, "ok", "a dated version of the saved model is the saved model");
  assert.equal(st({ served_model: state.config.jobs.label.fallbacks[0].model, last_status: "ok" }).k, "fallback");
  assert.equal(st({ served_model: "other/unexpected", last_status: "ok" }).k, "other");
  assert.equal(st({ served_model: main, last_status: "HTTP 502" }).k, "error");
  assert.equal(st(undefined).k, "none");
  const withServed = { ...state, served: { label: { served_model: "other/unexpected", served_provider: "openrouter", last_at: now - 120000, calls: 4, last_status: "ok" } } };
  const html = page(withServed); assert.match(html, /unexpected/); assert.match(html, /Served an unlisted model|dot bad/);
  assert.match(C.drawerHtml(withServed, ui0({ sel: "label" }), C.view(withServed, ui0({ sel: "label" })), now).toString(), /other\/unexpected[\s\S]*openrouter/);
});

await test("Needs attention lists only jobs with a warning or a problem; search finds a job by its name or model", () => {
  const st = { ...state, served: { label: { served_model: "other/unexpected", last_at: Date.now(), last_status: "ok" } } };
  const att = C.visibleInfo(st, ui0({ view: "attention" }), C.view(st, ui0({ view: "attention" }))).map((x) => x.row.key);
  assert.deepEqual(att, ["label"]);
  const found = C.visibleInfo(state, ui0({ q: "task titles" }), C.view(state, ui0())).map((x) => x.row.key); assert.deepEqual(found, ["label"]);
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

await test("a job whose last call recorded no served model shows nothing for it, not a placeholder", () => {
  const st = { ...state, served: { label: { served_model: null, served_provider: null, last_at: Date.now(), calls: 2, last_status: "ok" } } };
  const row = page(st).split('data-row="label"')[1].split('data-row=')[0];
  assert.doesNotMatch(row, /No calls yet|null|undefined/); assert.doesNotMatch(C.drawerHtml(st, ui0({ sel: "label" }), C.view(st, ui0({ sel: "label" })), Date.now()).toString(), /Last served/);
});

await test("the old page is gone: no models-page.js, no inline script, and no private host or Live and push exports", () => {
  assert.equal(existsSync(new URL("../src/ee/models-page.js", import.meta.url)), false);
  const names = readdirSync(new URL("../src/ee", import.meta.url)).filter((f) => f.endsWith(".js"));
  for (const f of names) { const t = readFileSync(new URL(`../src/ee/${f}`, import.meta.url), "utf8"); assert.doesNotMatch(t, /models-page\.js|modelsHtml|JOB_DIFF_JS/, f); }
  const html = consoleHtml(state); assert.doesNotMatch(html, /<script>/);
  for (const name of ["snapshotFromReport", "diffSnapshots", "matchEdit", "pushModal", "pushResult", "diffRows"]) assert.equal(name in C, false, name);
});

console.log(`PASS ${checks} models console checks`);
dev.db.close();
