import assert from "node:assert/strict";
import { logoRoute } from "../src/logo.js";
import { appLogoRoute } from "../src/ee/applogo.js";

let cancelled = 0;
const endlessImage = (chunkSize, type) => new Response(new ReadableStream({
  pull(controller) { controller.enqueue(new Uint8Array(chunkSize).fill(65)); },
  cancel() { cancelled++; },
}), { headers: { "content-type": type, "content-length": "1" } });
let mode = "large";
globalThis.fetch = async (url) => {
  assert.match(String(url), /^https:\/\/(?:img\.logo\.dev|logos\.composio\.dev)\//);
  if (mode === "large") return endlessImage(String(url).includes("composio") ? 200_000 : 600_000, "image/webp");
  return new Response(new Uint8Array([82, 73, 70, 70]), { headers: { "content-type": "image/webp" } });
};

const ctx = { waitUntil() {} };
const logoEnv = { LOGO_DEV_PK: "pk_fixture", LOGO_DEV_MODE: "proxy", DB: { prepare() { return { bind() { return { first: async () => ({ n: 1 }) }; } }; } } };
const logoUrl = new URL("https://owner.example.com/logo/brand.com");
const appUrl = new URL("https://owner.example.com/applogo/exampleapp");
let response = await logoRoute(new Request(logoUrl), logoEnv, ctx, logoUrl);
assert.equal(response.status, 404);
assert.equal(response.headers.get("x-logo"), "upstream-too-large");
response = await appLogoRoute(new Request(appUrl), {}, ctx, appUrl);
assert.equal(response.status, 404);
assert.equal(cancelled, 2, "both oversized upstream streams were cancelled despite short claimed lengths");

mode = "small";
response = await logoRoute(new Request(logoUrl), logoEnv, ctx, logoUrl);
assert.equal(response.status, 200);
assert.equal(response.headers.get("x-content-type-options"), "nosniff");
assert.match(response.headers.get("content-security-policy"), /sandbox/);
assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([82, 73, 70, 70]));
response = await appLogoRoute(new Request(appUrl), {}, ctx, appUrl);
assert.equal(response.status, 200);
assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([82, 73, 70, 70]));
console.log("ok - public logo routes cap remote images before buffering");
