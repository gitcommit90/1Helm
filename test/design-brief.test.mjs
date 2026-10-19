// node --import ./test/stubs/register.mjs test/design-brief.test.mjs
// The design brief that 1Helm runs itself (src/design-brief.js, wired in Resident.execComputerTool): the first .html written in a task gets the
// brief appended to the write's result, once per task, for Primary and for helpers (classic and native worker), and never changes a result when
// the Worker fails. The trigger is the file type only. The Worker call is faked at fetch; nothing here depends on a model.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { Resident } from "../src/resident.js";
import { writesDesignFile, briefDescription, fetchBrief, briefForWrite, BRIEF_HEADER, BRIEF_TRIES, briefUrl } from "../src/design-brief.js";
import { transactionSyncFor } from "./helpers/transaction-sync.mjs";

const ok = (m) => console.log("  ok", m);
const BRIEF = "DESIGN BRIEF for: sushi\n\nSTARTING TOKENS\n:root{\n  --color-1: #b4fc04;\n}";

let fetched = [], mode = "ok";
globalThis.fetch = async (url, init = {}) => {
  fetched.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
  if (mode === "fail") return new Response("boom", { status: 500 });
  if (mode === "throw") throw new Error("network down");
  if (mode === "hang") return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))));
  if (mode === "rpc-error") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text: "nope" }] } }));
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: BRIEF }] } }), { headers: { "content-type": "application/json" } });
};

