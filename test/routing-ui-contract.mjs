import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("..", import.meta.url);
const client = readFileSync(new URL("src/client/routing.ts", ROOT), "utf8");
const server = readFileSync(new URL("src/server/routing.ts", ROOT), "utf8");
const styles = readFileSync(new URL("src/client/styles.css", ROOT), "utf8");

test("provider controls expose the live dotted router flow and credential-free header popover", () => {
  assert.match(client, /export async function openRoutingPopover\(eventOrAnchor: Event \| Element\)/);
  assert.match(client, /Latest 10 requests/);
  assert.match(client, /latestRequests\(state, 10\)/);
  assert.match(client, /API keys for the router are stored in Settings → Providers → Endpoints\./);
  assert.match(client, /routing-fabric-path/);
  assert.match(client, /const y = 46 \+ Math\.abs\(index - center\) \* 5/,
    "provider nodes form the requested downward arc");
  for (const provider of ["ChatGPT", "Claude", "Antigravity", "xAI", "OpenRouter", "NVIDIA", "Cloudflare", "GLM"]) {
    assert.match(client, new RegExp(`name: "${provider}"`), `the fixed route arc includes ${provider}`);
  }
  assert.match(client, /const nodes = routeProviderFamilies/,
    "the route map always renders the complete eight-provider network");
  assert.match(client, /M 360 248[\s\S]*M 360 135/,
    "request paths originate below the router and continue toward providers");
  assert.match(client, /Requested ·[\s\S]*Routed via/,
    "the requested model stays distinct from the provider/fallback outcome");
  assert.match(styles, /\.routing-live-router \{ top: 7\.2rem/);
  assert.match(styles, /\.routing-live-source \{ top: 13\.8rem/);
  assert.match(styles, /\.routing-fabric-path[\s\S]*stroke-dasharray[\s\S]*animation: routing-flow/,
    "live request paths are dotted and animated");
  assert.match(server, /routeSystemRequestForUser[\s\S]*id = `system-[\s\S]*initiator: "system"[\s\S]*work_kind/,
    "silent internal work is classified separately from user requests");
  assert.doesNotMatch(server, /pendingSystemRequests|candidate\.model === String\(event\.request\?\.model/,
    "system classification never guesses from an imminent same-model user request");
  assert.doesNotMatch(client, /routing-pyramid-tier/);
  assert.doesNotMatch(client.slice(client.indexOf("export async function openRoutingPopover"), client.indexOf("function sourceCatalog")), /routing\/credentials|apiKey/);
});

test("model refresh is a preview-confirm contract with OpenRouter free metadata", () => {
  assert.match(client, /Nothing changes until you confirm\./);
  assert.match(client, /Select all/);
  assert.match(client, /Select none/);
  assert.match(client, /Free only/);
  assert.match(client, /Add an exact model ID manually/);
  assert.match(server, /modelRefreshPreviews/);
  assert.match(server, /openRouterFreeFlag/);
  assert.match(server, /previewToken/);
  assert.match(server, /The selection contains a model that was not in this preview/);
});

test("user-scoped usage honors every Activity period and hydrates provider identity", () => {
  for (const period of ["1h", "24h", "7d", "30d", "all"]) assert.match(server, new RegExp(`\\"${period}\\"|${period}:`));
  assert.match(server, /created>=\?/);
  assert.match(server, /current\?\.email \|\| current\?\.profileName \|\| accountAlias \|\| humanCurrentName/);
  assert.match(server, /Disconnected account/);
});
