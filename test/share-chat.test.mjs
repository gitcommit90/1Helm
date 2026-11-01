// node --import ./test/stubs/register.mjs test/share-chat.test.mjs
// Shared chats (src/share.js, src/share-chat.js) through the REAL Worker routes: real Residents on node:sqlite, D1 on node:sqlite with migrations 025 and 083,
// a fake R2. Checks: the snapshot keeps only the chat (no steps, cards with buttons, hidden fields); the public page is static, answers before any sign-in and
// never reads the cookie; pictures are copied and served from the copy; tokens; a later message needs Update link; revoke, a deleted chat or channel and a
// missing copy are 404; one account cannot reach another account link.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { createHash } from "node:crypto"; import { readFileSync } from "node:fs";
import { Resident } from "../src/resident.js";
import { tokenHash, shareChatsGone } from "../src/share.js";
import { snapshotFromDetail, renderChatPage, renderMarkdown, sniffImage } from "../src/share-chat.js";
const { default: worker } = await import("../src/index.js");

const realNow = Date.now.bind(Date); let OFF = 0; Date.now = () => realNow() + OFF;
const sqlOf = (db) => ({ exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = db.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } });

// ---- D1 ----
const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT); CREATE TABLE sessions (token_hash TEXT, user_id TEXT, expires_at INTEGER);
  CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, owner_user_id TEXT, status TEXT, past_due_since INTEGER, onboarding_completed INTEGER, onboard_step TEXT, slug_chosen INTEGER, helper_name TEXT, helper_avatar INTEGER, helper_tone INTEGER, first_name TEXT, plan TEXT, host_ready INTEGER);
  CREATE TABLE resident_schedules (tenant_id TEXT, channel TEXT, channel_id TEXT, next_run INTEGER, updated_at INTEGER, PRIMARY KEY (tenant_id, channel));
  INSERT INTO users VALUES ('u1','sam@example.com'),('u2','eve@example.com');
  INSERT INTO tenants VALUES ('t1','ck1','u1','active',NULL,1,'',1,'Ollie',3,0,'Sam','plus',0),('t2','ck2','u2','active',NULL,1,'',1,'Ollie',3,0,'Eve','plus',0);`);
d1.exec(readFileSync(new URL("../db/migrations/0015_025_share.sql", import.meta.url), "utf8"));
d1.exec(readFileSync(new URL("../db/migrations/0067_share_chats.sql", import.meta.url), "utf8"));
for (const f of ["0001_012_full_schema_dev", "0006_017_cards", "0009_020_interview", "0020_029_storage"]) d1.exec(readFileSync(new URL(`../db/migrations/${f}.sql`, import.meta.url), "utf8"));   // what deleting a chat touches, and the storage counter
const sha = (s) => createHash("sha256").update(s).digest("hex");
d1.prepare("INSERT INTO sessions VALUES (?,?,?)").run(sha("aa11"), "u1", realNow() + 864e5 * 400);
d1.prepare("INSERT INTO sessions VALUES (?,?,?)").run(sha("bb22"), "u2", realNow() + 864e5 * 400);
const SQLS = [];
const DB = { prepare: (q) => { SQLS.push(q); const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return o; } };

// ---- fake R2 (get with onlyIf / range, head, put, delete, list) ----
const R2 = new Map(); let etagN = 0;
const toBytes = async (v) => v == null ? new Uint8Array(0) : typeof v === "string" ? new TextEncoder().encode(v) : v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(await new Response(v).arrayBuffer());
const obj = (key, o, body) => ({ key, size: o.bytes.length, httpEtag: `"${o.etag}"`, etag: o.etag, httpMetadata: o.meta || {}, ...(body ? { body: new Response(body).body, arrayBuffer: async () => body.slice().buffer, text: async () => new TextDecoder().decode(body) } : {}) });
const WS = {
  async put(key, v, opts = {}) { R2.set(key, { bytes: await toBytes(v), etag: `e${++etagN}`, meta: opts.httpMetadata }); return {}; },
  async head(key) { const o = R2.get(key); return o ? obj(key, o) : null; },
  async get(key, opts = {}) {
    const o = R2.get(key); if (!o) return null; const h = opts.onlyIf instanceof Headers ? opts.onlyIf : null, rh = opts.range instanceof Headers ? opts.range : null;
    if (h?.get("if-none-match")?.replace(/"/g, "") === o.etag) return obj(key, o);
    const m = rh?.get("range")?.match(/^bytes=(\d+)-(\d*)$/);
    if (m) { const a = Number(m[1]), b = m[2] ? Math.min(Number(m[2]), o.bytes.length - 1) : o.bytes.length - 1; return { ...obj(key, o, o.bytes.slice(a, b + 1)), size: o.bytes.length, range: { offset: a, length: b - a + 1 } }; }
    return obj(key, o, o.bytes);
  },
  async delete(keys) { for (const k of [].concat(keys)) R2.delete(k); },
  async list({ prefix = "", limit = 1000 } = {}) { const ks = [...R2.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit); return { objects: ks.map((k) => ({ key: k })), truncated: false }; },
};
const r2Under = (p) => [...R2.keys()].filter((k) => k.startsWith(p));

// ---- fake channel computer: an in-memory /workspace ----
const FS = new Map();   // path relative to /workspace → bytes
const unq = (s) => s.replace(/^'|'$/g, "").replace(/'\\''/g, "'");
const computer = {
  execs: [],
  async exec(cmd) {
    this.execs.push(cmd);
    let m = cmd.match(/^stat -L -c '%F' -- ('(?:[^']|'\\'')*')$/);
    if (m) { const p = unq(m[1]); if (FS.has(p)) return { code: 0, out: "regular file\n" }; if ([...FS.keys()].some((k) => k.startsWith(p + "/"))) return { code: 0, out: "directory\n" }; return { code: 1, out: "stat: cannot stat" }; }
    m = cmd.match(/^cd -- ('(?:[^']|'\\'')*') && test -f index\.html && find .* \| head -n (\d+)$/);
    if (m) { const d = unq(m[1]), pre = d === "." ? "" : d + "/"; if (!FS.has(pre + "index.html")) return { code: 1, out: "" };
      const rows = [...FS.keys()].filter((k) => k.startsWith(pre)).map((k) => k.slice(pre.length)).filter((r) => !r.split("/").some((s) => s.startsWith(".") || s === "node_modules")).sort();
      return { code: 0, out: rows.slice(0, Number(m[2])).map((r) => `${FS.get(pre + r).length}\t${r}`).join("\n") + "\n" }; }
    return { code: 127, out: "unexpected command" };
  },
  async fileToR2(path, key, max) { const b = FS.get(path); if (!b) return { ok: false, error: `no such file: ${path}` }; if (b.length > max) return { ok: false, error: "too big" }; await WS.put(key, b); return { ok: true, bytes: b.length }; },
};
const put = (p, s) => FS.set(p, typeof s === "string" ? new TextEncoder().encode(s) : s);

// ---- env: Residents per channel ----
const dos = new Map(); let script = []; let FINAL = "Ready for you.";
const VAULT_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 7)).toString("base64");
const env = { DB, WS, VAULT_KEY, APP_HOST: "app.example.test", PUBLIC_BASE_DOMAIN: "1helm.com", GATEWAY_HOST: "app.example.test", ENV_NAME: "dev", MODEL: "@cf/test/model", MEMORY: "off", GENUI: "off", WORKMEM: "off", TEST_MODE: "1",
  RESIDENT: { idFromName: (n) => n, get: (n) => { if (!dos.has(n)) { const db = new DatabaseSync(":memory:"); const R = new Resident({ storage: { sql: sqlOf(db), getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: () => {} }, env);
    R.systemPrompt = async () => "SYSTEM"; R.computer = () => computer; R.syncFiles = async () => {}; R.db = db;
    R.callModel = async (messages, _w, onText, noTools) => { if (noTools) return { content: "- notes", calls: [], inTok: 1, cached: 0, outTok: 1, charge: 0, finish: "stop" };
      const step = messages.some((m) => m.role === "tool") ? null : script.shift();
      if (step?.tool) return { content: "", calls: [{ id: "c1", type: "function", function: { name: step.tool, arguments: JSON.stringify(step.args) } }], inTok: 10, cached: 0, outTok: 3, charge: 0, finish: "tool_calls" };
      onText?.(FINAL); return { content: FINAL, calls: [], inTok: 10, cached: 0, outTok: 3, charge: 0, finish: "stop" }; };
    const [, tid, slug] = n.split(":"); R.bind(tid, slug, slug === "main" ? "1" : "2", "America/Los_Angeles"); dos.set(n, R); } return dos.get(n); } },
  ARCHIVE: { idFromName: (n) => n, get: () => ({ channels: async () => [{ id: 1, slug: "main", name: "General" }, { id: 2, slug: "trips", name: "Trips" }] }) },
  LEDGER: { idFromName: (n) => n, get: () => new Proxy({}, { get: (_, k) => k === "then" ? undefined : k === "state" ? async () => ({ balance_nano: 1e12, spent_nano: 0, granted_nano: 1e12 }) : async () => ({ ok: true }) }) },
};
const res = (slug = "main", tid = "t1") => env.RESIDENT.get(`res:${tid}:${slug}`);
const fetchW = (url, init = {}) => worker.fetch(new Request(url, init), env, { waitUntil() {} });
const api = async (path, body, { cookie = "hc_session=aa11", slug = "ck1", headers = {} } = {}) => {
  const r = await fetchW(`https://app.example.test/w/${slug}/api${path}`, { method: body === undefined ? "GET" : "POST", headers: { cookie, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const get = (url, headers = {}) => fetchW(url, { headers });
