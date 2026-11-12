// node --import ./test/stubs/register.mjs test/models-privacy.test.mjs
// Search lists models whatever their privacy terms; the privacy level decides where each is offered and used. Fetch is mocked.
import assert from "node:assert/strict";
import { modelCatalog, taskModelCatalog, validCatalogRecord } from "../src/ee/model-catalog.js";
import { configuredHosts, zdrBlocked } from "../src/ee/model-jobs.js";
import { enforceRequest, hostTerms, eligibleHosts } from "../src/privacy.js";
import { maxPriceFor, poolPayload, taskPayload } from "../src/model.js";

const model = (id, extra = {}) => ({ supported_parameters: ["tools", "max_tokens"], top_provider: { max_completion_tokens: 4096 }, id, name: `Name ${id}`, created: 1, context_length: 16384, architecture: { input_modalities: ["text"], output_modalities: ["text"] }, reasoning: null, pricing: { prompt: "0.000001", completion: "0.000002" }, ...extra });
const endpoint = (model_id, tag, extra = {}) => ({ model_id, tag, status: 0, context_length: 16384, max_completion_tokens: 4096, pricing: { prompt: "0.000001", completion: "0.000002" },
  supported_parameters: ["tools", "max_tokens", "response_format"], supports_tool_choice: { auto: true, none: true, required: true, function: true }, ...extra });
const WONDER = "meta/muse-wonder", FUTURE = "meta/muse-future", CONTRIB = "meta/muse-future-contributor", UNKNOWN = "newlab/model-x", PROVEN = "example/zdr-model", MIXED = "example/mixed";
const dear = { pricing: { prompt: "0.000004", completion: "0.00002" } };
const list = [model(WONDER, dear), model(FUTURE), model(CONTRIB), model(UNKNOWN), model(PROVEN), model(MIXED)];
const zdr = [endpoint(PROVEN, "safe-host"), endpoint(MIXED, "safe-host")];
const own = { [WONDER]: [endpoint(WONDER, "meta", dear)], [FUTURE]: [endpoint(FUTURE, "meta")], [CONTRIB]: [endpoint(CONTRIB, "meta")], [UNKNOWN]: [endpoint(UNKNOWN, "newhost")],
  [PROVEN]: [endpoint(PROVEN, "safe-host")], [MIXED]: [endpoint(MIXED, "safe-host"), endpoint(MIXED, "other-host")] };
