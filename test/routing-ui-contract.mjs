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
  for (const provider of ["ChatGPT", "Claude", "Antigravity", "xAI", "OpenRouter", "NVIDIA", "Cloudflare", "GLM", "Custom"]) {
    assert.match(client, new RegExp(`name: "${provider}"`), `the fixed route arc includes ${provider}`);
  }
  assert.match(client, /const nodes = routeProviderFamilies/,
    "the route map always renders the complete nine-provider network");
  assert.match(client, /replace\(\/\^\(\?:openai-compat\|custom\)\$\/, "custom"\)/,
    "live OpenAI-compatible requests illuminate the collapsed Custom route");
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
  assert.match(client, /let shellWasConnected = false;[\s\S]*if \(shell\.isConnected\) shellWasConnected = true;[\s\S]*else if \(shellWasConnected\) \{ routingActivityListeners\.delete\(shellActivityListener\); return; \}/,
    "the Settings routing listener survives initial detached construction and prunes only a previously mounted panel");
  assert.doesNotMatch(client, /MutationObserver|if \(!shell\.isConnected\) setTimeout/,
    "routing activity delivery does not depend on mount timing or timer-based detached-state guesses");
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

test("every model selector groups direct models by stable provider identity", () => {
  const apiClient = readFileSync(new URL("src/client/api.ts", ROOT), "utf8");
  assert.match(apiClient, /export function groupRoutingModels/);
  assert.match(apiClient, /provider:\$\{model\.providerId\}/, "custom direct models group by provider:<providerId>, never by generic type");
  assert.match(server, /customSource = \/\^\(\?:openai-compat\|custom\)\$\/i/, "per-provider identity is limited to custom/OpenAI-compatible sources");
  assert.match(server, /providerId: model\.combo \|\| !customSource \? undefined/, "branded families (OpenRouter, NVIDIA, OAuth accounts) keep pooling into one picker entry");
  for (const name of ["src/client/app.ts", "src/client/channel.ts"]) {
    const surface = readFileSync(new URL(name, ROOT), "utf8");
    assert.match(surface, /groupRoutingModels\(/, `${name} uses the one shared grouping helper`);
    assert.doesNotMatch(surface, /kind === "route" \? "routes" : String\(.*providerType/, `${name} does not re-implement provider grouping by type`);
  }
});

test("user-scoped usage honors every Activity period and hydrates provider identity", () => {
  for (const period of ["1h", "24h", "7d", "30d", "all"]) assert.match(server, new RegExp(`\\"${period}\\"|${period}:`));
  assert.match(server, /created>=\?/);
  assert.match(server, /current\?\.email \|\| current\?\.profileName \|\| accountAlias \|\| humanCurrentName/);
  assert.match(server, /Disconnected account/);
  assert.match(client, /usage\.prompt_tokens\), "Input"[\s\S]*usage\.completion_tokens\), "Output"[\s\S]*usage\.cached_tokens\), "Cached"[\s\S]*usage\.total_tokens\), "Total"/,
    "Activity shows the input, output, cached, and total token breakdown");
});