// ---- the Resident on node:sqlite with a stub computer ----
const dodb = new DatabaseSync(":memory:");
const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)|\bRETURNING\b/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
const ctx = { id: { toString: () => "do-brief-test-000000000000" }, storage: { sql, transactionSync: transactionSyncFor(dodb), getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: () => {} };
const computer = { execs: [], exec: async (cmd) => { computer.execs.push(cmd); return { code: 0, out: "wrote 10 bytes" }; }, warm: async () => ({ ok: true }), save: async () => ({}), touch: async () => {}, stop: async () => {} };
const BASE_URL = "https://design.example", BRIEF_URL = BASE_URL + "/brief/mcp";
const R = new Resident(ctx, { MEMORY: "off", GENUI: "off", WORKMEM: "off", MODEL: "@cf/test/model", DESIGN_MCP_URL: BASE_URL });
R.computer = () => computer; R.syncFiles = async () => {};
R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1");

const chat = (session, text = "a single page html site for a restaurant run by 2 fish") => ({ kind: "chat", session, userText: text, inTool: 0, callNo: 3 });
const write = (tc, path = "/workspace/workspace/fish/.src/page.html") => R.execComputerTool("write_file", { path, content: "<html></html>" }, tc);

// 1. Pure: the trigger is the file type only.
{
  const r0 = { code: 0, out: "x" };
  for (const p of ["a.html", "/w/b.HTM", "/w/.src/slides/cover.html"]) assert.equal(writesDesignFile("write_file", { path: p }, r0), true, p);
  assert.equal(writesDesignFile("edit_file", { path: "/w/page.html" }, r0), true);
  for (const p of ["notes.txt", "build.py", "style.css", "page.html.bak", "data.json", ""]) assert.equal(writesDesignFile("write_file", { path: p }, r0), false, p);
  assert.equal(writesDesignFile("write_file", { path: "a.html" }, { code: 1, out: "" }), false, "a failed write triggers nothing");
  assert.equal(writesDesignFile("read_file", { path: "a.html" }, r0), false);
  assert.equal(writesDesignFile("run_command", { command: "cat <<'EOF' > /w/index.html\n<html/>\nEOF" }, r0), true);
  assert.equal(writesDesignFile("run_command", { command: "python3 -c \"open('/w/p.html','w').write('x')\"" }, r0), true);
  assert.equal(writesDesignFile("run_command", { command: "echo hi | tee out.html" }, r0), true);
  assert.equal(writesDesignFile("run_command", { command: "cat page.html | wc -c" }, r0), false);
  assert.equal(writesDesignFile("run_command", { command: "ls -la && bash make_pdf.sh /w/fish" }, r0), false);
  assert.equal(briefDescription({ userText: "  make   a site " }), "make a site");
  assert.equal(briefDescription({ helper: { name: "Fish site", task: "Build the page" } }), "Fish site: Build the page");
  assert.equal(briefDescription({ context: { userText: "from context" }, userText: "x" }), "from context");
  ok("trigger is the file type: .html and .htm writes and edits, a command writing an .html; not .txt, .py, .css, reads or failed writes");
}

// 2. Primary: the first .html write carries the brief with the header; the second does not; the person's text goes to the Worker as the description.
{
  fetched = []; const tc = chat("s1");
  const r1 = await write(tc);
  assert.equal(r1.code, 0); assert.ok(r1.out.startsWith("wrote 10 bytes"), "the write's own result comes first");
  assert.ok(r1.out.includes(BRIEF_HEADER) && r1.out.includes(BRIEF) && r1.out.includes("--color-1: #b4fc04"), "header and brief appended");
  assert.equal(fetched.length, 1); assert.equal(fetched[0].url, BRIEF_URL);
  assert.equal(fetched[0].body.method, "tools/call"); assert.equal(fetched[0].body.params.name, "design_brief");
  assert.equal(fetched[0].body.params.arguments.description, "a single page html site for a restaurant run by 2 fish");
  assert.equal(tc.designBrief.tool, "write_file"); assert.equal(tc.designBrief.step, 3);
  const r2 = await write(tc); assert.equal(r2.out, "wrote 10 bytes", "a second write in the task adds nothing");
  const r3 = await R.execComputerTool("edit_file", { path: "/w/page.html", old: "a", new: "b" }, tc); assert.ok(!r3.out.includes(BRIEF), "nor an edit");
  assert.equal(fetched.length, 1, "one Worker call for the task");
  assert.equal(dodb.prepare("SELECT done FROM design_briefs WHERE session='s1'").get().done, 1, "stored, so a restart does not repeat it");
  const again = await write(chat("s1")); assert.ok(!again.out.includes(BRIEF) && fetched.length === 1, "a new turn in the same task does not repeat it");
  const other = await write(chat("s2")); assert.ok(other.out.includes(BRIEF), "another task gets its own"); assert.equal(fetched.length, 2);
  ok("Primary: first .html write gets the header and brief once per task; stored per task; another task gets its own");
}

// 3. Non-design files trigger nothing, and no call is made.
{
  fetched = []; const tc = chat("s3");
  for (const p of ["/w/notes.txt", "/w/build.py", "/w/style.css"]) { const r = await write(tc, p); assert.equal(r.out, "wrote 10 bytes", p); }
  assert.equal((await R.execComputerTool("run_command", { command: "ls" }, tc)).out, "wrote 10 bytes");
  assert.equal(fetched.length, 0); assert.equal(dodb.prepare("SELECT COUNT(*) AS n FROM design_briefs WHERE session='s3'").get().n, 0);
  const viaCmd = await R.execComputerTool("run_command", { command: "cat > /w/site.html <<'EOF'\n<p/>\nEOF" }, tc);
  assert.ok(viaCmd.out.includes(BRIEF), "a command that creates an .html file counts as the first write"); assert.equal(fetched.length, 1);
  ok("a .txt, .py, .css write and a plain command call nothing; a command that writes an .html does");
}

// 4. A failing Worker (HTTP error, thrown, error result, timeout) leaves the result unchanged and says nothing; it is tried again, at most BRIEF_TRIES times.
{
  for (const m of ["fail", "throw", "rpc-error"]) {
    mode = m; fetched = []; const s = "fail-" + m, tc = chat(s);
    const r = await write(tc); assert.equal(r.out, "wrote 10 bytes", `${m}: result unchanged`); assert.equal(r.code, 0);
    assert.equal(tc.designBrief, undefined);
    for (let i = 1; i < BRIEF_TRIES + 2; i++) await write(tc);
    assert.equal(fetched.length, BRIEF_TRIES, `${m}: tried ${BRIEF_TRIES} times then stopped`);
    mode = "ok"; assert.equal((await write(tc)).out, "wrote 10 bytes", "after the tries are used up it stays quiet");
  }
  mode = "ok"; const s = "retry", tc = chat(s); mode = "fail"; await write(tc); mode = "ok";
  assert.ok((await write(tc)).out.includes(BRIEF), "a failed first try is retried on the next write and then succeeds");
  const t0 = Date.now(); mode = "hang";
  assert.equal(await fetchBrief("x", { url: BRIEF_URL, ms: 60 }), ""); assert.ok(Date.now() - t0 < 1500, "the call is cut off at its time limit");
  mode = "ok";
  ok("Worker failure (500, network error, error result, hang): the write result is unchanged, nothing is said, retried at most twice");
}

// 5. Helpers get it too: a classic helper and a native worker, keyed by the task they belong to, with the job text as the description.
{
  fetched = [];
  const classic = { kind: "helper", session: "h1", helper: { id: 11, name: "Fish page", task: "Build a one page site for a fish restaurant", dynamic_routing: 0 } };
  classic.session = "h1";
  const r = await write(classic);
  assert.ok(r.out.includes(BRIEF_HEADER) && r.out.includes(BRIEF), "classic helper gets the brief");
  assert.equal(fetched[0].body.params.arguments.description, "Fish page: Build a one page site for a fish restaurant");
  const native = { kind: "helper", session: "h2", helper: { id: 12, name: "Native fish", task: "Make the page", dynamic_routing: 1 } };
  const r2 = await write(native, "/workspace/workspace/helpers/12/page.html");
  assert.ok(r2.out.includes(BRIEF), "native worker gets the brief too");
  assert.match(computer.execs.at(-1), /helpers\/12\/page\.html/, "the worker still wrote into its own folder");
  const r3 = await write({ ...native }, "/workspace/workspace/helpers/12/page2.html"); assert.ok(!r3.out.includes(BRIEF), "once per task for helpers too");
  const prim = chat("h1"); assert.ok(!(await write(prim)).out.includes(BRIEF), "Primary in the same task does not get a second brief after its helper did");
  ok("classic helper and native worker get the brief (job text as description); the task still gets only one");
}

// 6. Wiring: both engines reach the same hook, and Primary's guidance names the command.
{
  const resident = readFileSync(new URL("../src/resident.js", import.meta.url), "utf8");
  assert.match(resident, /async execComputerTool\([^)]*\)[\s\S]{0,2200}briefForWrite\(this, name, a, r, tc\)/, "the hook lives in execComputerTool");
  const pi = readFileSync(new URL("../src/pi-engine.js", import.meta.url), "utf8");
  assert.match(pi, /res\.execComputerTool\(t\.function\.name, params, tc\)/, "the pi engine calls execComputerTool");
  assert.match(resident, /this\.runTool\(xcall, tc\)[\s\S]{0,10}|execComputerTool\(call\.function\.name, a, ctx\)/, "the classic engine's runTool calls execComputerTool");
  ok("both engines run write tools through execComputerTool, where the brief is appended");
}
// 7. Public edition: the brief runs only when DESIGN_MCP_URL is set and not empty (then <base>/brief/mcp); unset or empty means no call at all.
{
  assert.equal(briefUrl({}), ""); assert.equal(briefUrl({ DESIGN_MCP_URL: "" }), ""); assert.equal(briefUrl({ DESIGN_MCP_URL: "  " }), ""); assert.equal(briefUrl(undefined), "");
  assert.equal(briefUrl({ DESIGN_MCP_URL: "https://design.example/" }), "https://design.example/brief/mcp");
  assert.equal(await fetchBrief("x"), "", "no url, no call");
  const html = { code: 0, out: "wrote" }, tc = { session: "s-nocfg", userText: "a sushi site", callNo: 1 };
  for (const [label, env] of [["unset", {}], ["empty", { DESIGN_MCP_URL: "" }]]) {
    fetched = []; mode = "ok";
    const Q = Object.create(R); Q.env = env;
    assert.equal(await briefForWrite(Q, "write_file", { path: "/workspace/files/a.html" }, html, { ...tc, session: "s-" + label }), "", `${label}: the write result is unchanged`);
    assert.equal(fetched.length, 0, `${label}: no network call`);
  }
  fetched = []; mode = "ok";
  const out = await briefForWrite(R, "write_file", { path: "/workspace/files/a.html" }, html, { ...tc, session: "s-set" });
  assert.match(out, /DESIGN BRIEF for: sushi/); assert.equal(fetched.length, 1); assert.equal(fetched[0].url, BRIEF_URL, "set: called at <base>/brief/mcp");
  ok("DESIGN_MCP_URL set: the brief is fetched from <base>/brief/mcp; unset or empty: no call and the write result is unchanged");
}
console.log("design-brief.test.mjs: all ok");
