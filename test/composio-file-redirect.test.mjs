import assert from "node:assert/strict";
import { fetchFile } from "../src/ee/composio-files.js";
import { managedTransport } from "../src/ee/composio-transport.js";

const store = "https://bucket.s3.amazonaws.com";
const otherStore = "https://storage.googleapis.com";
const calls = [];
let uploadUrl = `${store}/upload`;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  calls.push({ url, method: init.method || "GET", redirect: init.redirect });
  if (url.endsWith("/files/upload/request")) return Response.json({ key: "staged/file", new_presigned_url: uploadUrl });
  if (url === `${store}/download`) return new Response(null, { status: 302, headers: { location: `${otherStore}/file` } });
  if (url === `${store}/private`) return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
  if (url === `${store}/upload`) return new Response(null, { status: 307, headers: { location: `${otherStore}/upload` } });
  if (url === `${store}/upload-private`) return new Response(null, { status: 307, headers: { location: "https://evil.example/upload" } });
  if (url === `${otherStore}/file`) return new Response("safe file", { headers: { "content-type": "text/plain" } });
  if (url === `${otherStore}/upload`) return new Response(null, { status: 200 });
  throw new Error(`unexpected fetch: ${url}`);
};

const get = await fetchFile(`${store}/download`);
assert.equal(new TextDecoder().decode(get.bytes), "safe file", "a redirect between approved stores succeeds");
assert.deepEqual(calls.slice(-2).map((x) => x.url), [`${store}/download`, `${otherStore}/file`]);
assert.ok(calls.slice(-2).every((x) => x.redirect === "manual"), "the runtime cannot follow file redirects before validation");

calls.length = 0;
const badGet = await fetchFile(`${store}/private`);
assert.match(badGet.error, /file store|download failed/i);
assert.deepEqual(calls.map((x) => x.url), [`${store}/private`], "private redirect target is never fetched");

const transport = managedTransport({ COMPOSIO_KEY: "fixture" }, "tenant");
const file = { toolkit: "gmail", tool: "GMAIL_SEND_EMAIL", name: "note.txt", mimetype: "text/plain", bytes: new TextEncoder().encode("private note"), md5: "fixture" };
calls.length = 0;
assert.equal((await transport.stageFile(file)).s3key, "staged/file");
assert.deepEqual(calls.filter((x) => x.method === "PUT").map((x) => x.url), [`${store}/upload`, `${otherStore}/upload`]);
assert.ok(calls.filter((x) => x.method === "PUT").every((x) => x.redirect === "manual"), "upload redirects are validated before sending file bytes");

calls.length = 0;
uploadUrl = "https://evil.example/upload";
await assert.rejects(transport.stageFile(file), /file store|address/i);
assert.equal(calls.some((x) => x.url.startsWith("https://evil.example")), false, "an arbitrary HTTPS upload host receives no file bytes");

calls.length = 0;
uploadUrl = `${store}/upload-private`;
await assert.rejects(transport.stageFile(file), /file store|address/i);
assert.deepEqual(calls.filter((x) => x.method === "PUT").map((x) => x.url), [`${store}/upload-private`], "redirect to an arbitrary upload host receives no file bytes");

console.log("ok - connected-app file transfers validate initial and redirected storage hosts before reading or sending bytes");
