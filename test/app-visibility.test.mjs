// node --import ./test/stubs/register.mjs test/app-visibility.test.mjs
// One list of hidden apps (src/ee/app-visibility.json, rules in src/ee/app-visibility.js). Checks only 1Helm's own behavior: which apps the
// catalog, find_app, the hint, app_actions/app_run/app_proxy, the Connect check and the app page allow, and that the app UI keeps no list of its own.
import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "node:fs";
import { hiddenReason, isHiddenApp, isHiddenToolkitAction, visibleCatalog, connectRefusal, HIDDEN_TOOLKITS, HIDDEN_PREFIXES, TWINS, isTwinApp, twinKept, brandName, findTwinPairs, chooseTwin, twinsFor } from "../src/ee/app-visibility.js";
import { isHiddenAction, builtinApps } from "../src/ee/builtin-apps.js";
import { searchApps, setCatalog, appCatalog, connectKind, connectBlock, withConnectedTwin } from "../src/ee/connect-offer.js";
import { matchIntegrations, ALIASES, integrationHint } from "../src/ee/integration-hint.js";
import { runAppTool, appConnectLink, sessionScope } from "../src/ee/composio.js";
import { sessionConfig } from "../src/ee/composio-transport.js";
import { appEventsTool } from "../src/ee/composio-triggers.js";
import { appDetail } from "../src/ee/app-detail.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const FILES = { integrations: JSON.parse(read("../app-assets/app-static/integrations.json")), latest: JSON.parse(read("../app-assets/app-static/integrations-latest.json")) };
const data = JSON.parse(read("../src/ee/app-visibility.json"));

