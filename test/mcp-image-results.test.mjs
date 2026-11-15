// node --import ./test/stubs/register.mjs test/mcp-image-results.test.mjs
// An app result with an image in it (custom MCP server or Composio tool) reaches the channel as a saved file. Composio's MCP bridge returns
// the first content block of an MCP result as `data` (a bare Base64 string for an image block) and a structuredContent object as it is
// 1Helm saves any Base64 that decodes to a PNG, JPEG, GIF, WebP or PDF, or an
// MCP image block, to the Library (same limits as a file link), and keeps the untrusted wrapping of the text. Facts judged: the save hook got
// the right bytes, name and type, the result names the saved file and no longer holds the Base64, limits and refusals are plain.
import assert from "node:assert/strict"; import { readFileSync } from "node:fs";
import { Resident } from "../src/resident.js";   // first: the Resident's own import order
import { runAppTool } from "../src/ee/composio.js";
import { saveOutputs, APP_FILE_MAX, MAX_FILES_OUT } from "../src/ee/composio-files.js";

let n = 0; const ok = (name) => { n++; console.log(`ok ${n} - ${name}`); };
const FX = JSON.parse(readFileSync(new URL("./fixtures/composio-file-tools.json", import.meta.url), "utf8"));
const env = { COMPOSIO_KEY: "ak_FAKE_never_printed", COMPOSIO_TOOLKIT_VERSION: "latest", APP_HOST: "owner.example.com" };
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
const pngBytes = Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));
const b64 = (bytes) => { let s = ""; for (const x of bytes) s += String.fromCharCode(x); return btoa(s); };
const JPG = b64(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(7)]));
let saves = [];
const files = { save: async (f) => { saves.push(f); return { file: { id: `lib_${saves.length}`, name: f.name, bytes: f.bytes.byteLength } }; } };

// ---------- saveOutputs on the shapes Composio returns ----------
{
  saves = [];
  // image block alone: Composio puts the Base64 in `data`
  let o = await saveOutputs({ data: PNG }, { save: files.save });
  assert.equal(saves.length, 1); assert.deepEqual(saves[0].bytes, pngBytes); assert.equal(saves[0].mime, "image/png"); assert.match(saves[0].name, /\.png$/);
  assert.equal(o.data.data.file_id, "lib_1"); assert.ok(!JSON.stringify(o.data).includes(PNG), "the Base64 is gone from the result"); assert.equal(o.saved.length, 1);
  // structuredContent with an image field and a data URI
  saves = []; o = await saveOutputs({ image: PNG, mime: "image/png", label: "studio", uri: `data:image/jpeg;base64,${JPG}` }, { save: files.save });
  assert.equal(saves.length, 2); assert.equal(saves[1].mime, "image/jpeg"); assert.equal(o.data.label, "studio"); assert.equal(o.data.mime, "image/png");
  // an MCP image block, with its fields kept and its Base64 replaced
  saves = []; o = await saveOutputs({ content: [{ type: "text", text: "Studio PTZ" }, { type: "image", data: PNG, mimeType: "image/png" }] }, { save: files.save });
  assert.equal(saves.length, 1); assert.equal(o.data.content[0].text, "Studio PTZ"); assert.equal(o.data.content[1].type, "image"); assert.equal(o.data.content[1].file_id, "lib_1"); assert.equal(o.data.content[1].data, undefined);
  // a declared type the Library takes is used when the bytes have no known signature; unknown bytes and plain text are left alone
  saves = []; o = await saveOutputs({ a: "hello world ".repeat(20), b: "A".repeat(300), c: { type: "image", data: "AAAA".repeat(40), mimeType: "image/x-unknown" } }, { save: files.save });
  assert.equal(saves.length, 0, "text and unrecognised Base64 are not files"); assert.equal(o.data.a, "hello world ".repeat(20));
  ok("saveOutputs: bare Base64 image, structuredContent image, data URI and MCP image block are saved with the right bytes and type; text and unknown data are left as they are");
}

