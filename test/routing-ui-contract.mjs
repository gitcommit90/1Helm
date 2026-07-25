import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("..", import.meta.url);
const client = readFileSync(new URL("src/client/routing.ts", ROOT), "utf8");
const server = readFileSync(new URL("src/server/routing.ts", ROOT), "utf8");

test("provider controls expose the live dotted router flow and credential-free header popover", () => {
  assert.match(client, /export async function openRoutingPopover\(eventOrAnchor: Event \| Element\)/);
  assert.match(client, /Latest 10 requests/);
  assert.match(client, /latestRequests\(state, 10\)/);
  assert.match(client, /API keys for the router are stored in Settings → Providers → Endpoints\./);
  assert.match(client, /routing-fabric-path/);
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
