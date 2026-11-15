// node --import ./test/stubs/register.mjs test/browser-exit-retry.test.mjs
// Retry through the exit node, on the computer's side: browser_navigate with via_exit_node is refused while the setting is off, reaches the browser service
// while it is on, and the conf file the browser service reads carries the retry flag and the node's name. No network and no model calls.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ChannelComputer } from "../src/channel-computer.js";

const mkSql = () => { const db = new DatabaseSync(":memory:");
  return { exec(q, ...args) { if (!args.length && q.split(";").filter((s) => s.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
    const st = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...args) : (st.run(...args), []); return { toArray: () => rows, one: () => rows[0] }; } }; };
let view = { setting: "off", retry: "off", exit_node: null }; const sent = [];
const ctx = { storage: { sql: mkSql(), getAlarm: async () => null, setAlarm: async () => {} }, container: { running: true, monitor: () => new Promise(() => {}), getTcpPort: () => ({ fetch: async (_u, init) => { sent.push(JSON.parse(init.body)); return Response.json({ ok: true, url: "https://a.example/", title: "A", snapshot: "" }); } }) }, waitUntil: () => {} };
const env = { NATIVE_TRANSPORT: { idFromName: (s) => s, get: () => ({ browserExit: async () => view }) } };
const C = new ChannelComputer(ctx, env); C.ensureRunning = async () => ({ cold: false }); C.put("tenant", "t1"); C.put("channel", "main");

let r = await C.browser("navigate", { url: "https://a.example/", via_exit_node: true }, null, "");
assert.equal(r.ok, false); assert.match(r.error, /setting to retry through the exit node is off/); assert.equal(sent.length, 0, "the browser service was not called");
assert.deepEqual(await C.browserExitConf(), { on: false, retry: false, node: "", direct: [] });

view = { setting: "off", retry: "on", exit_node: { id: "n1", name: "home" } };
r = await C.browser("navigate", { url: "https://a.example/", via_exit_node: true }, null, "");
assert.equal(r.ok, true); assert.equal(sent.at(-1).via_exit_node, true, "the retry argument reached the browser service");
assert.deepEqual(await C.browserExitConf(), { on: false, retry: true, node: "home", direct: [] }, "retry alone keeps the browser on its own connection but needs the proxy");
console.log("browser exit retry: ok");
