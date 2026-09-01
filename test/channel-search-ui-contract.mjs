import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("..", import.meta.url);
const searchUi = readFileSync(new URL("src/client/channel-search.ts", ROOT), "utf8");
const app = readFileSync(new URL("src/client/app.ts", ROOT), "utf8");
const server = readFileSync(new URL("src/server/index.ts", ROOT), "utf8");

test("channel search is enter-driven and opens the result thread", () => {
  assert.match(searchUi, /event\.key === "Enter"/);
  assert.match(searchUi, /\/api\/channels\/\$\{channelId\}\/search\?q=/);
  assert.match(searchUi, /onOpenThread\(Number\(item\.thread_root_id\)\)/);
  assert.match(searchUi, /Search this channel/);
  assert.doesNotMatch(searchUi, /addEventListener\("input"/);
  assert.match(searchUi, /html: md\(item\.text\)/, "result snippets render Markdown instead of exposing raw syntax");
  assert.match(searchUi, /highlightRenderedMatch\(snippet, query\)/);
  assert.match(searchUi, /font-bold/, "visible query matches are bolded");
  assert.match(searchUi, /item\.match_type === "exact"/, "exact and semantic hits are visibly distinguished");
});

test("every agent channel header exposes channel search", () => {
  assert.match(app, /dataset: \{ channelSearch: String\(channel\.id\) \}/);
  assert.match(app, /openChannelSearch\([^;]+openThread/);
});

test("channel search API is member-gated and semantic", () => {
  assert.match(server, /if \(!canSee\(user, channelId\)\) return json\(res, 403/);
  assert.match(server, /action === "search" && m === "GET"/);
  assert.match(server, /searchChannelHistory\(agent, channelId, \{ query, mode: "semantic", limit: 12 \}\)/);
  const history = readFileSync(new URL("src/server/history.ts", ROOT), "utf8");
  assert.match(history, /const exactRows = q/);
  assert.match(history, /rows = \[\.\.\.exactRows, \.\.\.keywordRows, \.\.\.semanticRows\]/, "literal and keyword hits lead semantic-only results");
  assert.match(history, /searchSnippet\(String\(row\.body\), query\)/, "the returned excerpt contains a distant literal match");
});