const addLib = async (name, bytes, mime, slug = "main", tid = "t1") => {
  const id = crypto.randomUUID(), r2key = `t/${tid}/files/${slug}/${id}`; await WS.put(r2key, bytes);
  return (await res(slug, tid).addUpload(tid, slug, slug === "main" ? "1" : "2", { id, name, mime, bytes: (await toBytes(bytes)).length, r2key })); };
const pathOf = (u) => u.replace("https://app.example.test", "");
let passed = 0; const ok = (name) => { passed++; console.log("  ok", name); };

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137]);
const SVG = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
const FAKE_PNG = new TextEncoder().encode("this is not a picture, whatever the file name says");
const rowsOf = (sql, ...a) => d1.prepare(sql).all(...a);
const tokenOf = (url) => url.split("/c/")[1].split("/")[0];
const CHAT_HEADERS = (r) => { assert.match(r.headers.get("content-type"), /^text\/html; charset=utf-8/); assert.match(r.headers.get("cache-control"), /^private/); assert.match(r.headers.get("x-robots-tag"), /noindex/);
  assert.equal(r.headers.get("referrer-policy"), "no-referrer"); assert.equal(r.headers.get("x-content-type-options"), "nosniff"); assert.equal(r.headers.get("set-cookie"), null);
  const csp = r.headers.get("content-security-policy"); assert.match(csp, /default-src 'none'/); assert.doesNotMatch(csp, /script-src|unsafe-eval/); assert.match(csp, /frame-ancestors 'none'/); };

