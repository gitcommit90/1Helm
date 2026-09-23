import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("..", import.meta.url);
const client = readFileSync(new URL("src/client/routing.ts", ROOT), "utf8");
const server = readFileSync(new URL("src/server/routing.ts", ROOT), "utf8");
const modelRefreshClient = readFileSync(new URL("src/client/provider-model-refresh.ts", ROOT), "utf8");
const modelRefreshServer = readFileSync(new URL("src/server/provider-model-refresh.ts", ROOT), "utf8");
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

test("manual model probes are visibly bounded and cannot be started concurrently", () => {
  const apiClient = readFileSync(new URL("src/client/api.ts", ROOT), "utf8");
  assert.match(client, /This can take up to 60 seconds\./);
  assert.match(client, /addModel\.disabled = true/);
  assert.match(client, /exact\.disabled = true/);
  assert.match(client, /AbortSignal\.timeout\(70_000\)/);
  assert.match(client, /finally \{[\s\S]*exact\.disabled = false;[\s\S]*addModel\.disabled = false;/);
  assert.match(apiClient, /routingAction<[\s\S]*options: \{ signal\?: AbortSignal \}/);
});

test("model refresh is a preview-confirm contract with OpenRouter free metadata", () => {
  assert.match(modelRefreshClient, /Nothing changes until you confirm\./);
  assert.match(modelRefreshClient, /Select all/);
  assert.match(modelRefreshClient, /Select none/);
  assert.match(modelRefreshClient, /Free only/);
  assert.match(modelRefreshClient, /Add an exact model ID manually/);
  assert.match(modelRefreshClient, /Override\?/);
  assert.match(modelRefreshClient, /Replace this account with exactly the checked models\. Every other model becomes inactive\./);
  assert.match(modelRefreshServer, /modelRefreshPreviews/);
  assert.match(modelRefreshServer, /openRouterFreeFlag/);
  assert.match(modelRefreshServer, /previewToken/);
  assert.match(modelRefreshServer, /The selection contains a model that was not in this preview/);
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
  assert.match(client, /usage\.logical_input_tokens\), "Logical input"[\s\S]*usage\.uncached_input_tokens\), "Uncached"[\s\S]*usage\.cache_read_tokens\), "Cache read"[\s\S]*usage\.cache_write_tokens\), "Cache write"[\s\S]*usage\.completion_tokens\), "Output"[\s\S]*usage\.total_tokens\), "Total"/,
    "Activity distinguishes logical input, uncached processing, cache reads, cache writes, output, and total");
  assert.match(server, /tokenSemantics = excludesCache \? "input_excludes_cache_read_write" : "input_includes_cache_read"/,
    "usage records retain provider-specific token semantics");
});


test("refreshed provider model catalogs are searchable and explicitly scrollable", () => {
  assert.match(modelRefreshClient, /type: "search"[\s\S]*dataset: \{ modelSearch: "" \}/);
  assert.match(modelRefreshClient, /toLocaleLowerCase\(\)\.includes\(search\.value\.trim\(\)\.toLocaleLowerCase\(\)\)/,
    "search matches model names and IDs case-insensitively");
  assert.match(modelRefreshClient, /visibleModels\(\)[\s\S]*dataset: \{ discoveredModel:/,
    "search and provider filters share the same visible catalog projection");
  assert.match(styles, /\.routing-model-refresh-body \{[^}]*overscroll-behavior-y: contain;[^}]*scrollbar-gutter: stable;/,
    "the complete preview content has an independently scrollable body inside its bounded sheet");
  assert.match(styles, /\.routing-model-catalog \{[^}]*max-height: 42vh;[^}]*overflow-y: auto;[^}]*overscroll-behavior-y: auto;/,
    "the model catalog overrides the generic telemetry list's hidden overflow");
  assert.match(modelRefreshClient, /routing-model-refresh-body min-h-0 flex-1[^"]*overflow-y-auto/,
    "the complete refresh window scrolls so controls below a long catalog remain reachable");
  assert.match(modelRefreshClient, /max-h-\[85vh\][^"]*overflow-hidden[\s\S]*dataset: \{ modelRefresh:/,
    "the bounded refresh panel delegates overflow to its scrolling body");
  assert.match(modelRefreshClient, /modelRefreshFooter[\s\S]*status, actions/,
    "confirm and cancel remain in a fixed footer outside both scroll containers");
  assert.match(modelRefreshClient, /add\(actions,[\s\S]*confirm\)/,
    "the confirmation action is always mounted in the fixed footer");
});


test("provider controls expose opt-in exclusive daily model refresh modes", () => {
  assert.match(modelRefreshClient, /Auto-refresh model list every 24 hours/);
  assert.match(modelRefreshClient, /Auto-refresh free models every 24 hours/);
  assert.match(modelRefreshClient, /all\.disabled = free\.checked; free\.disabled = all\.checked/);
  assert.match(modelRefreshServer, /const DAY_MS = 24 \* 60 \* 60_000/);
  assert.match(modelRefreshServer, /modelAutoRefreshMode !== mode/);
});
