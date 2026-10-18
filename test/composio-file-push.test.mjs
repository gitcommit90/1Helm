// node --import ./test/stubs/register.mjs test/composio-file-push.test.mjs
// Pushing a whole file through app_run (GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS): Composio is faked at fetch. Checks only 1Helm's own behavior:
//   1. a large text input (600 KB, with quotes, newlines, emoji and script tags) reaches Composio byte for byte;
//   2. {"file_text": path} and {"file_base64": path} are replaced by the file's text / Base64 before the call, and bad references run nothing;
//   3. a computer path passed as the text itself is refused (GitHub kept the literal path as the page);
//   4. a Composio validation error keeps its field-level detail (suggested_fix, errors) in what the helper sees, and no key leaks.
import assert from "node:assert/strict";
import { Resident } from "../src/resident.js";   // first: the Resident's own import order
import { runAppTool } from "../src/ee/composio.js";
import { resolveFileRefs, pathAsContent, toBase64 } from "../src/ee/composio-files.js";
import { ERROR_MAX } from "../src/ee/composio-api.js";
const TAP = { confirm: async () => null };
let n = 0; const ok = (name) => { n++; console.log(`ok ${n} - ${name}`); };
const env = { COMPOSIO_KEY: "ak_FAKE_never_printed", COMPOSIO_TOOLKIT_VERSION: "latest", APP_HOST: "app.example.com" };
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const enc = (s) => new TextEncoder().encode(s);

const GH = { slug: "GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS", name: "Create or update file contents", description: "x", version: "20261014_00", tags: [], toolkit: { slug: "github" },
  input_parameters: { type: "object", required: ["owner", "repo", "path", "message", "content"], properties: Object.fromEntries(["owner", "repo", "path", "message", "content", "branch", "sha"].map((k) => [k, { type: "string", description: k }])) } };
