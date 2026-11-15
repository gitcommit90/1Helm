// node --import ./test/stubs/register.mjs test/browser-save-shot.test.mjs
// browser_screenshot with save: the schema, that nothing is stored or shown to the person, what goes to the browser server, and the error wording.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Resident } from "../src/resident.js";
import { SEED } from "./helpers/seed-settings.mjs";

const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...args) {
  if (!args.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const s = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? s.all(...args) : (s.run(...args), []);
  return { toArray: () => rows, one: () => rows[0] };
} };
const puts = [];
const env = { MODEL_SETTINGS: SEED, MEMORY: "off", GENUI: "off", WORKMEM: "off", PROMPT_CACHE: "off", NO_TOLERANT_STUBS: true, WS: { put: async (k) => { puts.push(k); }, get: async () => null, delete: async () => {} } };
const R = new Resident({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: () => {} }, env);
R.put("tenant", "t1"); R.put("channel", "main"); R.arm = async () => {};
const ops = []; let reply;
R.computer = () => ({ browser: async (op, body) => { ops.push([op, body]); return reply; } });
const emitted = [], tc = () => ({ kind: "chat", session: "s1", turn: "t1", emit: (e) => emitted.push(e), inTool: 1, extraCharge: 0 });

const f = R.tools().find((x) => x.function.name === "browser_screenshot").function;
assert.deepEqual(Object.keys(f.parameters.properties).filter((k) => ["save", "ref", "region"].includes(k)), ["save", "ref", "region"]);
assert.match(f.description, /With save:/);

reply = { ok: true, saved: "/workspace/shots/card.png", width: 800, height: 400, url: "https://example.com/p" };
let r = await R.browserToolInner("browser_screenshot", { save: "shots/card.png", ref: "e7" }, tc());
assert.equal(r.code, 0); assert.match(r.out, /Saved \/workspace\/shots\/card\.png \(800 x 400 px, PNG\)/); assert.match(r.out, /person does not see it/);
assert.deepEqual(ops[0], ["screenshot", { save: "shots/card.png", ref: "e7", region: undefined }]);
assert.equal(puts.length, 0, "nothing stored"); assert.equal(emitted.length, 0, "nothing shown in the chat");

r = await R.browserToolInner("browser_screenshot", { save: "a.png", region: [1, 2, 30, 40] }, tc());
assert.deepEqual(ops[1][1].region, [1, 2, 30, 40]);

reply = { ok: false, error: "no element e9 on the page now (or it has no size) — take a new snapshot" };
r = await R.browserToolInner("browser_screenshot", { save: "a.png", ref: "e9" }, tc());
assert.equal(r.code, 1); assert.match(r.out, /no element e9/);
reply = { ok: true, jpeg_base64: "AAAA", url: "https://example.com" };   // an older browser image ignores save and sends a picture
r = await R.browserToolInner("browser_screenshot", { save: "a.png" }, tc());
assert.equal(r.code, 1); assert.match(r.out, /cannot save pictures yet/); assert.equal(emitted.length, 0);
console.log("browser-save-shot: all ok");
