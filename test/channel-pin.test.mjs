// node --import ./test/stubs/register.mjs test/channel-pin.test.mjs
// Pin / unpin a channel (POST /w/<slug>/api/channels/<ch>/pin): auth, General refused, unknown channel 404, set, clear, re-pin goes last, boot carries pinned_at.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Resident } from "../src/resident.js";
import { fakeIndex, embedding } from "./helpers/mem0-fakes.mjs";
import { withSettings } from "./helpers/seed-settings.mjs";
import { createChannel, slugify, channelInput, ChannelError, MAX_CHANNELS, NAME_MAX, PURPOSE_MAX } from "../src/channels.js";
const { default: worker, Archive } = await import("../src/index.js");

const sqlOf = (db) => ({ exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = db.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a.map((x) => x instanceof ArrayBuffer ? new Uint8Array(x) : x)) : (st.run(...a.map((x) => x instanceof ArrayBuffer ? new Uint8Array(x) : x)), []);
  return { toArray: () => r.map((x) => (x.vec ? { ...x, vec: x.vec.buffer.slice(x.vec.byteOffset, x.vec.byteOffset + x.vec.byteLength) } : x)), one: () => r[0] }; } });

// ---- D1: owner u1 with an active workspace (t1) and a suspended one (t2); u2 owns nothing ----
const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT); CREATE TABLE sessions (token_hash TEXT, user_id TEXT, expires_at INTEGER);
  CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, owner_user_id TEXT, status TEXT, past_due_since INTEGER, onboarding_completed INTEGER, onboard_step TEXT, slug_chosen INTEGER, helper_name TEXT, helper_avatar INTEGER, helper_tone INTEGER, first_name TEXT, plan TEXT);
  CREATE TABLE resident_schedules (tenant_id TEXT, channel TEXT, channel_id TEXT, next_run INTEGER, updated_at INTEGER, PRIMARY KEY (tenant_id, channel));
  INSERT INTO users VALUES ('u1','sam@example.com'),('u2','eve@example.com');
  INSERT INTO tenants VALUES ('t1','ck1','u1','active',NULL,1,'',1,'Ollie',3,0,'Sam','plus'),('t2','ck2','u1','suspended',NULL,1,'',1,'Ollie',3,0,'Sam','plus');`);
d1.exec(readFileSync(new URL("../db/migrations/0063_memory.sql", import.meta.url), "utf8"));
const sha = (s) => createHash("sha256").update(s).digest("hex");
d1.prepare("INSERT INTO sessions VALUES (?,?,?)").run(sha("aa11"), "u1", Date.now() + 864e5);
d1.prepare("INSERT INTO sessions VALUES (?,?,?)").run(sha("bb22"), "u2", Date.now() + 864e5);
const DB = { batch: async (list) => { const out = []; for (const x of list) out.push(await x.run()); return out; }, prepare: (q) => { let st; try { st = d1.prepare(q); } catch (e) { const bad = { bind: () => bad, first: async () => { throw e; }, all: async () => { throw e; }, run: async () => { throw e; } }; return bad; }
  let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return o; } };


// ---- the model, scripted at callModel: "REMEMBER: <fact>" → the remember tool; anything else → "Done." ----
const seen = [];   // { slug, messages } for every main model call
const ledgerStub = new Proxy({}, { get: (_, k) => k === "then" ? undefined : k === "state" ? async () => ({ balance_nano: 1e12, spent_nano: 0, granted_nano: 1e12 }) : async () => ({ ok: true }) });

function mkEnv(extra = {}) {
  const waits = [], dos = new Map();
  const ctxOf = () => { const db = new DatabaseSync(":memory:"); return { db, ctx: { id: { toString: () => "do-test-id-0000000000000000" }, storage: { sql: sqlOf(db), getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {}, transactionSync: (f) => f() }, waitUntil: (p) => waits.push(p) } }; };
  const env = withSettings({ DB, MEMORY_INDEX: fakeIndex(), APP_HOST: "app.example.test", GATEWAY_HOST: "app.example.test", MODEL: "@cf/test/model", MEMORY: "on", HS_WRITERS: "on", HS_FOUNDATIONS: "on", HS_ENVELOPE: "on", GENUI: "off", WORKMEM: "off", CLEF_DOORS: "off", MEMORY_SUMMARIES: "off", MEMORY_SUPERSEDE: "off",
    AI: { run: async (_m, body) => { if (body?.text) return { data: body.text.map(embedding), usage: {} }; throw new Error("unexpected AI.run (model calls are scripted at callModel)"); } },
    LEDGER: { idFromName: (n) => n, get: () => ledgerStub },
    ARCHIVE: { idFromName: (n) => n, get: (n) => { if (!dos.has(n)) dos.set(n, new Archive(ctxOf().ctx, env)); return dos.get(n); } },
    RESIDENT: { idFromName: (n) => n, get: (n) => { if (!dos.has(n)) { const { ctx } = ctxOf(), R = new Resident(ctx, env), slug = n.split(":")[2];
      R.syncFiles = async () => {}; R.computer = () => { throw new Error("no computer in this test"); };
      R.callModel = async (messages, _w, _onText, noTools) => {
        if (noTools) return { content: "- notes", calls: [], inTok: 10, cached: 0, outTok: 3, charge: 0, finish: "stop" };
        const last = [...messages].reverse().find((m) => m.role === "user"), u = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content);
        const already = messages.some((m) => m.role === "tool");
        seen.push({ slug, messages: structuredClone(messages) });
        const m = !already && u.match(/REMEMBER: ([^\n]+)/);
        const calls = m ? [{ id: `c${seen.length}`, type: "function", function: { name: "remember", arguments: JSON.stringify({ about: "me", fact: m[1], step_title: "Saved it" }) } }] : [];
        return { content: calls.length ? "" : "Done.", calls, inTok: 10, cached: 0, outTok: 3, charge: 0, finish: calls.length ? "tool_calls" : "stop" };
      };
      dos.set(n, R); } return dos.get(n); } },
    ...extra });
  env.settle = async () => { for (let i = 0; i < 50; i++) { const n = waits.length; await Promise.all(waits.map((p) => p.catch?.(() => {}))); await new Promise((z) => setTimeout(z, 2)); if (waits.length === n) break; } };
  env.dos = dos;
  return env;
}
const env = mkEnv();
const call = (method, path, body, cookie = "hc_session=aa11") => worker.fetch(new Request(`https://app.example.test/w/ck1${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
const post = (path, body, cookie) => call("POST", path, body, cookie);
const A = env.ARCHIVE.get("archive:t1");
await A.provisionFresh();   // what onboarding does: General (slug main, id 1)
let passed = 0; const ok = (name) => { passed++; console.log("  ok", name); };
const mk = async (name) => (await (await post("/api/channels", { name })).json()).slug;
const [a, b, c] = [await mk("Alpha"), await mk("Beta"), await mk("Gamma")];
const pin = (slug, pinned, cookie) => post(`/api/channels/${slug}/pin`, { pinned }, cookie);
const boot = async () => (await (await call("GET", "/api/app/boot?light=1")).json()).channels;
const order = async () => (await boot()).filter((x) => x.pinned_at).sort((x, y) => x.pinned_at - y.pinned_at).map((x) => x.slug);

