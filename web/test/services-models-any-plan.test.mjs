// node test/services-models-any-plan.test.mjs: the Models editor in Settings → AI services on a full plan. Choosing models is optional and
// available as soon as a service is connected, on every plan: the editor asks the server for ?scope=services (Advanced asks with no scope and keeps 1Helm's models), shows no "choose a
// model" warning on a full plan, and a save reads the plan option again (the server turns Use my services now on). The option is first in the list and needs General's model.
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "svcany-")), out = join(dir, "bundle.mjs"), entry = join(dir, "entry.ts");
writeFileSync(entry, `export * from ${JSON.stringify(here("../src/ee/byok-billing.ts"))};\nexport { cmodelsInit, cmodelsCard, cmodelsOwnPanel, cmodelsRefresh } from ${JSON.stringify(here("../src/ee/custom-models.ts"))};\n`);
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "warning" });
globalThis.document = { addEventListener() {}, activeElement: null, querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; }, createElement() { return { setAttribute() {}, classList: { add() {} } }; }, body: {} };
globalThis.history = { replaceState() {} }; globalThis.window = { addEventListener() {}, setTimeout, __1HC: { slug: "t" } };
const store = new Map(); globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const ok = (name) => console.log("  ok", name);
const wait = (ms) => new Promise((z) => setTimeout(z, ms));
const view = (own, chain) => ({ on: true, level: "zdr", ...(own ? { own_key: true, endpoint: "own", optional: true, no_model: !chain.length, connections: [{ id: "chatgpt", kind: "chatgpt", label: "ChatGPT", host: "" }], has_openrouter: false } : {}),
  needs_choice: false, problems: [], max_categories: 12, categories: [{ id: "general", title: "General", chain, max_price: null }], background: { title: "Background jobs", chain: [] },
  models: Object.fromEntries(chain.map((e) => [e.model, { id: e.model, name: "GPT 6", service: "ChatGPT", conn: "chatgpt", efforts: [], allowed: true }])) });
const paths = []; let saved = null;
globalThis.location = { search: "?byoksaved", pathname: "/v3/", hash: "", href: "http://x/v3/", origin: "http://x" };
const m = await import(pathToFileURL(out).href);
const api = async (path, init) => {
  paths.push(`${init?.method || "GET"} ${path}`);
  if (path.startsWith("account/custom-models/catalog")) return { ok: true, level: "zdr", models: [], errors: [] };
  const scoped = path.includes("scope=services");
  if (init?.method === "POST") { saved = init.body; return view(true, init.body.categories[0].chain); }
  return view(scoped, saved ? saved.categories[0].chain : []);
};
m.cmodelsInit({ api, repaint() {}, shown: () => true, srow: (i, t, s, r) => `<div class="sr">${t}|${s}|${r}</div>`, ask: async () => false, openAdvanced() {}, openAi() {}, saved() { paths.push("saved"); }, version: "t", noteBoot() {} }, { on: false, own_key: false });
let repaints = 0;
m.bykInit({ api: null, repaint() { repaints++; }, open() {}, note() {}, who: () => "Skipper", srow: (i, t, s, r) => `<div class="sr">${t}|${s}|${r}</div>`, icon: () => "", shown: () => true, credits() {} });
m.bykPage(); await wait(500);

// A full plan with a service: the panel shows Models, asks for the services scope, and has no warning
let h = m.bykPage(); await wait(200); h = m.bykPage();
assert.match(h, /data-cmown/); assert.match(h, /data-cmcat="general"/); assert.match(h, /Choose a model/); assert.doesNotMatch(h, /No model is chosen yet/);
assert.ok(paths.some((p) => p === "GET account/custom-models?scope=services"), paths.join(" | "));
assert.ok(paths.filter((p) => p.startsWith("GET account/custom-models")).every((p) => p.includes("scope=services")), "every request of the panel carries the scope");
ok("full plan with a service: Models shows, asks with ?scope=services, no warning");

// Advanced: no scope, and it still draws 1Helm's models card (not hidden)
paths.length = 0;
const card = m.cmodelsCard(); await wait(200);
assert.match(m.cmodelsCard(), /Custom Model Selection/, "Advanced shows the 1Helm models switch on a full plan");
assert.ok(paths.some((p) => p === "GET account/custom-models"), paths.join(" | ")); assert.ok(!paths.some((p) => p.includes("scope")), "Advanced sends no scope");
// and back on the panel it reads its own answer again
paths.length = 0; m.bykPage(); await wait(300);
assert.ok(paths.some((p) => p === "GET account/custom-models?scope=services"), paths.join(" | "));
ok("Advanced asks with no scope and keeps its card; the panel asks again with the scope when it opens");

// The option list: Use my services now first
h = m.bykPage();
assert.deepStrictEqual([...h.matchAll(/data-bykmode="(\w*)"/g)].map((x) => x[1]), ["now", "fallback"]);
assert.match(h, /Use my services now/);
ok("the plan options start with Use my services now");
console.log("services models any plan: all passed");
