// node --import ./test/stubs/register.mjs test/hindsight-foundations.test.mjs
// Memory Overhaul phase 2 (the design notes HS_FOUNDATIONS). Checks, with a fake Hindsight that records every call:
//  A. The two bank templates (src/hindsight-templates/): only keys of Hindsight 1.0.0's template schema, a default strategy that exists,
//     the language rule first in the retain and observations missions (and the ambient strategy mission), the "do not record restated recall" line, mental model ids and triggers, filling leaves no
//     placeholder (also with hostile values), the ambient mission is the base mission plus its extra lines.
//  B. Context strings stay under 300 characters with the longest inputs, and the speaker labels.
//  C. The client additions (applyTemplate, getConfig, listOperations, cancelOperation, cancelPending, recoverConsolidation) call exactly one
//     endpoint each, treat 404 and 409 as "nothing to cancel", and the existing exports behave as before.
//  D. Deletion order: cancelPending, then the bank delete, then a re-list that is logged when something is still queued; flag off is the plain delete.
//  E. The real Resident: hsBank creates the bank and imports the template once, imports again when the helper name, the first name or the channel
//     purpose changes, and not otherwise; the turn item carries the named labels and the named context; flag off keeps the old behavior.
//  F. Health (bankHealth, healthCron, readHealth, hsAdmin): the right signals, recovery, the dry run default, and that nothing runs with the flag off.
import assert from "node:assert/strict"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { fillTemplate, templateVars, templateKey, templateKind, speakerLabels, contextFor, hsFoundations, TEMPLATE_VERSION } from "../src/hindsight-template.js";
import { ensureBank, applyTemplate, setupBank, getConfig, listOperations, cancelOperation, cancelPending, recoverConsolidation, forgetChannel, forgetTenant, sweepBanks, bankId } from "../src/hindsight.js";
import { bankHealth, healthCron, readHealth, hsAdmin } from "../src/hindsight-health.js";
import { Resident } from "../src/resident.js"; import { RAW_CHUNK_CHARS, contactItem, taskItem } from "../src/hindsight-writers.js";

const log0 = console.log, LOGS = []; console.log = (...a) => { if (/^ {2}ok /.test(a.join(" "))) log0(...a); else LOGS.push(a.join(" ")); };
process.on("exit", (c) => { if (c) log0(LOGS.slice(-30).join("\n")); });
const ok = (name) => console.log("  ok", name);
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s });

// ---- a fake Hindsight: records "METHOD path?query" and answers from handlers ----
function fakeHs(handlers = {}) {
  const calls = [], bodies = [];
  const HINDSIGHT = { fetch: async (u, init = {}) => {
    const url = new URL(u), m = init.method || "GET", p = decodeURIComponent(url.pathname), key = `${m} ${p.replace("/v1/default/banks", "")}${url.search}`;
    calls.push(key); bodies.push(init.body ? JSON.parse(init.body) : null);
    for (const [re, fn] of Object.entries(handlers)) { const mm = key.match(new RegExp(re)); if (mm) { const r = fn(mm, init.body ? JSON.parse(init.body) : null, key); if (r) return r; } }
    return J({});
  } };
  return { HINDSIGHT, calls, bodies, env: (extra = {}) => ({ HINDSIGHT, HINDSIGHT_API_KEY: "k", MEMORY_BACKEND: "hindsight", ENV_NAME: "dev", ...extra }) };
}

