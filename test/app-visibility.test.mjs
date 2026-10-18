// node --import ./test/stubs/register.mjs test/app-visibility.test.mjs
// One list of hidden apps (src/ee/app-visibility.json, rules in src/ee/app-visibility.js). Checks only 1Helm's own behavior: which apps the
// catalog, find_app, the hint, app_actions/app_run/app_proxy, the Connect check and the app page allow, and that the app UI keeps no list of its own.
import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "node:fs";
import { hiddenReason, isHiddenApp, isHiddenToolkitAction, visibleCatalog, connectRefusal, HIDDEN_TOOLKITS, HIDDEN_PREFIXES } from "../src/ee/app-visibility.js";
import { isHiddenAction, builtinApps } from "../src/ee/builtin-apps.js";
import { searchApps, setCatalog, appCatalog, connectKind, connectBlock } from "../src/ee/connect-offer.js";
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
    assert.equal(v.length, list.filter((a) => !isHiddenApp(a.s)).length);
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
