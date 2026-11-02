// node --import ./test/stubs/register.mjs test/share-text-viewer.test.mjs
// A file link opened in a browser: Markdown and other text files are drawn on the server inside the viewer page (no iframe). Markdown goes through the
// safe renderer (raw HTML escaped, unsafe links dropped), other text is escaped, only the first 1 MB is drawn with a note, and raw and download are unchanged.
// serveLink runs with stand-ins for D1, R2 and the Resident; no network and no model calls.
import assert from "node:assert/strict";
import { serveLink, tokenHash, VIEW_TEXT_MAX } from "../src/share.js";

const TOKEN = "A".repeat(43), tenant = { id: "t1" }, files = new Map(), deleted = [];
const link = { id: "l1", token_hash: await tokenHash(TOKEN), tenant_id: "t1", channel: "main", file_id: "f1", expires_at: null };
const env = {
  DB: { prepare: (q) => { let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => (a[0] === link.token_hash ? link : null), run: async () => { deleted.push(q); return {}; } }; return o; } },
  RESIDENT: { idFromName: (n) => n, get: () => ({ fileRow: async () => files.get("f1") || null }) },
  WS: {
    head: async (k) => (files.get("f1")?.r2key === k ? {} : null),
    get: async (k, opts = {}) => {
      const f = files.get("f1"); if (!f || f.r2key !== k) return null;
      const all = f.body, r = opts.range && Number.isInteger(opts.range.offset) ? opts.range : null, bytes = r ? all.slice(r.offset, r.offset + r.length) : all;
      return { size: all.length, httpEtag: '"e"', body: new Response(bytes).body, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
    },
  },
};
const nav = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" };
const view = async (name, text, mime, qs = "", headers = nav) => {
  const body = new TextEncoder().encode(text);
  files.set("f1", { r2key: "t/t1/files/main/f1", name, mime, bytes: body.length, body });
  const res = await serveLink(new Request(`https://app.example.test/s/x/f/${TOKEN}/x${qs}`, { headers }), env, tenant, TOKEN);
  return { res, html: await res.clone().text() };
};

const md = await view("notes.md", "# Meeting notes\n\n## Decisions\n\n- Ship **Friday**\n- [site](https://example.com) [bad](javascript:alert(1))\n\n<script>alert(1)</script> <img src=x onerror=alert(1)>\n", "text/markdown");
assert.equal(md.res.status, 200);
assert.match(md.html, /<h1>Meeting notes<\/h1>/); assert.match(md.html, /<h2>Decisions<\/h2>/); assert.match(md.html, /<strong>Friday<\/strong>/); assert.doesNotMatch(md.html, /<iframe/);
assert.match(md.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/); assert.doesNotMatch(md.html, /<script|<img src=x|href="javascript:/i); assert.match(md.html, /href="\?dl=1" download>Download</);
const csp = md.res.headers.get("content-security-policy"); assert.match(csp, /default-src 'none'/); assert.doesNotMatch(csp, /script-src|unsafe-eval/);
const raw = await view("notes.md", "# Meeting notes", "text/markdown", "?raw=1", { "sec-fetch-dest": "iframe" }); assert.match(raw.res.headers.get("content-type"), /^text\/markdown/); assert.match(raw.res.headers.get("content-security-policy"), /sandbox/);
const dl = await view("notes.md", "# Meeting notes", "text/markdown", "?dl=1"); assert.match(dl.res.headers.get("content-disposition"), /^attachment/);
const txt = await view("a.txt", "plain <b>text</b> & more\nline 2", "text/plain"); assert.match(txt.html, /<pre class="txt">plain &lt;b&gt;text&lt;\/b&gt; &amp; more\nline 2<\/pre>/); assert.doesNotMatch(txt.html, /<iframe|<b>text/);
const csv = await view("t.csv", "a,b\n<i>1</i>,2\n", "text/csv"); assert.match(csv.html, /<pre class="txt">a,b\n&lt;i&gt;1&lt;\/i&gt;,2\n<\/pre>/); assert.doesNotMatch(csv.html, /<iframe/);
const big = await view("big.txt", "x".repeat(VIEW_TEXT_MAX) + "TAIL-PAST-CAP", "text/plain"); assert.ok(!big.html.includes("TAIL-PAST-CAP")); assert.match(big.html, /The rest of this file is in the download/); assert.ok(big.html.length < VIEW_TEXT_MAX + 20000);
const small = await view("s.txt", "short", "text/plain"); assert.doesNotMatch(small.html, /The rest of this file/);
const img = await view("p.png", "png", "image/png"); assert.match(img.html, /<img src="\?raw=1"/);
console.log("ok share text viewer");