// ================= A. the templates =================
const ALLOWED = new Set(["reflect_mission", "retain_mission", "retain_extraction_mode", "retain_custom_instructions", "retain_chunk_size", "retain_structured_chunk_size", "enable_observations", "observations_mission", "enable_text_search", "enable_temporal_retrieval", "enable_graph_retrieval", "enable_reranking", "disposition_skepticism", "disposition_literalism", "disposition_empathy", "entity_labels", "entities_allow_free_form", "retain_default_strategy", "retain_strategies", "retain_chunk_batch_size", "retain_max_attachments_per_chunk", "mcp_enabled_tools", "consolidation_llm_batch_size", "consolidation_source_facts_max_tokens", "consolidation_source_facts_max_tokens_per_observation", "max_observations_per_scope", "observation_scope_limits", "consolidation_strategies", "reflect_source_facts_max_tokens", "knowledge_page_default_trigger", "reflect_default_options", "mental_model_min_refresh_interval_seconds", "llm_gemini_safety_settings", "recall_budget_function", "recall_budget_fixed_low", "recall_budget_fixed_mid", "recall_budget_fixed_high", "recall_budget_adaptive_low", "recall_budget_adaptive_mid", "recall_budget_adaptive_high", "recall_budget_min", "recall_budget_max", "audit_log_enabled", "store_document_text", "enable_auto_consolidation", "consolidation_max_memories_per_round", "consolidation_llm_parallelism", "recall_include_chunks", "recall_max_tokens", "recall_chunks_max_tokens", "memory_defense"]);   // BankTemplateConfig in Hindsight 1.0.0 (GET /v1/bank-template-schema)
const MODES = ["concise", "verbose", "custom", "verbatim", "chunks"], STRATEGIES = ["chat", "note", "ambient", "file", "reference", "raw-transcript"];
{
  const V = { first: "Sam", helper: "Skipper", channel: "japan-trip", purpose: "Planning the trip to Japan in April" };
  for (const kind of ["general", "channel"]) {
    const t = fillTemplate(kind, V), txt = JSON.stringify(t);
    assert.equal(t.version, "1");
    assert.deepEqual(Object.keys(t).sort(), ["bank", "directives", "mental_models", "version"]);
    for (const k of Object.keys(t.bank)) assert.ok(ALLOWED.has(k), `${kind}: ${k} is not a template bank key in Hindsight 1.0.0`);
    assert.doesNotMatch(txt, /\{(first|helper|channel|purpose)\}/, `${kind}: a placeholder was left`);
    assert.ok(MODES.includes(t.bank.retain_extraction_mode));
    assert.deepEqual(Object.keys(t.bank.retain_strategies).sort(), [...STRATEGIES].sort());
    assert.ok(t.bank.retain_default_strategy in t.bank.retain_strategies, "the default strategy exists (a typo is silent in Hindsight)");
    for (const [n, s] of Object.entries(t.bank.retain_strategies)) assert.ok(MODES.includes(s.retain_extraction_mode), `strategy ${n} mode`);
    assert.equal(t.bank.retain_strategies.note.retain_extraction_mode, "verbatim"); assert.equal(t.bank.retain_strategies.reference.retain_extraction_mode, "chunks");
    assert.equal(t.bank.retain_strategies["raw-transcript"].retain_extraction_mode, "chunks", "the raw copy of a Bee recording makes no model call"); assert.equal(t.bank.retain_strategies["raw-transcript"].retain_chunk_size, RAW_CHUNK_CHARS, "the chunk size the meter and the estimate assume");
    // the language rule is the first sentence of the retain mission, the ambient strategy mission and the observations mission (the 2026-10-15 drift findings); the speaker, place and echo rules stay
    const m = t.bank.retain_mission;
    const RULE = "LANGUAGE RULE: write every fact in the language the user used. If the user wrote in English, every fact must be in English, never in Spanish, Russian or any other language. Never translate and never switch language. ";
    assert.ok(m.startsWith(RULE), `${kind}: retain_mission starts with the language rule`);
    assert.ok(t.bank.retain_strategies.ambient.retain_mission.startsWith(RULE), `${kind}: the ambient strategy mission starts with the language rule`);
    assert.ok(t.bank.observations_mission.startsWith("LANGUAGE RULE: write each observation in the language of the facts it is built from, and never translate. "), `${kind}: observations_mission starts with the language rule`);
    // contact and task cards use the "chat" strategy, which has no mission of its own, so Hindsight gives them the bank retain_mission (the retain traces of 2026-10-15 show the FOCUS block on contact and task calls)
    for (const it of [contactItem({ p: { id: "p1", name: "Priya", rel: "coworker" }, names: V }), taskItem({ session: "s1", title: "Main chat", created: Date.UTC(2026, 9, 15), items: [], names: V, channel: kind === "general" ? "main" : "japan-trip" })]) {
      const st = t.bank.retain_strategies[it.strategy] || {}; assert.equal(st.retain_mission, undefined, "the item's strategy does not replace the bank mission");
      assert.ok(((st.retain_mission ?? t.bank.retain_mission) || "").startsWith(RULE), `${kind}: ${it.metadata.kind} items carry the language rule`);
    }
    assert.match(m, /Lines marked Sam \(user\)/); assert.match(m, /Lines marked Skipper \(assistant\)/);
    assert.match(m, /never record something the assistant suggested as a fact about Sam/); assert.match(m, /write the place name into the fact text/);
    assert.match(m, /Do not record the assistant restating or summarizing facts it recalled from memory as new facts/);
    assert.deepEqual(t.directives.map((d) => d.name), ["Honor the person's corrections", "Attribute each fact to the right person", "Prefer the newest fact"]);
    // the ambient strategy replaces the mission, so it must hold the whole base mission plus its extra lines
    const amb = t.bank.retain_strategies.ambient.retain_mission; assert.ok(amb.startsWith(m) && amb.length > m.length && /speech recognition from a wearable/.test(amb) && /unknown speaker/.test(amb));
    assert.deepEqual(t.bank.memory_defense, { enabled: true, rules: [{ on: "sensitive_data", action: "redact" }] });
    assert.ok(!("mental_model_min_refresh_interval_seconds" in t.bank), "no bank minimum refresh interval: the models refresh on a cron"); assert.equal(t.bank.enable_observations, true);
    assert.deepEqual([t.bank.disposition_empathy, t.bank.disposition_literalism, t.bank.disposition_skepticism], [4, 3, 2]);
    for (const mm of t.mental_models) { assert.match(mm.id, /^[a-z0-9][a-z0-9-]*$/); assert.ok(mm.name && mm.source_query && mm.max_tokens >= 256 && mm.max_tokens <= 8192); assert.deepEqual(mm.trigger, { refresh_cron: "0 10,22 * * *", mode: "full" }, `${mm.id}: twice a day, never after each consolidation, no minimum interval`); }
    assert.equal(new Set(t.mental_models.map((x) => x.id)).size, t.mental_models.length); assert.equal(new Set(t.directives.map((x) => x.name)).size, t.directives.length);
  }
  const g = fillTemplate("general", V), c = fillTemplate("channel", V);
  assert.deepEqual(g.mental_models.map((x) => x.id), ["profile", "routines", "active-tasks", "people", "places"]); assert.deepEqual(c.mental_models.map((x) => x.id), ["brief", "active-tasks", "decisions"]);
  assert.match(c.bank.retain_mission, /memory of the #japan-trip channel, whose purpose is: Planning the trip to Japan in April\./);
  assert.match(g.bank.retain_mission, /long-term memory of Sam's personal assistant, Skipper, in General/);
  assert.equal(g.mental_models[0].max_tokens, 1024); assert.equal(g.mental_models[1].max_tokens, 768);
  assert.equal(templateKind("main"), "general"); assert.equal(templateKind("japan-trip"), "channel");
  // hostile values cannot add a placeholder, a line break or a brace
  const h = fillTemplate("channel", { first: "{purpose}\nSam", helper: "{first}", channel: "x{helper}", purpose: "line1\nline2 {channel} ".repeat(40) });
  assert.doesNotMatch(JSON.stringify(h), /\{(first|helper|channel|purpose)\}/); assert.ok(!/\n/.test(h.bank.retain_mission));
  assert.equal(templateVars({}).first, "the user"); assert.equal(templateVars({}).helper, "Skipper"); assert.equal(templateVars({ purpose: "" }).purpose, "not written down yet"); assert.ok(templateVars({ purpose: "x".repeat(900) }).purpose.length <= 300);
  assert.notEqual(templateKey("general", V), templateKey("general", { ...V, helper: "Ollie" })); assert.notEqual(templateKey("channel", V), templateKey("channel", { ...V, purpose: "New" })); assert.notEqual(templateKey("channel", V), templateKey("channel", { ...V, first: "Alex" }));
  assert.equal(templateKey("channel", V), templateKey("channel", { ...V })); assert.ok(templateKey("channel", V).startsWith(TEMPLATE_VERSION));
  assert.ok(hsFoundations({ HS_FOUNDATIONS: "on" }) && hsFoundations({ HS_FOUNDATIONS: "ON" }) && !hsFoundations({ HS_FOUNDATIONS: "off" }) && !hsFoundations({}) && !hsFoundations(null));
  ok("templates: only 1.0.0 template keys, valid strategies, language rule in retain, ambient and observations missions (contact and task items too), speaker/place/echo rules, ambient mission complete, filling is safe");
}

// ================= B. context strings and labels =================
{
  const long = { first: "F".repeat(90), helper: "H".repeat(90), channel: "c".repeat(90), section: "s".repeat(90), file: "f".repeat(300), address: "a".repeat(300), summary: "z".repeat(900) };
  // No length limit (Captain 2026-10-14): long names and fields arrive whole.
  for (const k of ["chat", "note", "helper-note", "live", "bee"]) assert.ok(contextFor(k, long).includes("F".repeat(90)), `${k}: the name is kept whole`);
  assert.ok(contextFor("file", long).includes("f".repeat(300)) && contextFor("bee", long).includes("a".repeat(300)) && contextFor("bee", long).includes("z".repeat(900)) && contextFor("chat", long).includes("F".repeat(90)), "nothing is cut");
  const n = { first: "Sam", helper: "Skipper", channel: "main" };
  assert.equal(contextFor("chat", n), "1Helm chat in #main between Sam (the user) and Skipper (the user's AI assistant). The user's lines are the user's own words and facts about the user. The assistant's lines are what the assistant said or did. Each entry may name its message origin. Keep the stated origin with facts from that entry so app messages, phone texts, voice messages and poll votes remain distinguishable. A phone service is known only when the entry names it. Do not apply one entry's origin to another entry, and do not infer successful phone delivery from an assistant reply.");
  assert.equal(contextFor("scheduled", n), "Scheduled run of a Skipper workflow in #main. These lines are the assistant's own work, not the user's words.");
  assert.match(contextFor("note", { ...n, section: "about" }), /^A note Sam wrote in their 1Helm Notebook, in the about section\. It is Sam's own statement\.$/);
  assert.match(contextFor("helper-note", { ...n, section: "about" }), /^A note Skipper saved about Sam/); assert.match(contextFor("file", { ...n, file: "menu.pdf" }), /^A file in Sam's 1Helm Library: menu\.pdf\.$/);
  assert.match(contextFor("live", n), /wearer is Sam\. Unknown speakers are other people, never Sam\./); assert.match(contextFor("bee", { ...n, address: "12 Main St", summary: "Lunch" }), /at 12 Main St\. The wearer is Sam\..*Summary: Lunch/);
  assert.throws(() => contextFor("nope", n));
  assert.deepEqual(speakerLabels(n), { user: "Sam (user)", assistant: "Skipper (assistant)", notes: "Skipper (assistant notes)", scheduled: "Scheduled run prompt" });
  assert.equal(speakerLabels({}).user, "User"); assert.equal(speakerLabels({}).assistant, "Skipper (assistant)");
  ok("context strings: exact text, 300 characters at most with the longest inputs; named speaker labels with fallbacks");
}

// ================= C. client additions =================
{
  const f = fakeHs({ "^GET /b1/operations\\?limit=100&offset=0&status=pending": () => J({ operations: [{ id: "p1", task_type: "retain" }, { id: "p2", task_type: "consolidation" }] }),
    "^GET /b1/operations\\?limit=100&offset=0&status=processing": () => J({ operations: [{ id: "q1", task_type: "retain" }] }),
    "^DELETE /b1/operations/p2": () => J({ detail: "done already" }, 409), "^DELETE /b1/operations/q1": () => J({ detail: "gone" }, 404),
    "^POST /b1/consolidation/recover": () => J({ retried_count: 3 }), "^POST /b2/consolidation/recover": () => J({ retried_count: 0 }) });
  const env = f.env(), man = { version: "1", bank: { retain_mission: "x" } };
  await applyTemplate(env, "b1", man, { dryRun: true }); await applyTemplate(env, "b1", man);
  assert.deepEqual(f.calls.slice(0, 2), ["POST /b1/import?dry_run=true", "POST /b1/import"]); assert.deepEqual(f.bodies[1], man);
  f.calls.length = 0; await getConfig(env, "b1"); assert.deepEqual(f.calls, ["GET /b1/config"]);
  f.calls.length = 0; await listOperations(env, "b1", { status: "failed", type: "retain", limit: 5, offset: 10 }); assert.deepEqual(f.calls, ["GET /b1/operations?limit=5&offset=10&status=failed&type=retain"]);
  f.calls.length = 0; assert.equal(await cancelOperation(env, "b1", "p2"), null, "409 = already finished"); assert.equal(await cancelOperation(env, "b1", "q1"), null, "404 = gone");
  f.calls.length = 0; const got = await cancelPending(env, "b1");
  assert.deepEqual(got, ["p1"], "only the operation that was really cancelled is reported");
  assert.deepEqual(f.calls, ["GET /b1/operations?limit=100&offset=0&status=pending", "DELETE /b1/operations/p1", "DELETE /b1/operations/p2", "GET /b1/operations?limit=100&offset=0&status=processing", "DELETE /b1/operations/q1"]);
  const missing = fakeHs({ "operations": () => J({ detail: "no bank" }, 404) }); assert.deepEqual(await cancelPending(missing.env(), "nobank"), [], "a missing bank has nothing queued");
  f.calls.length = 0; assert.deepEqual(await recoverConsolidation(env, "b1"), { retried: 3 }); assert.deepEqual(f.calls, ["POST /b1/consolidation/recover", "POST /b1/consolidate"]);
  f.calls.length = 0; assert.deepEqual(await recoverConsolidation(env, "b2"), { retried: 0 }); assert.deepEqual(f.calls, ["POST /b2/consolidation/recover"], "no consolidation when nothing failed");
  f.calls.length = 0; await setupBank(env, "b3", man); assert.deepEqual(f.calls, ["PUT /b3", "POST /b3/import"], "bank first, then its template");
  f.calls.length = 0; await ensureBank(env, "b4"); assert.deepEqual(f.calls, ["PUT /b4"], "ensureBank is unchanged");
  assert.equal(bankId({ ENV_NAME: "dev" }, "t", "main"), "dev-t-main");
  ok("client: one endpoint each, 404 and 409 mean nothing to cancel, recover then consolidate only when facts were retried, existing exports unchanged");
}

// ================= D. deletion order =================
{
  const ops = { pending: [{ id: "a1", task_type: "retain" }], processing: [] }; let gone = false, stillQueued = false;
  const f = fakeHs({ "^GET /([^/?]+)/operations\\?limit=100&offset=0&status=(pending|processing)": (m) => { if (gone && !stillQueued) return J({ detail: "no bank" }, 404); return J({ operations: gone ? [{ id: "late", task_type: "retain", status: m[2] }] : ops[m[2]] }); },
    "^DELETE /([^/?]+)$": () => { gone = true; return J({}); }, "^GET \\?limit=100&offset=0&q=dev-t1-": () => J({ banks: [{ bank_id: "dev-t1-main" }, { bank_id: "dev-t1-trip" }], total: 2 }) });
  const on = f.env({ HS_FOUNDATIONS: "on" });
  assert.deepEqual(await forgetChannel(on, "t1", "main"), { deleted: 1 });
  const i = (s) => f.calls.findIndex((c) => c.startsWith(s));
  assert.ok(i("GET /dev-t1-main/operations") < i("DELETE /dev-t1-main/operations/a1") && i("DELETE /dev-t1-main/operations/a1") < f.calls.indexOf("DELETE /dev-t1-main"), "cancel before the bank delete");
  assert.ok(f.calls.lastIndexOf("GET /dev-t1-main/operations?limit=100&offset=0&status=pending") > f.calls.indexOf("DELETE /dev-t1-main"), "re-listed after the delete");
  // something still queued after the delete is logged and counted
  gone = false; stillQueued = false; f.calls.length = 0; LOGS.length = 0; stillQueued = true;
  const r = await forgetChannel(on, "t1", "main"); assert.equal(r.deleted, 1); assert.equal(r.queued, 2, "pending and processing rows both counted");
  assert.ok(LOGS.some((l) => /operations still queued after bank delete/.test(l)), "logged");
  // the whole account
  gone = false; stillQueued = false; f.calls.length = 0; const t = await forgetTenant(on, "t1"); assert.equal(t.deleted, 2);
  assert.ok(f.calls.filter((c) => /^DELETE \/dev-t1-(main|trip)$/.test(c)).length === 2); assert.ok(f.calls.some((c) => c.startsWith("GET /dev-t1-trip/operations")), "every bank is cancelled first");
  // flag off: the plain delete, no operations calls at all
  gone = false; const off = fakeHs({ "^DELETE /dev-t1-main$": () => J({}) }); assert.deepEqual(await forgetChannel(off.env(), "t1", "main"), { deleted: 1 }); assert.deepEqual(off.calls, ["DELETE /dev-t1-main"]);
  // a failing operations call never blocks the delete
  const bad = fakeHs({ "operations": () => J({ detail: "boom" }, 500), "^DELETE /dev-t1-main$": () => J({}) }); assert.equal((await forgetChannel(bad.env({ HS_FOUNDATIONS: "on" }), "t1", "main")).deleted, 1); assert.ok(bad.calls.includes("DELETE /dev-t1-main"));
  // a bank that is already gone is still a 404 = 0
  const nb = fakeHs({ "^DELETE /dev-t1-main$": () => J({ detail: "none" }, 404), "operations": () => J({ detail: "none" }, 404) }); assert.deepEqual(await forgetChannel(nb.env({ HS_FOUNDATIONS: "on" }), "t1", "main"), { deleted: 0 });
  // the nightly sweep cancels before it deletes too
  const tid = "11111111-1111-4111-8111-111111111111", sbank = `dev-${tid}-gone`, sf = fakeHs({ "^GET \\?limit=100&offset=0&q=dev-": () => J({ banks: [{ bank_id: sbank, created_at: "2020-01-01T00:00:00Z" }], total: 1 }), "operations": () => J({ operations: [{ id: "s1", task_type: "retain" }] }), "^DELETE /[^/]+$": () => J({}) });
  const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ id: tid }] }) }) }) };
  const sw = await sweepBanks({ ...sf.env({ HS_FOUNDATIONS: "on" }), DB: db }, { channelsOf: async () => [{ slug: "main" }] });
  assert.equal(sw.deleted, 1); assert.ok(sf.calls.indexOf(`DELETE /${sbank}/operations/s1`) >= 0 && sf.calls.indexOf(`DELETE /${sbank}/operations/s1`) < sf.calls.indexOf(`DELETE /${sbank}`), "sweep: cancel, then delete");
  ok("deletion: cancelPending before forgetChannel, forgetTenant and sweepBanks delete; re-list after; leftovers logged; flag off is the plain delete; errors never block");
}