test("rules: the deny list, the Cloudflare prefix rule with its one exception, and future slugs", () => {
  for (const s of Object.keys(data.hidden)) assert.ok(isHiddenApp(s), s);
  for (const s of ["cloudflare", "cloudflare_api_key", "cloudflare_browser_rendering", "cloudflare_future", "Cloudflare", "cloudflareworkers"]) assert.ok(isHiddenApp(s), s);
  for (const s of ["cloudflare_mcp", "CLOUDFLARE_MCP", "gmail", "", null]) assert.ok(!isHiddenApp(s), String(s));
  assert.ok(hiddenReason("cloudflare").length > 20);
  assert.equal(HIDDEN_PREFIXES.length, 1);
});
test("rules: actions follow their app; CLOUDFLARE_MCP_* actions stay allowed", () => {
  for (const a of ["CLOUDFLARE_LIST_ZONES", "CLOUDFLARE_API_KEY_LIST_ZONES", "CLOUDFLARE_BROWSER_RENDERING_SCREENSHOT", "CLOUDFLARE_FUTURE_X", "CODEINTERPRETER_EXECUTE_CODE"]) assert.ok(isHiddenAction(a) && isHiddenToolkitAction(a), a);
  for (const a of ["CLOUDFLARE_MCP_EXECUTE", "CLOUDFLARE_MCP_SEARCH", "CLOUDFLARE_MCP_DOCS", "GMAIL_FETCH_EMAILS"]) assert.ok(!isHiddenAction(a), a);
});
test("catalog: the file the Apps popup loads has no hidden app, in both Composio versions, and keeps Cloudflare MCP", () => {
  for (const [k, list] of Object.entries(FILES)) {
    const v = visibleCatalog(list), slugs = v.map((a) => a.s);
    assert.deepEqual(slugs.filter((s) => s.startsWith("cloudflare")), ["cloudflare_mcp"], k);
    for (const h of HIDDEN_TOOLKITS.keys()) assert.ok(!slugs.includes(h), `${k} ${h}`);
    assert.equal(v.length, list.filter((a) => !isHiddenApp(a.s) && !isTwinApp(a.s)).length);
    assert.ok(slugs.includes("gmail"));
  }
  const src = read("../src/index.js");
  assert.match(src, /visibleCatalog\(await r\.json\(\)\)/); assert.match(src, /p === "\/app-static\/integrations-latest\.json"/);
});
test("find_app search and the aliases: cloudflare means cloudflare_mcp", async () => {
  setCatalog(FILES.latest);
  const list = await appCatalog({});
  assert.ok(!list.some((a) => a.s !== "cloudflare_mcp" && a.s.startsWith("cloudflare")));
  for (const q of ["Cloudflare", "cloudflare api key", "cloudflare browser rendering"]) assert.ok(searchApps(list, q).every((h) => !h.a.s.startsWith("cloudflare") || h.a.s === "cloudflare_mcp"), q);
  assert.equal(searchApps(list, "cloudflare")[0].a.s, "cloudflare_mcp");
  assert.equal(ALIASES.cloudflare, "cloudflare_mcp"); assert.equal(ALIASES.godaddy, "godaddy_mcp");
  for (const m of [{ app: "malwarebytes_mcp" }]) assert.ok(!list.some((a) => a.s === m.app));
});
test("hint: Cloudflare in a message hints Cloudflare MCP, never a hidden toolkit, connected or not", async () => {
  setCatalog(FILES.latest); const list = await appCatalog({});
  assert.deepEqual(matchIntegrations("put my landing page on cloudflare", list).map((x) => x.slug), ["cloudflare_mcp"]);
  for (const conns of [[], [{ app: "cloudflare", name: "Cloudflare", status: "connected", id: "a" }, { app: "cloudflare_api_key", status: "connected", id: "b" }]]) {
    const r = await integrationHint({ env: { COMPOSIO_KEY: "k", COMPOSIO_TOOLKIT_VERSION: "latest" }, conns: async () => conns }, "help me publish a site on Cloudflare", list);
    assert.match(r.line, /cloudflare_mcp/); assert.doesNotMatch(r.line, /\[cloudflare\]|\(cloudflare[;)]|cloudflare_api_key|3 accounts/);
    assert.ok(r.items.every((x) => x.a.s === "cloudflare_mcp"));
  }
});
test("helper tools refuse hidden apps before any network call, and the session never includes them", async () => {
  const env = { COMPOSIO_KEY: "k", COMPOSIO_TOOLKIT_VERSION: "latest" }, real = globalThis.fetch; let net = 0; globalThis.fetch = async () => { net++; throw new Error("no network"); };
  const conns = [{ app: "cloudflare", name: "Cloudflare", status: "connected", id: "ca_1" }, { app: "cloudflare_mcp", name: "Cloudflare MCP", status: "connected", id: "ca_2" }];
  try {
    assert.match(await runAppTool(env, "t1", "app_actions", { app: "cloudflare", want: "list zones" }, conns), /^error: cloudflare isn't available in 1Helm/);
    assert.match(await runAppTool(env, "t1", "app_actions", { app: "cloudflare_api_key", want: "x" }, conns), /isn't available in 1Helm/);
    assert.match(await runAppTool(env, "t1", "app_run", { action: "CLOUDFLARE_LIST_ZONES", arguments: {} }, conns), /^error: CLOUDFLARE_LIST_ZONES isn't available in 1Helm/);
    assert.match(await runAppTool(env, "t1", "app_proxy", { app: "cloudflare_browser_rendering", method: "GET", path: "/x" }, conns), /isn't available in 1Helm/);
    assert.match(await appEventsTool({ ...env, COMPOSIO_WEBHOOK_SECRET: "s" }, "t1", { app: "cloudflare" }, conns), /isn't available in 1Helm/);
  } finally { globalThis.fetch = real; }
  assert.equal(net, 0);
  assert.deepEqual(sessionScope(conns, env).toolkits.filter((s) => s.startsWith("cloudflare")), ["cloudflare_mcp"]);
  assert.deepEqual(sessionScope(conns, env).accounts, { cloudflare_mcp: ["ca_2"] });
  assert.deepEqual(sessionConfig("t1", { toolkits: ["cloudflare", "cloudflare_mcp", "gmail"] }).toolkits.enable, ["cloudflare_mcp", "gmail"]);
  assert.ok(![...builtinApps(env).keys()].some(isHiddenApp));
});
test("connect: hidden apps and unconnected Soon apps are refused; connected Soon apps may add an account; the link is never made", async () => {
  setCatalog(FILES.latest);
  const soon = FILES.latest.find((a) => a.x && !a.b), ok = FILES.latest.find((a) => !a.x && !a.b && a.o);
  assert.ok(soon && ok);
  assert.ok(connectRefusal("cloudflare") && connectRefusal("malwarebytes_mcp") && connectRefusal(soon.s, soon, false));
  assert.equal(connectRefusal(soon.s, soon, true), ""); assert.equal(connectRefusal(ok.s, ok, false), ""); assert.equal(connectRefusal("cloudflare_mcp"), "");
  assert.equal(connectKind(soon), "soon"); assert.notEqual(connectKind(soon, true), "soon");
  const env = { APP_HOST: "x" }, real = globalThis.fetch; let net = 0; globalThis.fetch = async () => { net++; throw new Error("no network"); };
  try {
    for (const s of ["cloudflare", "cloudflare_api_key", "codeinterpreter"]) {
      assert.match(await connectBlock(env, "t1", s), /isn't available/, s);
      await assert.rejects(appConnectLink({ COMPOSIO_KEY: "k" }, "t1", s, "https://x/cb"), /isn't available in 1Helm/, s);
    }
  } finally { globalThis.fetch = real; }
  assert.equal(net, 0);
  const route = read("../src/index.js");
  assert.match(route, /connectBlock\(env, t\.id, app\)[\s\S]{0,120}403/, "the Connect route checks the same rule");
});
test("app page: a hidden app has no page unless the person has an account in it", async () => {
  const real = globalThis.fetch; let net = 0; globalThis.fetch = async () => { net++; return Response.json({ items: [] }); };
  try {
    await assert.rejects(appDetail({ COMPOSIO_KEY: "k" }, "t1", "cloudflare"), (e) => e.status === 404);
    await assert.rejects(appDetail({ COMPOSIO_KEY: "k" }, "t1", "text_to_pdf"), (e) => e.status === 404);
  } finally { globalThis.fetch = real; }
});
test("the app UI reads the catalog the Worker serves and keeps no hide list of its own", () => {
  const v3 = read("../web/src/v3.ts");
  assert.doesNotMatch(v3, /catalogAppVisible|startsWith\("cloudflare"\)|malwarebytes_mcp|text_to_pdf/, "v3.ts has no hide list: the Worker filters the catalog it serves");
  assert.doesNotMatch(read("../web/src/apps-availability.ts"), /catalogAppVisible|cloudflare/, "no Cloudflare rule left in the UI");
  assert.match(v3, /\/app-static\/integrations\.json/, "the app loads the catalog the Worker serves");
});

// ---------------- twins: a plain app and its "X MCP" twin (Captain 10-27) ----------------
const row = (s, n, x = {}) => ({ s, n, d: "", c: [], t: 5, o: 0, f: 0, ...x });
test("twins: pairs are found by slug (X, X_mcp) and by name once lowercased and stripped, with no false matches", () => {
  const list = [row("notion", "Notion"), row("notion_mcp", "Notion MCP"), row("browserbase_tool", "Browserbase"), row("browserbase_mcp", "Browserbase MCP"),
    row("search_api", "Search api"), row("searchapi_mcp", "SearchAPI MCP"), row("lonely_mcp", "Lonely MCP"), row("cloudflare_mcp", "Cloudflare MCP"), row("mcp_tools", "MCP Tools"),
    row("zapier", "Zapier"), row("zapier_mcp_server", "Zapier Server")];
  const pairs = findTwinPairs(list).map((p) => [p.plain.s, p.mcp.s, p.how]);
  assert.deepEqual(pairs, [["notion", "notion_mcp", "slug"], ["browserbase_tool", "browserbase_mcp", "name"], ["search_api", "searchapi_mcp", "name"]]);
});
test("twins: the catalog files list the 45 pairs, and no real pair is doubtful (a twin is never built in, a kept side is never Soon alone)", () => {
  for (const [k, list] of Object.entries(FILES)) {
    const pairs = findTwinPairs(list); assert.equal(pairs.length, 45, k);
    for (const p of pairs) {
      const kept = chooseTwin(p) === "mcp" ? p.mcp : p.plain, twin = kept === p.mcp ? p.plain : p.mcp;
      assert.ok(!(kept.x && !kept.b && !twin.x), `${k} ${kept.s} is Soon but its twin ${twin.s} isn't`);
      assert.ok(!twin.b || isHiddenApp(twin.s), `${k} ${twin.s} is built in: a built-in twin would stay usable by new people`);
    }
    // Every slug pair is a pair of names too, except the two that only the names catch.
    assert.deepEqual(pairs.filter((p) => p.how === "name").map((p) => p.mcp.s).sort(), ["browserbase_mcp", "searchapi_mcp"], k);
  }
});
test("twins: app-visibility.json lists every pair in both catalog files, so a new pair can't slip through", () => {
  for (const [k, list] of Object.entries(FILES)) {
    const want = twinsFor(list), missing = Object.entries(want).filter(([t]) => !TWINS.has(t));
    assert.deepEqual(missing, [], `${k} has pairs that app-visibility.json "twins" doesn't list. Add these lines:\n${missing.map(([t, v]) => `  "${t}": "${v}",`).join("\n")}`);
    for (const [t, v] of TWINS) { const p = findTwinPairs(list).find((x) => [x.plain.s, x.mcp.s].includes(t)); assert.ok(p, `${k}: "twins" lists ${t}, which has no pair in the catalog any more`); assert.deepEqual([p.plain.s, p.mcp.s].sort(), [t, v].sort(), `${k} ${t}`); }
  }
  // A catalog with a new pair is caught by the same check (this is what the failure above prints for a real one).
  const future = [row("newbrand", "Newbrand"), row("newbrand_mcp", "Newbrand MCP", { o: 1 })];
  assert.deepEqual(twinsFor(future), { newbrand: "newbrand_mcp" }); assert.ok(!TWINS.has("newbrand"));
});
test("twins: the kept side is the MCP one, unless only the plain side has one-click sign-in; Soon and built-in are handled", () => {
  const pick = (p, m) => chooseTwin({ plain: row("a", "A", p), mcp: row("a_mcp", "A MCP", m) });
  assert.equal(pick({ o: 1 }, { o: 1 }), "mcp", "both one-click");
  assert.equal(pick({}, {}), "mcp", "both need a key");
  assert.equal(pick({ o: 1 }, {}), "plain", "only plain has one-click");
  assert.equal(pick({}, { o: 1 }), "mcp");
  assert.equal(pick({ b: 1 }, {}), "plain", "built in counts as no sign-in needed");
  assert.equal(pick({ b: 1 }, { o: 1 }), "mcp");
  assert.equal(pick({ o: 1 }, { x: 1 }), "plain", "the MCP side is Soon");
  assert.equal(pick({}, { x: 1 }), "plain", "never keep a Soon side when the other is available");
  assert.equal(pick({ x: 1 }, {}), "mcp"); assert.equal(pick({ x: 1 }, { x: 1 }), "mcp");
  // The real catalog, 2026-10-17 snapshot values: plain kept for GitHub, Box, Intercom and Railway (its MCP side is Soon), MCP for the rest.
  const plainKept = Object.entries(Object.fromEntries(TWINS)).filter(([, v]) => !v.endsWith("_mcp")).map(([, v]) => v).sort();
  assert.deepEqual(plainKept, ["box", "github", "intercom", "railway"]);
  for (const s of ["notion", "linear", "highlevel", "explorium", "browserbase_tool", "search_api", "cloudflare"]) assert.ok(isTwinApp(s), s);
  assert.equal(twinKept("notion"), "notion_mcp"); assert.equal(twinKept("github_mcp"), "github"); assert.equal(twinKept("browserbase_tool"), "browserbase_mcp");
});
test("twins: the Apps popup shows one card per brand, named without MCP, and keeps its twin's featured rank", () => {
  for (const [k, list] of Object.entries(FILES)) {
    const v = visibleCatalog(list), by = new Map(v.map((a) => [a.s, a]));
    for (const t of TWINS.keys()) assert.ok(!by.has(t), `${k} ${t}`);
    for (const kept of new Set(TWINS.values())) if (!isHiddenApp(kept)) assert.ok(by.has(kept) || list.find((r) => r.s === kept)?.x, `${k} ${kept} has no card`);
    assert.ok(by.has("notion_mcp") && by.get("notion_mcp").n === "Notion"); assert.equal(by.get("github").n, "GitHub"); assert.equal(by.get("browserbase_mcp").n, "Browserbase");
    assert.equal(by.get("cloudflare_mcp").n, "Cloudflare");
    assert.ok(by.get("notion_mcp").f > 0 && by.get("stripe_mcp").f > 0, "Notion and Stripe stay in Popular");
    assert.ok(v.every((a) => !/\sMCP$/i.test(a.n) || !new Set(TWINS.values()).has(a.s)), "no kept card still says MCP");
    const names = v.map((a) => a.n.toLowerCase()); const dup = names.filter((n, i) => names.indexOf(n) !== i); assert.deepEqual(dup.filter((n) => ["notion", "github", "linear", "stripe"].includes(n)), []);
  }
  assert.equal(brandName("notion_mcp", "Notion MCP"), "Notion"); assert.equal(brandName("github_mcp", "GitHub MCP"), "GitHub MCP", "a twin keeps its name");
  assert.equal(brandName("excalidraw_mcp", "Excalidraw MCP"), "Excalidraw MCP", "an MCP app with no plain twin keeps its name");
});
test("twins: find_app, the aliases and the hint offer the kept side only", async () => {
  setCatalog(FILES.latest); const list = await appCatalog({});
  assert.ok(!list.some((a) => isTwinApp(a.s)));
  assert.equal(searchApps(list, "Notion")[0].a.s, "notion_mcp"); assert.equal(searchApps(list, "Notion")[0].a.n, "Notion");
  assert.equal(searchApps(list, "github")[0].a.s, "github");
  for (const [k, slug] of Object.entries(ALIASES)) assert.ok(!isTwinApp(slug), `integration-hint ALIASES "${k}" points at a twin: ${slug}`);
  assert.equal(ALIASES["notion page"], "notion_mcp"); assert.equal(ALIASES["monday.com"], "monday_mcp");
  assert.deepEqual(matchIntegrations("add this to my Notion", list).map((x) => x.slug), ["notion_mcp"]);
  assert.deepEqual(matchIntegrations("what are my Linear issues", list).map((x) => x.slug), ["linear_mcp"]);
  const r = await integrationHint({ env: { COMPOSIO_KEY: "k", COMPOSIO_TOOLKIT_VERSION: "latest" }, conns: async () => [] }, "put this in my Notion", list);
  assert.match(r.line, /Notion \[notion_mcp\]/); assert.doesNotMatch(r.line, /Notion MCP \[|\[notion\]/);
});
test("twins: a person already connected to the twin still gets it: hint, find_app and the helper tools use their account", async () => {
  setCatalog(FILES.latest); const list = await appCatalog({});
  const conns = [{ app: "notion", name: "Notion", status: "connected", id: "ca_n", email: "a@b.c" }];
  const r = await integrationHint({ env: { COMPOSIO_KEY: "k", COMPOSIO_TOOLKIT_VERSION: "latest" }, conns: async () => conns }, "put this in my Notion", list);
  assert.match(r.line, /Connected: Notion \(notion\)/); assert.doesNotMatch(r.line, /Needs connecting/);
  assert.equal(withConnectedTwin(list.find((a) => a.s === "notion_mcp"), conns).s, "notion");
  assert.equal(withConnectedTwin(list.find((a) => a.s === "notion_mcp"), []).s, "notion_mcp");
  assert.equal(withConnectedTwin(list.find((a) => a.s === "notion_mcp"), [{ app: "notion_mcp", status: "connected" }, ...conns]).s, "notion_mcp", "connected to the kept side: it wins");
  // The use paths never treat a twin as hidden: the connection stays in the session and the transport's toolkit list.
  const env = { COMPOSIO_KEY: "k", COMPOSIO_TOOLKIT_VERSION: "latest" };
  assert.ok(!isHiddenApp("notion") && !isHiddenApp("github_mcp") && !isHiddenToolkitAction("NOTION_ADD_PAGE_CONTENT"));
  assert.deepEqual(sessionScope(conns, env).toolkits.filter((s) => s.startsWith("notion")), ["notion"]);
  assert.deepEqual(sessionScope(conns, env).accounts, { notion: ["ca_n"] });
  assert.deepEqual(sessionConfig("t1", { toolkits: ["notion", "github_mcp"] }).toolkits.enable, ["github_mcp", "notion"]);
});
test("twins: a new person can't connect a twin; a person already connected can add an account; the app page follows the same rule", async () => {
  setCatalog(FILES.latest);
  assert.match(connectRefusal("notion"), /another entry/); assert.equal(connectRefusal("notion", null, true), ""); assert.equal(connectRefusal("notion_mcp"), "");
  assert.match(connectRefusal("cloudflare", null, true), /isn't available/, "Cloudflare's own rule still wins");
  const real = globalThis.fetch; let net = 0; const mode = { conns: [] };
  globalThis.fetch = async (u) => { net++; if (/connected_accounts/.test(String(u))) return Response.json({ items: mode.conns }); return Response.json({ items: [] }); };
  try {
    assert.match(await connectBlock({ COMPOSIO_KEY: "k", APP_HOST: "x" }, "t1", "notion"), /another entry/);
    assert.equal(await connectBlock({ COMPOSIO_KEY: "k", APP_HOST: "x" }, "t1", "notion_mcp"), "");
    await assert.rejects(appConnectLink({ COMPOSIO_KEY: "k", APP_HOST: "x" }, "t1", "github_mcp", "https://x/cb"), /another entry/);
    await assert.rejects(appDetail({ COMPOSIO_KEY: "k" }, "t1", "notion"), (e) => e.status === 404, "no page for a twin the person has no account in");
  } finally { globalThis.fetch = real; }
  const route = read("../src/index.js");
  assert.match(route, /connectBlock\(env, t\.id, app\)[\s\S]{0,120}403/);
});
