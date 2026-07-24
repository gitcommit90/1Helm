import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.CTRL_DATA_DIR = process.env.CTRL_DATA_DIR || `/tmp/1helm-web-research-${process.pid}`;
const fixtures = [{
  title: "West Hollywood sinkhole filled after water main repairs",
  url: "https://example.com/news/sunset-sinkhole",
  snippet: "A water-main rupture created a roadway sinkhole on Sunset Boulevard.",
  source: "Example News",
  published_at: "2026-07-23T18:00:00.000Z",
  image_url: "https://example.com/images/sunset-sinkhole.jpg",
}];
process.env.HELM_TEST_WEB_SEARCH_FIXTURE = JSON.stringify(fixtures);
process.env.HELM_TEST_WEB_SOURCE_FIXTURES = JSON.stringify({
  "https://example.com/news/sunset-sinkhole": "Sunset Boulevard reopened after repair crews filled the roadway collapse caused by a broken water main.",
  "https://example.com/images/sunset-sinkhole.jpg": { content_type: "image/jpeg", base64: "/9j/2Q==" },
});

const { conciseSearchQuery, searchWeb } = await import("../src/server/web-search.ts");
const { fetchPublicWebImage } = await import("../src/server/web-source.ts");

test("current-event research returns dated source and a real attachable image", async () => {
  const searched = await searchWeb("Sunset Boulevard sinkhole West Hollywood", "news", 5);
  assert.equal(searched.results[0].url, fixtures[0].url);
  assert.equal(searched.results[0].published_at, fixtures[0].published_at);
  const image = await fetchPublicWebImage(searched.results[0].image_url);
  assert.equal(image.content_type, "image/jpeg");
  assert.equal(image.bytes, 4);
});

test("empty natural-language searches retry once with a concise query", async () => {
  const request = "whats the latest news on that sinkhole situation in weho";
  const concise = conciseSearchQuery(request);
  assert.equal(concise, "sinkhole weho");
  process.env.HELM_TEST_WEB_SEARCH_FIXTURE = JSON.stringify({ [request]: [], [concise]: fixtures });
  const searched = await searchWeb(request, "news", 5);
  assert.equal(searched.requested_query, request);
  assert.equal(searched.query, concise);
  assert.equal(searched.results[0].url, fixtures[0].url);
});
