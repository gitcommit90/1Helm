import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withAppV, versionedAsset, expectedAssetVersion, ONBOARD_APPS_JS_V, ONBOARD_STATIC_CSS_V, ONBOARD_STATIC_JS_V } from "../src/asset-version.js";
import { landingPage } from "../src/onboarding.js";

const V = { APP_V: "247", ONBOARD_V: "16", DEV_ICON_V: "2" };
const run = (path, status = 200) => versionedAsset(new URL(`https://x.test${path}`), new Response("body", { status, headers: { "cache-control": "public, max-age=0, must-revalidate" } }), V);
const IMMUTABLE = "public, max-age=31536000, immutable";

test("matching v is immutable", () => {
  assert.equal(run("/app-static/app.js?v=247").headers.get("cache-control"), IMMUTABLE);
  assert.equal(run("/app-static/style.css?v=247").headers.get("cache-control"), IMMUTABLE);
  assert.equal(run("/onboard/v1/app.js?v=16").headers.get("cache-control"), IMMUTABLE);
  assert.equal(run("/onboard/v1/apps.js?v=9").headers.get("cache-control"), IMMUTABLE);
  assert.equal(run("/1helm-dev-icon-64.png?v=2").headers.get("cache-control"), IMMUTABLE);
});

test("mismatched v is no-store", () => {
  assert.equal(run("/app-static/app.js?v=246").headers.get("cache-control"), "no-store");
  assert.equal(run("/onboard/kit.css?v=15").headers.get("cache-control"), "no-store");
  assert.equal(run("/onboard-static/app.js?v=9").headers.get("cache-control"), "no-store");
  assert.equal(run("/onboard/v1/apps.js?v=16").headers.get("cache-control"), "no-store");
});

test("v on a path with no version source is no-store", () => {
  assert.equal(expectedAssetVersion("/fonts/instrument-sans.woff2", V), null);
  assert.equal(run("/fonts/instrument-sans.woff2?v=1").headers.get("cache-control"), "no-store");
});

test("no v and non-200 responses are unchanged", () => {
  assert.equal(run("/app-static/app.js").headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.equal(run("/app-static/app.js?v=246", 404).headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.equal(run("/app-static/app.js?v=").headers.get("cache-control"), "public, max-age=0, must-revalidate");
});

test("version constants match the files that use them", async () => {
  const html = await landingPage({}).text();
  assert.ok(html.includes(`/onboard-static/style.css?v=${ONBOARD_STATIC_CSS_V}"`));
  assert.ok(ONBOARD_STATIC_JS_V);
});

test("API responses carry x-app-v; other paths and websockets do not", async () => {
  const f = (path, status = 200) => withAppV(new URL(`https://x.test${path}`), new Response("body", { status, headers: { "content-type": "application/json" } }), V);
  const a = f("/w/ck1/api/app/boot"); assert.equal(a.headers.get("x-app-v"), "247"); assert.equal(a.headers.get("content-type"), "application/json"); assert.equal(await a.text(), "body");
  assert.equal(f("/w/ck1/api/anything", 404).headers.get("x-app-v"), "247");
  assert.equal(f("/w/ck1/app").headers.get("x-app-v"), null);
  assert.equal(f("/app-static/app.js").headers.get("x-app-v"), null);
});