const urls = [], originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = new URL(String(url)); assert.equal(u.hostname, "openrouter.ai"); urls.push(String(url));
  if (u.pathname === "/api/v1/models") return Response.json({ data: list });
  if (u.pathname === "/api/v1/endpoints/zdr") return Response.json({ data: zdr });
  if (u.pathname === "/api/v1/embeddings/models") return Response.json({ data: [] });
  const m = u.pathname.match(/^\/api\/v1\/models\/(.+)\/endpoints$/); if (m && m[1] in own && !own[m[1]]) return new Response('x', { status: 503 }); if (m && own[m[1]]) return Response.json({ data: { endpoints: own[m[1]] } });
  if (m) return Response.json({ data: { endpoints: [] } });
  assert.fail(`Unexpected URL ${url}`);
};
const env = {}, find = (r, id) => r.models.find((m) => m.id === id);
try {
  // Per-provider terms apply to a model that is on no list and registered nowhere, including one released after today.
  assert.deepEqual(hostTerms(WONDER, "meta"), { zdr: false, training: false });
  assert.deepEqual(hostTerms(FUTURE, "meta"), { zdr: false, training: false });
  assert.equal(hostTerms(CONTRIB, "meta"), null, "a Contributor model is not covered by the provider's terms");
  assert.equal(hostTerms(UNKNOWN, "newhost"), null);
  assert.deepEqual(eligibleHosts("meta/muse-spark-1.3-contributor", "unrestricted"), ["meta"], "per-model entries still work");

  // Search lists every match whatever its terms, and says where it can be used.
  const r = await modelCatalog(env, { q: "m" });
  const w = find(r, WONDER); assert.equal(w.eligible, true); assert.deepEqual(w.hosts, ["meta"]); assert.deepEqual(w.levels, ["unrestricted", "no_training"]);
  assert.deepEqual(w.terms, { zdr: false, no_training: true }); assert.equal(w.pricing.prompt, 4, "price is shown, never a reason to hide");
  assert.deepEqual(find(r, FUTURE).levels, ["unrestricted", "no_training"]);
  assert.deepEqual(find(r, CONTRIB).levels, ["unrestricted"], "unknown terms: Unrestricted only");
  const u = find(r, UNKNOWN); assert.equal(u.eligible, true); assert.deepEqual(u.levels, ["unrestricted"]); assert.deepEqual(u.unproven_hosts, ["newhost"]); assert.deepEqual(u.terms, { zdr: false, no_training: false });
  assert.deepEqual(find(r, PROVEN).levels, ["unrestricted", "no_training", "zdr"], "the published ZDR list proves every level");
  const mixed = find(r, MIXED); assert.deepEqual(mixed.unproven_hosts, ["other-host"]); assert.deepEqual(mixed.levels, ["unrestricted", "no_training", "zdr"]);

  // An empty search reads no per-model lists. A model not checked yet is still listed, for Unrestricted only, never ZDR or No Training.
  urls.length = 0; const empty = await modelCatalog(env); assert.ok(!urls.some((x) => x.includes(`/models/${WONDER}/`)));
  const ew = find(empty, WONDER); assert.equal(ew.eligible, true); assert.equal(ew.unverified, true); assert.deepEqual(ew.levels, ["unrestricted"]); assert.deepEqual(ew.hosts, []); assert.equal(ew.pricing.prompt, 4);
  assert.equal(find(empty, PROVEN).eligible, true); assert.equal(find(empty, PROVEN).unverified, undefined);
  assert.equal(validCatalogRecord(ew, WONDER), false, "an unverified record can never be saved or used");
  // Saving it reads its endpoints by ID and saves the verified record. If they can't be read, nothing is saved.
  const saved = find(await modelCatalog(env, { q: WONDER }), WONDER); assert.equal(saved.unverified, undefined); assert.deepEqual(saved.hosts, ["meta"]);
  own[UNKNOWN] = null; const failed = find(await modelCatalog(env, { q: UNKNOWN }), UNKNOWN); assert.equal(failed.unverified, true, "still unverified when the read fails, and model-settings refuses to save it");
  own[UNKNOWN] = [endpoint(UNKNOWN, "newhost")];

  // The level decides which providers a saved model may use. Unknown terms never reach ZDR or No Training.
  const cat = { [WONDER]: w, [UNKNOWN]: u, [MIXED]: mixed, [PROVEN]: find(r, PROVEN) };
  const hosts = (id, l) => configuredHosts({ catalog: cat }, id, l);
  assert.deepEqual(hosts(WONDER, "unrestricted"), ["meta"]); assert.deepEqual(hosts(WONDER, "no_training"), ["meta"]); assert.deepEqual(hosts(WONDER, "zdr"), []);
  assert.deepEqual(hosts(UNKNOWN, "unrestricted"), ["newhost"]); assert.deepEqual(hosts(UNKNOWN, "no_training"), []); assert.deepEqual(hosts(UNKNOWN, "zdr"), []);
  assert.deepEqual(hosts(MIXED, "zdr"), ["safe-host"]); assert.deepEqual(hosts(MIXED, "unrestricted"), ["safe-host", "other-host"]);
  assert.deepEqual(hosts(PROVEN, "zdr"), ["safe-host"]);
  const legacy = { ...find(r, PROVEN) }; delete legacy.unproven_hosts; assert.deepEqual(configuredHosts({ catalog: { [PROVEN]: legacy } }, PROVEN, "zdr"), ["safe-host"], "a record saved before this change keeps its hosts");
  assert.equal(zdrBlocked({ catalog: cat }, WONDER), true); assert.equal(zdrBlocked({ catalog: cat }, UNKNOWN), true); assert.equal(zdrBlocked({ catalog: cat }, PROVEN), false);
  for (const m of [w, u, find(r, PROVEN)]) assert.equal(validCatalogRecord(m, m.id), true, m.id);

  // Dispatch: the level sets OpenRouter's own fields, no host list is kept, and a stricter request is never weakened.
  const req = (model, only, extra = {}) => ({ model, messages: [], provider: { only, ...extra } });
  let p = enforceRequest(req(WONDER, ["meta"]), "unrestricted").provider; assert.equal(p.only, undefined); assert.equal(p.data_collection, "allow"); assert.equal(p.zdr, undefined);
  p = enforceRequest(req(WONDER, ["meta"]), "no_training").provider; assert.equal(p.data_collection, "deny"); assert.equal(p.zdr, undefined);
  p = enforceRequest(req(WONDER, ["meta"]), "zdr").provider; assert.equal(p.zdr, true); assert.equal(p.data_collection, "deny"); // the strict filter: OpenRouter finds no ZDR endpoint
  p = enforceRequest(req(UNKNOWN, ["newhost"]), "unrestricted").provider; assert.equal(p.data_collection, "allow"); assert.equal(p.zdr, undefined);
  p = enforceRequest(req(UNKNOWN, ["newhost"]), "no_training").provider; assert.equal(p.zdr, undefined); assert.equal(p.data_collection, "deny");
  p = enforceRequest(req(UNKNOWN, ["newhost"]), "zdr").provider; assert.equal(p.zdr, true); assert.equal(p.data_collection, "deny");
  p = enforceRequest(req(UNKNOWN, ["newhost"], { zdr: true }), "unrestricted").provider; assert.equal(p.zdr, true, "a caller that asked for zdr keeps it");
  p = enforceRequest({ model: UNKNOWN, messages: [] }, "unrestricted").provider; assert.equal(p.data_collection, "allow", "the level alone decides");
  p = enforceRequest(req(CONTRIB, ["meta"]), "no_training").provider; assert.equal(p.data_collection, "deny");   // OpenRouter finds the endpoints that don't train

  // A task reads the model's own endpoints when it isn't on the ZDR list.
  const t = await taskModelCatalog(WONDER, null, env); assert.deepEqual(t.hosts, ["meta"]); assert.deepEqual(t.levels, ["unrestricted", "no_training"]);
  assert.deepEqual((await taskModelCatalog(UNKNOWN, null, env)).unproven_hosts, ["newhost"]);

  // Price: the ceiling sent to OpenRouter follows the model's own price when it is above $3 / $15, and is otherwise unchanged.
  assert.deepEqual(maxPriceFor(w), { prompt: 4, completion: 20 }); assert.deepEqual(maxPriceFor(find(r, PROVEN)), { prompt: 3, completion: 15 });
  assert.deepEqual(poolPayload({ MODEL_SETTINGS: { catalog: cat } }, WONDER, "unrestricted", { messages: [] }, null).provider.max_price, { prompt: 4, completion: 20 });
  console.log("PASS models-privacy: per-provider terms, non-ZDR search results, level filtering, strict enforcement, price");
} finally { globalThis.fetch = originalFetch; }