let reqs = [], failWith = null;
globalThis.fetch = async (u, init = {}) => {
  const url = new URL(String(u)), m = init.method || "GET";
  if (url.host !== "backend.composio.dev") throw new Error(`unexpected fetch ${u}`);
  const p = url.pathname.replace(/^\/api\/v3\.1/, ""), body = init.body ? JSON.parse(init.body) : null; reqs.push({ m, p, body });
  const j = (b, status = 200) => new Response(JSON.stringify(b), { status });
  let x;
  if (p === "/connected_accounts" && m === "GET") return j({ items: [{ id: "ca_h1", user_id: "1hc:t1", status: "ACTIVE", alias: "sam", created_at: "2026-10-01T00:00:00Z", toolkit: { slug: "github" } }] });
  if ((x = p.match(/^\/toolkits\/(\w+)$/))) return j({ slug: x[1], name: "GitHub", composio_managed_auth_schemes: ["OAUTH2"], auth_config_details: [{ mode: "OAUTH2" }] });
  if (p === `/tools/${GH.slug}` && m === "GET") return j(GH);
  if (p === "/tools" && m === "GET") return j({ items: [GH] });
  if (p === "/tool_router/session" && m === "POST") return j({ session_id: "trs_1", tool_router_tools: [] });
  if (/^\/tool_router\/session\/trs_\w+$/.test(p) && m === "PATCH") return j({ session_id: "trs_1" });
  if (/\/execute$|^\/tools\/execute\//.test(p)) { if (failWith) return j(failWith, 400); return j({ successful: true, data: { response_data: { content: { sha: "abc" } } } }); }
  return j({ error: { message: `no fake for ${m} ${p}` } }, 404);
};
const sent = () => reqs.filter((q) => /\/execute$|^\/tools\/execute\//.test(q.p)).map((q) => q.body.arguments);
const conns = [{ id: "ca_h1", app: "github", name: "GitHub", status: "connected", email: "sam", label: "sam", default: true, since: "2026-10-01" }];
const run = (files, args) => runAppTool(env, "t1", "app_run", { action: GH.slug, arguments: { owner: "o", repo: "r", path: "index.html", message: "m", ...args } }, conns, { ...TAP, files });
const noFiles = {};

// ---------- 1. a large text input arrives whole ----------
{
  reqs = []; failWith = null;
  const big = ("<!DOCTYPE html>\n<html><body><script>const s = \"quote\\\" \\n</script>\u00e9\u4e2d\u6587\ud83d\ude00 'x' & <b>y</b></body></html>\n").repeat(8000);
  assert.ok(big.length > 600000);
  const r = await run(noFiles, { content: big });
  assert.match(r, /GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS ok/, r.slice(0, 300));
  const a = sent(); assert.equal(a.length, 1); assert.equal(a[0].content, big, "the content reaches Composio unchanged");
  assert.equal(a[0].path, "index.html");
  ok("a 600 KB text input reaches Composio in one call, byte for byte");
}

// ---------- 2. file references ----------
{
  const html = "<!DOCTYPE html>\n<p>h\u00e9llo \ud83d\ude00</p>\n".repeat(400), bin = new Uint8Array([0xff, 0xfe, 0x00, 0x80, 0x41]);
  let reads = [];
  const files = { read: async (ref) => { reads.push(ref);
    if (ref === "/workspace/workspace/helpers/5/index.html") return { name: "index.html", mime: "text/html", bytes: enc(html) };
    if (ref === "logo.bin") return { name: "logo.bin", mime: "application/octet-stream", bytes: bin };
    return { error: `there's no "${ref}" in this channel's Library.` }; } };
  reqs = []; failWith = null;
  let r = await run(files, { content: { file_text: "/workspace/workspace/helpers/5/index.html" } });
  assert.match(r, /ok \(sent index\.html \(\d/, r.slice(0, 200)); assert.equal(sent()[0].content, html);
  ok("{file_text: path} is replaced by the file's text before the call");
  reqs = []; r = await run(files, { content: { file_base64: "logo.bin" } });
  assert.equal(sent()[0].content, Buffer.from(bin).toString("base64")); assert.equal(toBase64(bin), Buffer.from(bin).toString("base64"));
  ok("{file_base64: ref} is replaced by the file's Base64");
  reqs = []; r = await run(files, { content: { file_text: "logo.bin" } });
  assert.match(r, /isn't text.*file_base64.*Nothing was run/s); assert.equal(sent().length, 0);
  r = await run(files, { content: { file_text: "missing.txt" } }); assert.match(r, /no "missing.txt".*Nothing was run/s); assert.equal(sent().length, 0);
  r = await run(undefined, { content: { file_text: "logo.bin" } }); assert.match(r, /can't be read from here.*Nothing was run/s); assert.equal(sent().length, 0);
  const huge = { read: async () => ({ name: "big.txt", mime: "text/plain", bytes: new Uint8Array(3 * 1024 * 1024 + 1) }) };
  r = await run(huge, { content: { file_text: "big.txt" } }); assert.match(r, /at most 3\.0 MB|at most 3 MB/); assert.equal(sent().length, 0);
  ok("an unreadable, missing, non-text or oversized file runs nothing and says why");
  const nested = await resolveFileRefs({ a: [{ b: { file_text: "logo.bin" } }], c: { file_text: "x", other: 1 } }, async () => ({ name: "t", bytes: enc("T") }));
  assert.deepEqual(nested.args, { a: [{ b: "T" }], c: { file_text: "x", other: 1 } }); assert.equal(nested.used.length, 1);
  ok("references inside lists and objects are resolved; an object with other keys is left alone");
}

// ---------- 3. a path as the text ----------
{
  reqs = []; failWith = null;
  const r = await run({ read: async () => ({ error: "unused" }) }, { content: "/workspace/workspace/helpers/5/index.html" });
  assert.match(r, /computer path.*file_text.*Nothing was run/s, r.slice(0, 300)); assert.equal(sent().length, 0);
  assert.equal(pathAsContent({ content: "/workspace/a.html" }), "content"); assert.equal(pathAsContent({ content: "see /workspace/a.html now" }), null); assert.equal(pathAsContent({ path: "/workspace/a.html" }), null);
  ok("a lone /workspace path as content is refused with the file_text form; other strings and inputs are untouched");
}

// ---------- 3b. a required input left out ----
{
  reqs = []; failWith = null;
  const r = await runAppTool(env, "t1", "app_run", { action: GH.slug, arguments: { owner: "o", repo: "r", path: "index.html", message: "m", branch: "main" } }, conns, { ...TAP, files: noFiles });
  assert.match(r, /^error: .*needs "content".*nothing was run.*file_text/is, r.slice(0, 300)); assert.equal(sent().length, 0);
  ok("a call without a required input (content) is refused before Composio, naming it and the file_text form");
}

// ---------- 4. validation error detail ----------
{
  reqs = [];
  failWith = { error: { message: "Invalid request data provided", code: 1301, slug: "ActionExecute_InputValidation", status: 400, request_id: "r1",
    suggested_fix: "Following fields are missing: {'sha'}", errors: ["content: must be a string", { loc: ["author"], msg: "ak_FAKEKEY123456 bad" }] } };
  const r = await run(noFiles, { content: "hi" });
  assert.match(r, /^error: Invalid request data provided/); assert.match(r, /Following fields are missing: \{'sha'\}/); assert.match(r, /content: must be a string/);
  assert.ok(!/ak_FAKE/.test(r), "key-shaped text is cut"); assert.ok(r.length < ERROR_MAX + 20);
  ok("a Composio validation error keeps suggested_fix and errors for the helper, with key-shaped text removed");
  failWith = { error: { message: "x".repeat(2000) } };
  const r2 = await run(noFiles, { content: "hi" }); assert.ok(r2.length <= ERROR_MAX + 20);
  ok("an error stays within ERROR_MAX characters");
}
console.log(`${n} checks passed`);