// ================= the snapshot (pure) =================
{
  const detail = { session: { title: "Trip", system_prompt: "SECRET-PROMPT", model: "secret/model" }, turns: [
    // a normal turn: narration (a progress part), then the answer; steps, cost, trace and tool calls must not travel
    { id: "a1", kind: "chat", at: 1000, total_ms: 500, msgs: [{ id: "m1", text: "Plan Kyoto", at: 1000, files: [], reaction: "like", cid: "c1", via: "app" }], user_text: "Plan Kyoto",
      parts: ["Let me check.", "Here is **the plan**."], progress: [0], reply: "Here is **the plan**.", steps: [{ tool: "web_search", line: "SECRET-STEP", saved: ["SECRET-MEMORY"] }], tool_calls: 4, charge_nano: 12345, trace: "SECRET-TRACE", error: null,
      offers: [{ id: "o1", kind: "page", title: "Publish SECRET-OFFER?" }], interviews: [{ id: "i1" }], input_request: { question: "SECRET-QUESTION" }, deck_styles: true, images: [], shared: [] },
    // a card reply (Say/Tip components) becomes its plain text; a permission-like card keeps no buttons
    { id: "a2", kind: "chat", at: 2000, msgs: [{ id: "m2", text: "Any tips?", at: 2000, files: [{ id: "f1", name: "a.pdf", mime: "application/pdf", bytes: 10 }] }, { id: "m3", text: "Also one more thing", at: 2100, files: [] }],
      reply: 'root = Stack([a, b, c])\na = Say("Book early")\nb = Buttons([Button("Allow once", "allow"), Button("Deny", "deny")])\nc = Options("slot", [Option("Tuesday SECRET-OPTION")])', total_ms: 100 },
    { id: "a3", kind: "livenote", at: 3000, reply: "Meeting notes SECRET-LIVENOTE", msgs: [], total_ms: 1 },
    { id: "a4", kind: "chat", at: 4000, msgs: [{ id: "m4", text: "again", at: 4000, files: [] }], reply: "", error: "interrupted", total_ms: 1 },
    { id: "a5", kind: "chat", at: 5000, msgs: [{ id: "m5", text: "boom", at: 5000, files: [] }], reply: "", error: "SECRET-ERROR from the model host", total_ms: 1 },
    { id: "a6", kind: "followup", at: 6000, msgs: [], reply: "A scheduled check found nothing new.", total_ms: 1 },
  ] };
  const { messages } = snapshotFromDetail(detail), json = JSON.stringify(messages);
  assert.deepEqual(messages.map((m) => [m.role, m.text]), [
    ["user", "Plan Kyoto"], ["agent", "Here is **the plan**."], ["user", "Any tips?"], ["user", "Also one more thing"], ["agent", messages[4].text], ["user", "again"],
    ["agent", "1Helm restarted while I was working on this, so I stopped before replying. Send it again and I'll pick it back up."], ["user", "boom"], ["agent", "A scheduled check found nothing new."]]);
  assert.match(messages[4].text, /Book early/); assert.doesNotMatch(messages[4].text, /Allow once|Deny|Button|root =/);
  assert.deepEqual(messages.map((m) => m.at), [1000, 1500, 2000, 2100, 2100, 4000, 4001, 5000, 6001], "in order, with their times (a reply's time is its turn's start plus its duration)");
  assert.equal(messages[2].items[0].name, "a.pdf");
  for (const secret of ["SECRET", "Allow once", "Publish", "web_search", "12345", "like", "reaction", "cid"]) assert.ok(!json.includes(secret), `snapshot holds no ${secret}`);
  assert.ok(!/error/i.test(json.replace(/Send it again/g, "")), "an error text is never copied");
  ok("snapshotFromDetail keeps the person's messages and the helper's answers in order with times; steps, cost, trace, offers, cards with buttons, live notes, errors and hidden fields never travel");
}
{
  // markdown: the app's library, but raw HTML is text and only safe links and pictures stay
  const h = renderMarkdown('# Title\n\n**bold** `code` <script>alert(1)</script> <img src=x onerror=alert(1)> [ok](https://example.com/a?b=1&c=2) [bad](javascript:alert(1)) [rel](/w/ck1/app) <small>fine</small>\n\n![pic](https://example.com/p.png) ![local](/etc/passwd)\n\n```js\nconst a = "<b>";\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |');
  assert.doesNotMatch(h, /<script|<img src=x|<[^>]*onerror|href="javascript:|href=javascript:/i); assert.match(h, /&lt;script&gt;/); assert.match(h, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">ok<\/a>/);
  assert.match(h, / bad rel /); assert.doesNotMatch(h, /href="\/w\/ck1/); assert.match(h, /<small>fine<\/small>/); assert.match(h, /<strong>bold<\/strong>/); assert.match(h, /<span class="chat-code chat-code-inline"><code>code<\/code><\/span>/);
  assert.match(h, /<div class="chat-code chat-code-block"><pre><code class="language-js">const a = &quot;&lt;b&gt;&quot;;/); assert.match(h, /<table>/); assert.match(h, /chat-image-tile/); assert.doesNotMatch(h, /src="\/etc\/passwd"/);
  assert.equal(sniffImage(PNG), "image/png"); assert.equal(sniffImage(SVG), null); assert.equal(sniffImage(FAKE_PNG), null); assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), "image/jpeg");
  ok("markdown: scripts and event attributes are text, javascript: and relative links drop, only http(s) pictures draw, code and tables render; only png, jpeg, gif, webp and avif count as pictures (by their bytes)");
}
{
  const page = renderChatPage({ title: "A <b>title</b>", shared_at: Date.UTC(2026, 9, 31), messages: [
    { role: "user", at: Date.UTC(2026, 9, 30, 10), text: "hi <script>x</script>", items: [{ k: "file", name: "x<y>.pdf", mime: "application/pdf", bytes: 2048 }] },
    { role: "agent", at: Date.UTC(2026, 9, 30, 11), text: "hello", items: [{ k: "img", n: 0, name: "map.png", caption: "", bytes: 10 }, { k: "img", shot: true, n: 1, caption: "Kyoto weather", name: "" }] }] }, { base: "/s/ck1/c/TOK" });
  assert.doesNotMatch(page, /<script|<button|<form|<input|<textarea|<iframe|<video|<audio|onclick|href="\?dl/i, "no scripts, controls or links to files");
  assert.match(page, /<title>A &lt;b&gt;title&lt;\/b&gt;<\/title>/); assert.match(page, /Shared on Oct 31, 2026/); assert.match(page, /<time class="sch-day" datetime="2026-10-30">Oct 30, 2026<\/time>/);
  assert.match(page, /src="\/s\/ck1\/c\/TOK\/img\/0"/); assert.match(page, /<div class="shot"><img src="\/s\/ck1\/c\/TOK\/img\/1"[^>]*><span>Kyoto weather<\/span>/); assert.match(page, /x&lt;y&gt;\.pdf/);
  assert.match(page, /prefers-color-scheme:dark/); assert.match(page, /\.msgs\{/);
  ok("the page is static HTML: escaped title and text, day dividers, file tiles without links, pictures from the copy, light and dark");
}

// ================= through the real Worker =================
const lib = await addLib("Kyoto itinerary.pdf", "%PDF-1.4 kyoto", "application/pdf");
const S = (await res().createSession("Plan Kyoto")).id;
FINAL = "Here is the **plan**:\n\n- Day 1: Fushimi Inari\n- Day 2: Arashiyama\n\n```js\nconst days = 4;\n```\n\nSee [the guide](https://example.com/kyoto).";
script = [{ tool: "share_file_link", args: { file: "Kyoto itinerary.pdf", step_title: "SECRET-ARG-TITLE" } }];
await res().chat("t1", "main", "1", "plan 4 days in Kyoto", { session: S });
FINAL = "Second answer, longer.\n\nWith two paragraphs.";
await res().chat("t1", "main", "1", "make it longer", { session: S });
// attach pictures and a file to the first reply, as the app would show them
const sd = (await api(`/res/main/sessions/${S}`)).body, T1 = sd.turns[0].id;
assert.ok(sd.turns[0].offers?.length, "the turn has a card with buttons (it must stay out of the copy)");
const pngKey = "t/t1/shots/main/s1.jpg"; await WS.put(pngKey, PNG); res().db.prepare("INSERT INTO shots (id, at, turn, session, url, caption, r2key, bytes) VALUES (?,?,?,?,?,?,?,?)").run("shot1", realNow(), T1, S, "https://example.com/weather", "Kyoto weather", pngKey, PNG.length);
const pic = await addLib("map.png", PNG, "image/png"), svg = await addLib("logo.svg", SVG, "image/svg+xml"), fake = await addLib("fake.png", FAKE_PNG, "image/png"), doc = await addLib("budget.xlsx", "xlsx bytes", "application/vnd.ms-excel");
for (const f of [pic, svg, fake, doc]) res().db.prepare("UPDATE files SET turn=?, source='helper' WHERE id=?").run(T1, f.id);
let L;
{
  const r = await api("/share/chats", { channel: "main", session: S }); assert.equal(r.status, 200, JSON.stringify(r.body)); L = r.body.link;
  assert.match(L.url, /^https:\/\/app\.example\.test\/s\/ck1\/c\/[A-Za-z0-9_-]{43}$/); assert.equal(L.title, "Plan Kyoto"); assert.equal(L.session, S); assert.equal(r.body.existing, false);
  const again = await api("/share/chats", { channel: "main", session: S }); assert.equal(again.body.link.url, L.url); assert.equal(again.body.existing, true); assert.equal(rowsOf("SELECT * FROM share_chats").length, 1);
  const list = await api("/share"); assert.equal(list.body.chats.length, 1); assert.equal(list.body.chats[0].url, L.url);
  ok("Create link makes one link per chat at <address>/c/<token>; asking again returns it; the Library list shows it");
}
let page1;
{
  SQLS.length = 0;
  const g = await get(L.url, { cookie: "hc_session=aa11" }); assert.equal(g.status, 200); CHAT_HEADERS(g); page1 = await g.text();
  const anon = await get(L.url); assert.equal(anon.status, 200); assert.equal(await anon.text(), page1);
  const junk = await get(L.url, { cookie: "hc_session=garbage" }); assert.equal(junk.status, 200);
  assert.ok(!SQLS.some((q) => /\b(sessions|users|magic_links)\b/i.test(q)), `the public route never looks at sign-in tables: ${[...new Set(SQLS)].join(" | ")}`);
  const h = await fetchW(L.url, { method: "HEAD" }); assert.equal(h.status, 200); assert.equal(await h.text(), "");
  assert.equal((await fetchW(L.url, { method: "POST", body: "{}" })).status, 405);
  assert.doesNotMatch(page1, /DEV · test data|devstrip/, "no dev strip on the person's content");
  ok("the public page answers with no sign-in and never reads the cookie (no sign-in table is queried), with noindex, no-referrer, nosniff, private cache and a CSP without scripts");
}
{
  assert.match(page1, /<title>Plan Kyoto<\/title>/); assert.match(page1, /plan 4 days in Kyoto/); assert.match(page1, /make it longer/);
  assert.match(page1, /Here is the <strong>plan<\/strong>/); assert.match(page1, /<li>Day 1: Fushimi Inari<\/li>/); assert.match(page1, /<div class="chat-code chat-code-block"><pre><code class="language-js">const days = 4;/); assert.match(page1, /Second answer, longer/);
  assert.match(page1, /<a href="https:\/\/example\.com\/kyoto" target="_blank" rel="noopener noreferrer">the guide<\/a>/);
  for (const hidden of ["SYSTEM", "@cf/test/model", "share_file_link", "SECRET-ARG-TITLE", "Make a public link", "Create link", "Not now", "charge", "token", "step_title", "Ready for you", "tool_calls"]) assert.ok(!page1.includes(hidden), `the page holds no ${hidden}`);
  assert.doesNotMatch(page1, /<script|<button|<form|<input|<textarea|onclick/i);
  const order = ["plan 4 days in Kyoto", "Here is the", "make it longer", "Second answer"].map((x) => page1.indexOf(x)); assert.deepEqual([...order].sort((a, b) => a - b), order, "messages stay in order");
  ok("the page shows the chat the way the app does (markdown, code, links) and nothing else: no steps, cards, buttons, model name, prompt or tool arguments");
}
{
  // pictures: the screenshot and a real picture are copied and served; svg, a fake picture and other files are name tiles only
  const imgs = [...page1.matchAll(/src="(\/s\/ck1\/c\/[^"]+\/img\/\d+)"/g)].map((m) => m[1]); assert.equal(imgs.length, 2, imgs.join(","));
  for (const u of imgs) { const r = await get(`https://app.example.test${u}`); assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/png"); assert.equal(r.headers.get("x-content-type-options"), "nosniff"); assert.match(r.headers.get("cache-control"), /^private/);
    assert.equal(r.headers.get("set-cookie"), null); assert.equal(new Uint8Array(await r.arrayBuffer()).length, PNG.length); }
  assert.match(page1, /<div class="shot"><img[^>]*><span>Kyoto weather · example\.com<\/span>/);
  for (const name of ["logo.svg", "fake.png", "budget.xlsx"]) assert.match(page1, new RegExp(`chat-tile-name">${name.replace(".", "\\.")}<`), `${name} is a name tile`);
  assert.doesNotMatch(page1, /href="[^"]*(files|\?dl|download)/i, "no file link or download anywhere");
  const keys = r2Under(`t/t1/chats/${L.id}/`); assert.equal(keys.filter((k) => k.endsWith("/snapshot.json")).length, 1); assert.equal(keys.filter((k) => /\/img\/\d+$/.test(k)).length, 2);
  assert.equal((await get(`https://app.example.test/s/ck1/c/${tokenOf(L.url)}/img/9`)).status, 404); assert.equal((await get(`https://app.example.test/s/ck1/c/${tokenOf(L.url)}/img/0/../../x`)).status, 404);
  ok("pictures are copied into the snapshot and served from it (type from the bytes); svg, a file that is not a picture and other files show as name tiles with no link");
}
{
  // tokens
  const tok = tokenOf(L.url);
  assert.ok(!JSON.stringify(rowsOf("SELECT * FROM share_chats")).includes(tok), "token not in D1"); assert.equal(rowsOf("SELECT token_hash FROM share_chats")[0].token_hash, await tokenHash(tok));
  const flip = tok.slice(0, -1) + (tok.endsWith("A") ? "B" : "A");
  assert.equal((await get(`https://app.example.test/s/ck1/c/${flip}`)).status, 404); assert.equal((await get(`https://app.example.test/s/ck1/c/${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`)).status, 404);
  assert.notEqual((await get(`https://app.example.test/s/ck1/c/short`)).status, 200);
  assert.equal((await get(L.url.replace("/s/ck1/", "/s/ck2/"))).status, 404, "another person's address can't serve it"); assert.equal((await get(`https://ck2.1helm.com/s/ck1/c/${tok}`)).status, 404);
  assert.equal((await get(`https://ck1.1helm.com/c/${tok}`)).status, 200, "the person's own address serves it"); assert.equal((await get(`https://ck1.1helm.com/c/${tok}/img/0`)).status, 200);
  const other = await api("/share/chats", { channel: "main", session: S }, { cookie: "hc_session=bb22", slug: "ck2" }); assert.equal(other.status, 404, "someone else can't make a link to this chat");
  assert.equal((await api("/share/chats/" + L.id + "/revoke", {}, { cookie: "hc_session=bb22", slug: "ck2" })).status, 404, "or turn mine off"); assert.equal((await api("/share/chats/" + L.id + "/update", {}, { cookie: "hc_session=bb22", slug: "ck2" })).status, 404);
  assert.equal((await api("/share/chats", { channel: "nope", session: S })).status, 404); assert.equal((await api("/share/chats", { channel: "main", session: "not-an-id" })).status, 400);
  { const so = await fetchW("https://app.example.test/w/ck1/api/share/chats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "main", session: S }) }); assert.ok(so.status === 401 || so.status === 302, "signed out can't make one"); assert.doesNotMatch(await so.text(), /"link"/); }
  ok("the token is 256-bit and not stored; a changed or random token is 404; another address or person can't serve, make, update or revoke it; bad input and signed out are refused");
}
{
  // a snapshot, not live: a later message is not on the page until Update link, which keeps the address
  FINAL = "Third answer, added later."; await res().chat("t1", "main", "1", "one more question", { session: S });
  const before = await (await get(L.url)).text(); assert.doesNotMatch(before, /one more question|Third answer/);
  const old = r2Under(`t/t1/chats/${L.id}/`);
  const u = await api(`/share/chats/${L.id}/update`, {}); assert.equal(u.status, 200, JSON.stringify(u.body)); assert.equal(u.body.link.url, L.url, "same address"); assert.ok(u.body.link.updated_at >= L.updated_at);
  const after = await (await get(L.url)).text(); assert.match(after, /one more question/); assert.match(after, /Third answer, added later/);
  const now = r2Under(`t/t1/chats/${L.id}/`); assert.equal(new Set(now.map((k) => k.split("/")[4])).size, 1, "one version in R2"); assert.ok(!now.some((k) => old.includes(k)), "the old copy is gone");
  assert.equal(rowsOf("SELECT * FROM share_chats").length, 1);
  ok("later messages are not on the page until Update link; Update link replaces the copy at the same address and drops the old one");
}
{
  // revoke: 404 at once, the copy is gone, and a new link is a new address
  const rv = await api(`/share/chats/${L.id}/revoke`, {}); assert.equal(rv.status, 200);
  assert.equal((await get(L.url)).status, 404); assert.equal((await get(L.url + "/img/0")).status, 404); assert.equal(r2Under(`t/t1/chats/${L.id}/`).length, 0); assert.equal(rowsOf("SELECT * FROM share_chats").length, 0);
  assert.equal((await api("/share")).body.chats.length, 0); assert.equal((await api(`/share/chats/${L.id}/revoke`, {})).status, 404);
  const n = (await api("/share/chats", { channel: "main", session: S })).body.link; assert.notEqual(n.url, L.url); assert.equal((await get(L.url)).status, 404); assert.equal((await get(n.url)).status, 200);
  L = n; ok("Delete link: the page and its pictures answer 404 at once, the copy leaves R2, and a new link has a new address");
}
{
  // deleting the chat deletes its link; a deleted channel too; an Update on a gone chat is a 404 and removes the link
  const S2 = (await res().createSession("Second chat")).id; FINAL = "ok"; await res().chat("t1", "main", "1", "hello there", { session: S2 });
  const l2 = (await api("/share/chats", { channel: "main", session: S2 })).body.link; assert.equal((await get(l2.url)).status, 200);
  const del = await fetchW(`https://app.example.test/w/ck1/api/res/main/sessions/${S2}/delete`, { method: "POST", headers: { cookie: "hc_session=aa11", "content-type": "application/json" }, body: "{}" });
  assert.equal(del.status, 200, await del.clone().text()); assert.equal((await get(l2.url)).status, 404); assert.equal(rowsOf("SELECT * FROM share_chats WHERE session=?", S2).length, 0); assert.equal(r2Under(`t/t1/chats/${l2.id}/`).length, 0);
  assert.equal((await get(L.url)).status, 200, "the other chat's link stays");
  const T = (await res("trips", "t1").createSession("Trip chat")).id; await res("trips", "t1").chat("t1", "trips", "2", "hi trips", { session: T });
  const lt = (await api("/share/chats", { channel: "trips", session: T })).body.link; assert.equal((await get(lt.url)).status, 200);
  assert.equal(await shareChatsGone(env, "t1", { channel: "trips" }), 1); assert.equal((await get(lt.url)).status, 404); assert.equal(r2Under(`t/t1/chats/${lt.id}/`).length, 0); assert.equal((await get(L.url)).status, 200, "another channel's link stays");
  // the chat is removed behind the link's back: Update says it is gone and takes the link down
  const S3 = (await res().createSession("Third chat")).id; await res().chat("t1", "main", "1", "bye", { session: S3 });
  const l3 = (await api("/share/chats", { channel: "main", session: S3 })).body.link; await res().removeSession(S3);
  const up = await api(`/share/chats/${l3.id}/update`, {}); assert.equal(up.status, 404); assert.equal((await get(l3.url)).status, 404); assert.equal(rowsOf("SELECT * FROM share_chats WHERE id=?", l3.id).length, 0);
  ok("deleting a chat or a channel deletes its links and copies (404 at once); Update on a chat that is gone says so and removes the link");
}
{
  // a link whose copy is missing is 404 and cleans itself up; the account's own list never shows another account's links
  for (const k of r2Under(`t/t1/chats/${L.id}/`)) R2.delete(k);
  assert.equal((await get(L.url)).status, 404); assert.equal(rowsOf("SELECT * FROM share_chats WHERE id=?", L.id).length, 0);
  assert.equal((await api("/share", undefined, { cookie: "hc_session=bb22", slug: "ck2" })).body.chats.length, 0);
  ok("a link whose copy is gone is 404 and is removed; each account's list holds only its own links");
}
console.log(`share-chat: ${passed} groups passed`);