// ================= E. the real Resident: hsBank, labels, context =================
{
  const d1 = new DatabaseSync(":memory:");
  d1.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, helper_name TEXT, first_name TEXT); INSERT INTO tenants VALUES ('t1','ck1','Ollie','Sam');");
  const DB = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return o; } };
  const mk = (flag) => {
    const f = fakeHs(), dodb = new DatabaseSync(":memory:");
    const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
      a = a.map((x) => x instanceof ArrayBuffer ? new Uint8Array(x) : x); const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
    const ctx = { storage: { sql, getAlarm: async () => null, setAlarm: async () => {} }, waitUntil: () => {} };
    const env = f.env({ DB, MEMORY: "on", GENUI: "off", WORKMEM: "off", GATEWAY_HOST: "selfhost.example", APP_HOST: "selfhost.example", ...(flag ? { HS_FOUNDATIONS: "on" } : {}),
      AI: { run: async (_m, b) => ({ data: (b.text || []).map(() => new Array(8).fill(0.1)) }) } });
    const R = new Resident(ctx, env); R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1");
    let purpose = "Everyday help"; R.archive = () => ({ channels: async () => [{ id: 1, slug: "main", name: "General", purpose }] });
    return { R, f, setPurpose: (p) => { purpose = p; } };
  };
  const imports = (f) => f.calls.filter((c) => c.endsWith("/import")).length;
  const on = mk(true);
  assert.equal(await on.R.hsBank(), "dev-t1-main");
  assert.deepEqual(on.f.calls, ["PUT /dev-t1-main", "GET /dev-t1-main/mental-models?detail=content&limit=100", "POST /dev-t1-main/import"], "created, its triggers checked (a new bank has no models), then the template imported");
  const body = on.f.bodies[2]; assert.match(body.bank.retain_mission, /Sam's personal assistant, Ollie, in General/); assert.deepEqual(body.mental_models.map((m) => m.id), ["profile", "routines", "active-tasks", "people", "places"]);
  assert.ok(on.R.get("hs_tpl").startsWith(`${TEMPLATE_VERSION}|general|Sam|Ollie|main|`), "the template key is recorded next to hs_bank");
  await on.R.hsBank(); await on.R.hsBank(); assert.equal(imports(on.f), 1, "nothing changed, so no second import");
  d1.exec("UPDATE tenants SET helper_name='Marlo'"); on.R._hsNames = null; await on.R.hsBank();
  assert.equal(imports(on.f), 2, "helper renamed, so imported again"); assert.match(on.f.bodies.at(-1).bank.retain_mission, /Marlo \(assistant\)/); assert.equal(on.f.calls.filter((c) => c === "PUT /dev-t1-main").length, 1, "the bank is not created twice");
  d1.exec("UPDATE tenants SET first_name='Alex'"); on.R._hsNames = null; await on.R.hsBank(); assert.equal(imports(on.f), 3, "first name changed");
  on.setPurpose("Meals and the weekly shop"); on.R._hsNames = null; await on.R.hsBank(); assert.equal(imports(on.f), 4, "purpose changed");
  on.R._hsNames = null; await on.R.hsBank(); assert.equal(imports(on.f), 4, "same values again: no import");
  d1.exec("UPDATE tenants SET helper_name='Ollie', first_name='Sam'");
  // the speaker labels and context come from the names
  on.R._hsNames = null; await on.R.hsNames();
  assert.equal(speakerLabels(on.R._hsNames).user, "Sam (user)"); { const c = contextFor("chat", { first: "Sam", helper: "Ollie", channel: "main" }); assert.match(c, /^1Helm chat in #main between Sam \(the user\) and Ollie \(the user's AI assistant\)/); assert.ok(c.length <= 700, `chat context stays one short paragraph (${c.length}; Hindsight 1.0 sets no limit, message origin wording added in 3a0efaa)`); }
  // a failed import never blocks the retain and is retried later
  const fail = mk(true); fail.f.HINDSIGHT.fetch = async (u, init = {}) => { fail.f.calls.push(`${init.method || "GET"} ${new URL(u).pathname}`); return String(u).endsWith("/import") ? J({ detail: "bad" }, 400) : J({}); };
  assert.equal(await fail.R.hsBank(), "dev-t1-main"); assert.equal(fail.R.get("hs_bank"), "dev-t1-main"); assert.equal(fail.R.get("hs_tpl"), undefined, "no key recorded, so it is tried again");
  const n = fail.f.calls.length; await fail.R.hsBank(); assert.equal(fail.f.calls.length, n, "not retried for 5 minutes");
  // flag off: the old plain bank and the old labels
  const off = mk(false); await off.R.hsBank(); assert.deepEqual(off.f.calls, ["PUT /dev-t1-main"]); assert.equal(off.R.get("hs_tpl"), undefined);
  ok("Resident: bank created and template imported once; imported again on a helper, first name or purpose change; named labels and context; failures retried later; flag off unchanged");
}

// ================= F. health and admin =================
{
  const stats = (o = {}) => J({ total_nodes: 10, total_documents: 4, total_observations: 2, pending_operations: 0, failed_operations: 0, pending_consolidation: 0, failed_consolidation: 0, last_consolidated_at: "2026-10-14T00:00:00Z", ...o });
  const models = (items) => J({ items });
  const f = fakeHs({
    "^GET /bad/stats": () => stats({ failed_consolidation: 7, failed_operations: 1 }), "^GET /bad/operations\\?limit=5&offset=0&status=failed": () => J({ operations: [{ id: "o1", task_type: "retain", error_message: "x".repeat(400) }] }),
    "^GET /bad/mental-models": () => models([{ id: "profile", last_refreshed_at: "2026-10-10T00:00:00Z", last_refresh_failed_at: "2026-10-11T00:00:00Z" }, { id: "routines", last_refreshed_at: "2026-10-12T00:00:00Z", last_refresh_failed_at: "2026-10-11T00:00:00Z" }]),
    "^GET /bad/documents": () => J({ items: [{ memory_unit_count: 0, text_length: 900 }, { memory_unit_count: 0, text_length: 90 }, { memory_unit_count: 3, text_length: 2000 }] }),
    "^POST /bad/consolidation/recover": () => J({ retried_count: 7 }),
    "^GET /good/stats": () => stats(), "^GET /good/mental-models": () => models([{ id: "profile", last_refreshed_at: "2026-10-10T00:00:00Z", last_refresh_failed_at: null }]), "^GET /good/documents": () => J({ items: [] }) });
  const env = f.env({ HS_FOUNDATIONS: "on" });
  // the operations table says nothing failed; failed_consolidation is the signal (BASELINE.md 2.5)
  const readonly = await bankHealth(env, "bad");
  assert.deepEqual(readonly.problems.sort(), ["failed_consolidation", "failed_operations", "mental_model_refresh_failed"]); assert.deepEqual(readonly.failedModels, ["profile"], "only a refresh that failed after the last good one");
  assert.equal(readonly.zeroFactDocs, 1); assert.equal(readonly.failedOps[0].error.length, 160); assert.deepEqual(readonly.actions, []); assert.ok(!f.calls.some((c) => c.startsWith("POST")), "read only without fix");
  assert.ok(f.calls.includes("GET /bad/stats?refresh=true"), "fresh stats, not the 60 second cache");
  const fixed = await bankHealth(env, "bad", { fix: true });
  assert.deepEqual(fixed.actions, [{ recoverConsolidation: 7 }, { refresh: "profile" }]); assert.ok(f.calls.includes("POST /bad/consolidate") && f.calls.includes("POST /bad/mental-models/profile/refresh"));
  assert.deepEqual((await bankHealth(env, "good", { fix: true })).problems, []);
  // the daily cron: only banks not checked in 23 hours, oldest first, at most max; results saved and readable
  const d1 = new DatabaseSync(":memory:"); d1.exec(readFileSync(new URL("../db/migrations/0051_hs_health.sql", import.meta.url), "utf8"));
  const DB = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return o; } };
  const now = Date.parse("2026-10-14T11:17:00Z");
  d1.prepare("INSERT INTO hs_health (bank, checked_at) VALUES (?,?)").run("dev-fresh", now - 3600e3); d1.prepare("INSERT INTO hs_health (bank, checked_at) VALUES (?,?)").run("dev-old", now - 30 * 3600e3);
  const f2 = fakeHs({ "^GET \\?limit=100&offset=0&q=dev-": () => J({ banks: ["dev-fresh", "dev-old", "dev-new", "live-x"].map((b) => ({ bank_id: b })), total: 4 }), "^GET /dev-[a-z]+/stats": () => stats({ failed_consolidation: 0 }), "^GET /dev-[a-z]+/mental-models": () => models([]), "^GET /dev-[a-z]+/documents": () => J({ items: [] }),
    "llm-requests/stats": () => J({ buckets: [{ statuses: { success: 5, error: 2 } }, { statuses: { success: 1 } }] }) });
  const cr = await healthCron({ ...f2.env({ HS_FOUNDATIONS: "on" }), DB }, { now });
  assert.deepEqual([cr.banks, cr.checked, cr.problems, cr.errors, cr.trace], [3, 2, 0, 0, { success: 6, error: 2 }], "live banks and fresh checks skipped; the model trace is summed");
  assert.ok(!f2.calls.some((c) => c.includes("dev-fresh/") || c.includes("live-x/")));
  const rd = await readHealth({ DB }); assert.equal(rd.checked, 3); assert.equal(rd.with_problems, 0);
  const cr2 = await healthCron({ ...f.env({ HS_FOUNDATIONS: "on" }), DB, ENV_NAME: "dev" }, { now: now + 1 }); assert.equal(cr2.checked, 0, "all checked within 23 hours, nothing to do");
  // a problem bank is saved, recovered and shown by the ops read, in short bank form
  const f3 = fakeHs({ "^GET \\?limit=100&offset=0&q=dev-": () => J({ banks: [{ bank_id: "dev-aaaaaaaa-0000-4000-8000-000000000000-main" }], total: 1 }), "^GET /dev-[^/]+/stats": () => stats({ failed_consolidation: 2 }), "^GET /dev-[^/]+/mental-models": () => models([]), "^GET /dev-[^/]+/documents": () => J({ items: [] }),
    "^POST /dev-[^/]+/consolidation/recover": () => J({ retried_count: 2 }) });
  const d2 = new DatabaseSync(":memory:"); d2.exec(readFileSync(new URL("../db/migrations/0051_hs_health.sql", import.meta.url), "utf8"));
  const DB2 = { prepare: (q) => { const st = d2.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return o; } };
  const c3 = await healthCron({ ...f3.env({ HS_FOUNDATIONS: "on" }), DB: DB2 }, { now }); assert.deepEqual([c3.checked, c3.problems, c3.recovered], [1, 1, 1]);
  const r3 = await readHealth({ DB: DB2 }, { onlyProblems: true }); assert.equal(r3.failed_consolidation_facts, 2); assert.deepEqual(r3.by_problem, { failed_consolidation: 1 }); assert.deepEqual(r3.banks[0].actions, [{ recoverConsolidation: 2 }]);
  assert.ok(!JSON.stringify(r3).includes("aaaaaaaa-0000"), "the tenant id is not in the ops answer"); assert.ok(r3.banks[0].bank.length < 16);
  // flag off: nothing runs
  const f4 = fakeHs(); assert.deepEqual(await healthCron({ ...f4.env(), DB }, { now }), { skipped: "HS_FOUNDATIONS off" }); assert.deepEqual(f4.calls, []);
  assert.deepEqual(await hsAdmin(f4.env(), "templates"), { error: "HS_FOUNDATIONS is off" });
  ok("health: failed_consolidation, failed operations, failed refresh and zero fact documents are the signals; recovery runs once; results saved, readable, short bank ids; flag off runs nothing");

  // the admin path: dry run is the default and never imports; the real run imports and recovers
  const t1 = "22222222-2222-4222-8222-222222222222", t2 = "33333333-3333-4333-8333-333333333333", gone = "44444444-4444-4444-8444-444444444444";
  const ids = [`dev-${t1}-main`, `dev-${t1}-trip`, `dev-${t1}-empty`, `dev-${t2}-main`, `dev-${gone}-main`];
  const seen = { dry: [], real: [] };
  const f5 = fakeHs({ "^GET \\?limit=100&offset=0&q=dev-": () => J({ banks: ids.map((b) => ({ bank_id: b })), total: ids.length }),
    "^GET /[^/]+/stats": (m, b, key) => key.includes("empty") ? stats({ total_nodes: 0, total_documents: 0 }) : stats({ failed_consolidation: key.includes(t2) ? 4 : 0 }),
    "/import\\?dry_run=true": (m, b, key) => { seen.dry.push(key); return J({ mental_models_created: b.mental_models.map((x) => x.id), dry_run: true }); },
    "^POST /[^/]+/import$": (m, b, key) => { seen.real.push([key, b]); return J({ mental_models_created: ["profile"], mental_models_updated: [], operation_ids: ["x"] }); },
    "^POST /[^/]+/consolidation/recover": () => J({ retried_count: 4 }) });
  const row = { [t1]: { first_name: "Sam", helper_name: "Ollie" }, [t2]: { first_name: "Dee", helper_name: "" } };
  const DB5 = { prepare: (q) => ({ bind: (...a) => ({ first: async () => /FROM tenants WHERE slug/.test(q) ? { id: t1 } : row[a[0]] || null, all: async () => ({ results: [] }), run: async () => ({}) }) }) };
  const env5 = { ...f5.env({ HS_FOUNDATIONS: "on" }), DB: DB5 }, archive = (_e, tid) => ({ channels: async () => tid === t1 ? [{ slug: "main", purpose: "Hi" }, { slug: "trip", purpose: "Japan" }, { slug: "empty", purpose: "" }] : [{ slug: "main" }] });
  const dry = await hsAdmin(env5, "templates", { archive });
  assert.equal(dry.dry, true); assert.equal(dry.total, 5); assert.deepEqual(dry.counts, { "would import": 3, "skipped empty": 1, "skipped: no account": 1 }); assert.equal(seen.real.length, 0, "a dry run imports nothing"); assert.equal(seen.dry.length, 3);
  assert.ok(!f5.calls.some((c) => /^PUT /.test(c)), "a dry run creates nothing"); assert.ok(dry.results.every((r) => !JSON.stringify(r).includes(t1)), "short bank ids only");
  const real = await hsAdmin(env5, "templates", { archive, dry: false });
  assert.deepEqual(real.counts, { imported: 3, "skipped empty": 1, "skipped: no account": 1 }); assert.equal(seen.real.length, 3);
  const tripBody = seen.real.find(([k]) => k.includes("trip"))[1]; assert.match(tripBody.bank.retain_mission, /memory of the #trip channel, whose purpose is: Japan/); assert.deepEqual(tripBody.mental_models.map((m) => m.id), ["brief", "active-tasks", "decisions"]);
  assert.match(seen.real.find(([k]) => k.includes(t2))[1].bank.retain_mission, /Dee's personal assistant, Skipper/, "an empty helper name falls back to the default");
  const incl = await hsAdmin(env5, "templates", { archive, dry: false, skipEmpty: false, slug: "ck1" }); assert.equal(incl.total, 3); assert.equal(incl.counts.imported, 3);
  const page = await hsAdmin(env5, "templates", { archive, limit: 2 }); assert.equal(page.processed, 2); assert.equal(page.next_offset, 2); assert.equal((await hsAdmin(env5, "templates", { archive, limit: 2, offset: 4 })).next_offset, null);
  f5.calls.length = 0; const rd5 = await hsAdmin(env5, "recover", { archive }); assert.equal(rd5.counts["would recover"], 1); assert.ok(!f5.calls.some((c) => c.includes("recover")), "recover dry run changes nothing");
  const rr = await hsAdmin(env5, "recover", { archive, dry: false }); assert.equal(rr.counts.recovered, 1); assert.ok(f5.calls.includes(`POST /dev-${t2}-main/consolidation/recover`) && f5.calls.includes(`POST /dev-${t2}-main/consolidate`));
  assert.deepEqual(await hsAdmin(env5, "nope", { archive }), { error: "action must be templates, recover or triggers" });
  ok("admin path: dry run is the default and imports nothing; real run imports the right template per bank, skips empty banks and gone accounts, pages, recovers failed consolidation");
}