{ assert.equal((await pin(a, true, "")).status, 302); assert.match(await (await pin(a, true, "hc_session=bb22")).text(), /No 1Helm at this address/); assert.deepEqual(await order(), []); }
ok("auth: signed out and other people's workspaces cannot pin");
{ assert.equal((await pin("main", true)).status, 400); assert.equal((await pin("nope", true)).status, 404); assert.equal((await call("GET", `/api/channels/${a}/pin`)).status, 405); assert.deepEqual(await order(), []); }
ok("General and unknown channels are refused");
{ const r = await pin(b, true); assert.equal(r.status, 200); const d = await r.json(); assert.ok(d.pinned_at > 0); await new Promise((z) => setTimeout(z, 3));
  await pin(a, true); await new Promise((z) => setTimeout(z, 3)); await pin(c, true);
  assert.deepEqual(await order(), [b, a, c]); }
ok("pinned channels order by when they were pinned");
{ const t0 = (await boot()).find((x) => x.slug === a).pinned_at; await pin(a, true); assert.equal((await boot()).find((x) => x.slug === a).pinned_at, t0); }
ok("pinning a pinned channel keeps its time");
{ const r = await pin(a, false); assert.equal((await r.json()).pinned_at, null); assert.deepEqual(await order(), [b, c]); assert.ok(!("pinned_at" in (await boot()).find((x) => x.slug === a)));
  await new Promise((z) => setTimeout(z, 3)); await pin(a, true); assert.deepEqual(await order(), [b, c, a]); }
ok("unpin clears it, and re-pinning puts the channel last");
console.log(`${passed} passed`);