// ---------- limits and refusals ----------
{
  saves = []; const big = b64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(2000).fill(1)]));
  let o = await saveOutputs({ x: big }, { save: files.save, max: 1000 });
  assert.equal(saves.length, 0); assert.match(o.skipped[0].why, /over the .* limit/); assert.match(o.data.x, /NOT saved/);
  assert.ok(APP_FILE_MAX >= 25 * 1024 * 1024, "same cap as file links");
  saves = []; o = await saveOutputs({ list: Array.from({ length: MAX_FILES_OUT + 2 }, () => PNG) }, { save: files.save });
  assert.equal(saves.length, MAX_FILES_OUT); assert.equal(o.skipped.length, 2);
  saves = []; o = await saveOutputs({ x: PNG }, { save: async () => ({ error: "error: storage is full", full: true }) });
  assert.equal(o.full, "error: storage is full"); assert.match(o.data.x, /NOT saved/);
  o = await saveOutputs({ x: PNG }, {}); assert.match(o.skipped[0].why, /aren't saved from here/);
  ok("limits: over-size, more than the per-result count, full storage and no save hook are refused plainly and nothing is lost silently");
}

// ---------- app_run end to end (fake Composio): the result names the saved file and keeps the untrusted text path ----------
{
  let answer = null;
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u)); if (url.host !== "backend.composio.dev") throw new Error(`unexpected fetch ${u}`);
    const p = url.pathname.replace(/^\/api\/v3\.1/, ""), m = init.method || "GET", body = init.body ? JSON.parse(init.body) : null, x0 = p.match(/^\/(?:toolkits|tools)\/(\w+)$/);
    const j = (b, status = 200) => new Response(JSON.stringify(b), { status });
    if (p === "/connected_accounts" && m === "GET") return j({ items: [{ id: "ca_d1", user_id: "1hc:t1", status: "ACTIVE", alias: "sam@home.com", created_at: "2026-10-01T00:00:00Z", toolkit: { slug: "googledrive" } }] });
    if (x0 && p.startsWith("/toolkits/")) return j({ slug: x0[1], name: "Google Drive", composio_managed_auth_schemes: ["OAUTH2"], auth_config_details: [{ mode: "OAUTH2" }] });
    if (x0 && m === "GET") return FX[x0[1]] ? j(FX[x0[1]]) : j({ error: { message: "Tool not found" } }, 404);
    if (p === "/tools" && m === "GET") { const s = url.searchParams.get("tool_slugs"); return j({ items: s ? s.split(",").map((k) => FX[k]).filter(Boolean) : [] }); }
    if (p === "/tool_router/session" && m === "POST") return j({ session_id: "trs_1", tool_router_tools: [] });
    if (/^\/tool_router\/session\/trs_\w+$/.test(p)) return j({ session_id: "trs_1" });
    if (/^\/tools\/execute\/\w+$/.test(p)) return j({ successful: true, data: answer });
    return j({ error: { message: `no fake for ${m} ${p}` } }, 404);
  };
  const conns = [{ id: "ca_d1", app: "googledrive", name: "Google Drive", status: "connected", email: "sam@home.com", label: "sam@home.com", default: true, since: "2026-10-01" }];
  const run = () => runAppTool(env, "t1", "app_run", { action: "GOOGLEDRIVE_DOWNLOAD_FILE", arguments: { fileId: "1abc" } }, conns, { files });
  for (const shape of [{ data: PNG }, { image: PNG, mime: "image/png" }]) {
    saves = []; answer = shape; const r = await run();
    assert.equal(saves.length, 1, JSON.stringify(shape).slice(0, 30)); assert.deepEqual(saves[0].bytes, pngBytes);
    assert.match(r, /Saved "[^"]+\.png"/); assert.match(r, /read_file/); assert.match(r, /\/workspace\/files\/[^ ,]+\.png/); assert.ok(!r.includes(PNG), "no Base64 in what the helper reads");
  }
  saves = []; answer = { data: "Latest available live image for studio" }; const t = await run();
  assert.equal(saves.length, 0); assert.match(t, /Latest available live image for studio/);
  ok("app_run: an image in a Composio/MCP result is saved to the channel Library and named in the result (path, read_file hint), with no Base64 left; a text-only result is unchanged");
}
console.log(`${n} passed`);
