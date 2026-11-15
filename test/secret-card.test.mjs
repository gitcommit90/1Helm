// node --import ./test/stubs/register.mjs test/secret-card.test.mjs   (or: bash scripts/test.sh test/secret-card.test.mjs)
// The secret request card (src/secret-card.js, src/secret-card-api.js), the "Don't ask again" setting and sign_token (src/sign-token*.js).
// The real Resident (node:sqlite as its SQLite and as D1) runs real turns with a scripted model. App facts only, never model wording:
// - request_secret is checked, stored, shown live ({t:"secret_request"}), the task waits, sessionDetail carries the card on its turn;
// - Save seals every value in the vault, hands the task back with the key names, and no value is anywhere in the Resident, D1 (outside the sealed
//   vault rows), the messages, the model's input, the work log or the handoff; Not now tells the helper no secret was given;
// - a second Save or Not now is refused; empty values and bad sites change nothing; a name that already exists is replaced and reported;
// - workers and scheduled runs can't ask; by text the tool tells the helper to send the person to the app;
// - sign_token: ES256, RS256 (PKCS#8 and the older PKCS#1 form), PS256, EdDSA and HS256 signatures verify; exp over 60 minutes is refused and a
//   missing exp is set; the site must be one of the saved key's sites; deleting the key stops signing at once; the work log row has no token or key;
// - the "Don't ask again" flag is kept per account, off by default (prompt on), and comes back on.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { generateKeyPairSync, createPublicKey, verify as nodeVerify, createHmac, constants } from "node:crypto";
import { Resident } from "../src/resident.js";
import { checkSecretRequest, checkSecretSave, REQUEST_SECRET_TOOL, SIGN_TOKEN_TOOL, secretInit } from "../src/secret-card.js";
import { secretChatApi, secretPromptOn, setSecretPrompt, saveSecretSlots } from "../src/secret-card-api.js";
import { signJwt, checkLifetime, MAX_LIFE_S, privateKeyDer, substituteRefs, refNames } from "../src/sign-token.js";
import { TOKEN_DIR } from "../src/sign-token-tool.js";
import { helperAllowed } from "../src/helpers.js";

const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE vault (tenant_id TEXT NOT NULL, name TEXT NOT NULL, standin TEXT NOT NULL UNIQUE, hosts TEXT NOT NULL, sealed TEXT NOT NULL, created_at INTEGER NOT NULL, label TEXT, note TEXT, kind TEXT, PRIMARY KEY (tenant_id, name));
  CREATE TABLE tenant_flags (tenant_id TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tenant_id, k));`);
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
const ledger = { reserve: async () => ({ ok: true }), settle: async () => ({}), state: async () => ({ balance_nano: 1e12, spend_pauses_enabled: true }), guardInfo: async () => ({}), dayInfo: async () => ({ spent_nano: 0, reserved_nano: 0 }) };
const env = { DB: D1, LEDGER: { idFromName: (id) => id, get: () => ledger }, GATEWAY_HOST: "app.example.com", APP_HOST: "app.example.com", MEMORY: "off", GENUI: "off", WORKMEM: "off", VAULT_KEY: Buffer.from(new Uint8Array(32).map((_, i) => i * 7 + 1)).toString("base64") };

const dodb = new DatabaseSync(":memory:");
const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
const waits = []; const ctx = { storage: { sql, getAlarm: async () => null, setAlarm: async () => {} }, waitUntil: (p) => waits.push(p) };
const R = new Resident(ctx, env);
R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1");
R.systemPrompt = async () => "SYSTEM";
env.RESIDENT = { idFromName: (n) => n, get: () => R };
let script = [], seen = [];
const tcall = (name, args) => ({ id: `c${Math.random().toString(36).slice(2, 8)}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
R.callModel = async (messages, _w, onText) => {
  seen.push(JSON.parse(JSON.stringify(messages)));
  const s = script.shift() ?? "Done.";
  if (typeof s === "string") { if (s) onText?.(s); return { content: s, calls: [], inTok: 10, cached: 0, outTok: 3, charge: 0, finish: "stop" }; }
  return { content: "", calls: [tcall(s.tool, s.args)], inTok: 10, cached: 0, outTok: 3, charge: 0, finish: "tool_calls" };
};
const logs = []; const log0 = console.log; console.log = (...a) => { logs.push(a.join(" ")); if (/^ {2}ok /.test(a.join(" "))) log0(...a); };
async function scenario(name, fn) { await fn(); console.log("  ok", name); }
async function settle() { for (let i = 0; i < 50; i++) { const n = waits.length; await Promise.all(waits); await R._lastHandoff; await new Promise((z) => setTimeout(z, 5)); if (waits.length === n) break; } }
async function appTurn(session, text, steps, o = {}) { script = [...steps]; const ev = []; const r = await R.runTurn("t1", "main", "1", text, (e) => ev.push(e), { session, engine: "classic", ...o }); return { r, ev }; }
const toolOut = () => dodb.prepare("SELECT content FROM msgs WHERE role='tool' ORDER BY seq DESC LIMIT 1").get()?.content || "";
const json = (b, s = 200) => ({ body: b, status: s });
const archive = () => ({ channels: async () => [{ slug: "main", id: 1 }] });
const URL0 = new URL("https://app.example.com/w/ck1/api/res/main/secrets/x");
const api = (id, body, method = "POST", headers = { "content-type": "application/json" }) => secretChatApi({ method, headers: new Headers(headers), json: async () => body }, env, { id: "t1" }, [null, "main", id], { json, access: { mode: "full" }, archive, url: URL0 });

// ---- every table's text, for "the value is nowhere" ----
const dump = () => {
  const out = [];
  for (const [name, db] of [["do", dodb], ["d1", d1]]) for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
    if (name === "d1" && t.name === "vault") continue;   // sealed with the vault key: ciphertext only
    out.push(JSON.stringify(db.prepare(`SELECT * FROM "${t.name}"`).all()));
  }
  return out.join("\n");
};

const P8 = await (async () => { const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]); const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", k.privateKey)).toString("base64");
  return { pem: `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`, pub: k.publicKey }; })();
const KEY_ID = "ABCDE12345", ISSUER = "69a6de70-aaaa-47e3-bbbb-5b6d2a0e1c3f";
const REQ = { service: "App Store Connect", reason: "to read your app's sales", hosts: ["api.appstoreconnect.apple.com"],
  fields: [{ label: "Key ID", name: "app_store_connect_key_id", note: "Names the key" }, { label: "Issuer ID", name: "APP_STORE_CONNECT_ISSUER_ID" }, { label: "Private key (.p8 file)", name: "APP_STORE_CONNECT_PRIVATE_KEY", file: true, note: "Signs the token" }] };
const SLOTS = (extra = {}) => ({ op: "save", hosts: ["api.appstoreconnect.apple.com", "*.apple.com"], ...extra, slots: [
  { label: "Key ID", name: "APP_STORE_CONNECT_KEY_ID", note: "Names the key", value: KEY_ID }, { label: "Issuer ID", name: "APP_STORE_CONNECT_ISSUER_ID", value: ISSUER },
  { label: "Private key (.p8 file)", name: "APP_STORE_CONNECT_PRIVATE_KEY", note: "Signs the token", kind: "file", value: P8.pem }] });
// the computer, as far as sign_token needs it: the command it is asked to run is kept (it holds the token the tool wrote)
const execs = []; R.computer = () => ({ exec: async (cmd) => { execs.push(cmd); return { code: 0, out: "" }; } });
const tokenWritten = () => { const m = execs.at(-1)?.match(/printf '%s' '([^']+)' > (\S+)/); return m ? { token: m[1], path: m[2] } : null; };

// ---------- checks on the request ----------
await scenario("checkSecretRequest: everything is optional; names checked when given, sites checked, limits", async () => {
  const c = checkSecretRequest(REQ); assert.ok(!c.error); assert.deepEqual(c.req.fields.map((f) => f.name), ["APP_STORE_CONNECT_KEY_ID", "APP_STORE_CONNECT_ISSUER_ID", "APP_STORE_CONNECT_PRIVATE_KEY"]); assert.equal(c.req.fields[2].file, true); assert.equal(c.req.fields[0].note, "Names the key");
  for (const open of [{}, { service: "", fields: [], hosts: [] }, { fields: [{ label: "Anything" }] }]) { const o = checkSecretRequest(open); assert.ok(!o.error, "an open request is fine"); }
  assert.deepEqual(checkSecretRequest({}).req.fields, []);   // none suggested: the card shows one empty slot
  for (const bad of [{ ...REQ, hosts: ["not a site"] }, { ...REQ, fields: [{ name: "1bad" }] }, { ...REQ, fields: [{ name: "A_B" }, { name: "a_b" }] },
    { ...REQ, fields: Array.from({ length: 9 }, (_, i) => ({ name: `KEY_${i}` })) }, { ...REQ, hosts: Array.from({ length: 21 }, (_, i) => `s${i}.example.com`) }]) assert.match(checkSecretRequest(bad).error, /^error:/);
  assert.equal(REQUEST_SECRET_TOOL.function.name, "request_secret"); assert.equal(SIGN_TOKEN_TOOL.function.name, "sign_token");
  assert.deepEqual(REQUEST_SECRET_TOOL.function.parameters.required ?? [], [], "no field is required");
});

// ---------- the card, end to end ----------
let sid, rid;
await scenario("request_secret: the card shows, the task waits, the card is on its turn, the result tells the helper to wait and names no value", async () => {
  sid = (await R.createSession("Sales")).id;
  const { r, ev } = await appTurn(sid, "check my app store sales", [{ tool: "request_secret", args: REQ }, "I put a card in the chat."]);
  assert.ok(!r.error, r.error);
  const e = ev.find((x) => x.t === "secret_request"); assert.ok(e); const v = e.secret; rid = v.id;
  assert.equal(v.status, "open"); assert.equal(v.service, "App Store Connect"); assert.deepEqual(v.hosts, ["api.appstoreconnect.apple.com"]); assert.equal(v.fields.length, 3); assert.equal(v.fields[2].note, "Signs the token");
  assert.match(toolOut(), /is now in the person's chat/);
  const d = await R.sessionDetail(sid); assert.equal(d.session.waiting, "secret"); assert.equal(d.turns.at(-1).secrets?.[0]?.id, rid);
  assert.equal(dodb.prepare("SELECT COUNT(*) n FROM secret_requests").get().n, 1);
});

await scenario("Save: bad input changes nothing; then the values go to the vault and only labels, names, notes and file paths reach the Resident", async () => {
  let d = await api(rid, { op: "save", slots: [{ label: "x", value: "  " }] }); assert.equal(d.status, 400); assert.match(d.body.error, /at least one secret/);
  d = await api(rid, SLOTS({ hosts: ["nope"] })); assert.equal(d.status, 400);
  assert.equal(d1.prepare("SELECT COUNT(*) n FROM vault").get().n, 0); assert.equal((await R.secretView(rid)).status, "open");
  seen = []; script = ["Thanks. Reading your sales now."];
  d = await api(rid, SLOTS());
  assert.equal(d.status, 200, JSON.stringify(d.body)); assert.deepEqual(d.body.saved, ["APP_STORE_CONNECT_KEY_ID", "APP_STORE_CONNECT_ISSUER_ID", "APP_STORE_CONNECT_PRIVATE_KEY"]);
  const rows = d1.prepare("SELECT name, label, note, kind, hosts, sealed, standin FROM vault ORDER BY name").all(); assert.equal(rows.length, 3);
  for (const r of rows) { assert.deepEqual(JSON.parse(r.hosts), ["api.appstoreconnect.apple.com", "*.apple.com"]); assert.ok(r.standin.startsWith("1hs_")); for (const v of Object.values({ KEY_ID, ISSUER, P: P8.pem })) assert.ok(!r.sealed.includes(v.slice(0, 12))); }
  const pk = rows.find((r) => r.name === "APP_STORE_CONNECT_PRIVATE_KEY"); assert.equal(pk.kind, "file"); assert.equal(pk.label, "Private key (.p8 file)"); assert.equal(pk.note, "Signs the token");
  const { openSecret } = await import("../src/sentinel.js"); assert.equal(await openSecret(env, pk.sealed), P8.pem.trim(), "the PEM keeps its line breaks");
  await settle();
  const sent = JSON.stringify(seen.at(-1)); assert.match(sent, /Private key \(\.p8 file\): \$APP_STORE_CONNECT_PRIVATE_KEY \(Signs the token\), also a file at \/var\/1hc\/keys\/APP_STORE_CONNECT_PRIVATE_KEY/);
  assert.match(sent, /Key ID: \$APP_STORE_CONNECT_KEY_ID \(Names the key\)/); assert.match(sent, /real environment variable/);
  const v = await R.secretView(rid); assert.equal(v.status, "saved"); assert.equal(v.saved.names.length, 3); assert.equal(v.saved.items[2].file, "/var/1hc/keys/APP_STORE_CONNECT_PRIVATE_KEY");
  assert.equal((await R.sessionDetail(sid)).session.waiting ?? null, null);
  const everything = JSON.stringify(seen) + "\n" + dump() + "\n" + logs.join("\n");
  for (const val of [KEY_ID, ISSUER, ...P8.pem.split("\n").filter((l) => l.length > 20)]) assert.ok(!everything.includes(val), `value leaked: ${val.slice(0, 12)}`);
  assert.equal((await api(rid, SLOTS())).status, 409); assert.equal((await api(rid, { op: "cancel" })).status, 409);
});

await scenario("sign_token: $NAME in header and claims becomes the real Key ID and Issuer ID; the token goes to a file, not to the model", async () => {
  const now = Math.floor(Date.now() / 1000);
  const args = { key: "APP_STORE_CONNECT_PRIVATE_KEY", alg: "ES256", header: { kid: "$APP_STORE_CONNECT_KEY_ID" }, claims: { iss: "${APP_STORE_CONNECT_ISSUER_ID}", aud: "appstoreconnect-v1", exp: now + 1200 } };
  await appTurn(sid, "go ahead", [{ tool: "sign_token", args }, "Signed."]);
  const out = toolOut(), w = tokenWritten(); assert.ok(w, out); assert.match(out, new RegExp(`in the file ${TOKEN_DIR}/APP_STORE_CONNECT_PRIVATE_KEY-[0-9a-f]{8}\\.jwt`)); assert.equal(w.path, out.match(/file (\S+) on your computer/)[1]);
  assert.ok(!/eyJ/.test(out), "the token is not in the result: it holds the saved Key ID and Issuer ID, which are hidden");
  const [h, c, s] = w.token.split("."); const head = JSON.parse(Buffer.from(h, "base64url")), claims = JSON.parse(Buffer.from(c, "base64url"));
  assert.deepEqual([head.alg, head.kid, head.typ], ["ES256", KEY_ID, "JWT"]); assert.equal(claims.iss, ISSUER); assert.equal(claims.exp, now + 1200);
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, P8.pub, Buffer.from(s, "base64url"), Buffer.from(`${h}.${c}`)));
  const wl = JSON.stringify(dodb.prepare("SELECT * FROM work_log WHERE tool='sign_token'").all()); assert.match(wl, /APP_STORE_CONNECT_PRIVATE_KEY/); assert.ok(!wl.includes(w.token) && !wl.includes(s) && !wl.includes("BEGIN PRIVATE") && !wl.includes(ISSUER));
  assert.ok(!JSON.stringify(dodb.prepare("SELECT * FROM msgs").all()).includes(ISSUER));
  // no audience_host needed; a saved key with sites refuses a different one; long life and unknown keys are refused; an unknown $NAME says which
  await appTurn(sid, "again", [{ tool: "sign_token", args: { ...args, audience_host: "evil.example.com" } }, "x"]); assert.match(toolOut(), /isn't approved for evil\.example\.com/);
  await appTurn(sid, "again", [{ tool: "sign_token", args: { ...args, audience_host: "api.appstoreconnect.apple.com" } }, "x"]); assert.match(toolOut(), /Signed\./);
  await appTurn(sid, "again", [{ tool: "sign_token", args: { ...args, claims: { ...args.claims, exp: now + 7200 } } }, "x"]); assert.match(toolOut(), /more than 60 minutes/);
  await appTurn(sid, "again", [{ tool: "sign_token", args: { ...args, key: "NOPE_KEY" } }, "x"]); assert.match(toolOut(), /no saved key named NOPE_KEY/);
  await appTurn(sid, "again", [{ tool: "sign_token", args: { ...args, header: { kid: "$MISSING_ONE" } } }, "x"]); assert.match(toolOut(), /use \$MISSING_ONE, but there is no saved key/);
  // deleting the key (Settings → Passwords & keys) stops signing at once
  d1.prepare("DELETE FROM vault WHERE tenant_id='t1' AND name='APP_STORE_CONNECT_PRIVATE_KEY'").run();
  execs.length = 0; await appTurn(sid, "again", [{ tool: "sign_token", args }, "x"]); assert.match(toolOut(), /no saved key named APP_STORE_CONNECT_PRIVATE_KEY/); assert.equal(execs.length, 0);
  assert.deepEqual([...refNames({ a: "$X_Y", b: ["${ZZ}"], c: "nope $ lower $abc" })].sort(), ["X_Y", "ZZ"]);
  assert.deepEqual(substituteRefs({ a: "$X_Y!", b: ["${ZZ}", "$Q_Q"] }, new Map([["X_Y", "1"], ["ZZ", "2"]])), { a: "1!", b: ["2", "$Q_Q"] });
});

await scenario("the loose card: an open request starts empty; the person adds, names, notes and removes slots, attaches a file, and the helper gets only labels, names, notes and paths", async () => {
  const s2 = (await R.createSession("Open ask")).id;
  const { ev } = await appTurn(s2, "I need a key", [{ tool: "request_secret", args: {} }, "Paste it on the card."]);
  const v = ev.find((x) => x.t === "secret_request").secret; assert.deepEqual(v.fields, []); assert.deepEqual(v.hosts, []); assert.equal(v.service, "");
  seen = []; script = ["Got them."];
  const d = await api(v.id, { op: "save", slots: [
    { label: "Weather service", value: "wk-1234567890abcdef", note: "Forecast API" },            // name made from the label
    { label: "Weather service", value: "wk-second-0987654321" },                                  // same label: a second variable
    { label: "My own name", name: "custom_var", kind: "text", value: "c-value-12345678" },        // the person's own name, lower case is fixed
    { label: "Empty slot", value: "" },                                                          // skipped
    { label: "Cert", kind: "file", value: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----" }] });
  assert.equal(d.status, 200, JSON.stringify(d.body)); await settle();
  assert.deepEqual(d.body.saved, ["WEATHER_SERVICE", "WEATHER_SERVICE_2", "CUSTOM_VAR", "CERT"]);
  assert.deepEqual(d1.prepare("SELECT hosts FROM vault WHERE name='CERT'").get(), { hosts: "[]" }, "sites are optional");
  const sent = JSON.stringify(seen.at(-1)); assert.match(sent, /Weather service: \$WEATHER_SERVICE \(Forecast API\)/); assert.match(sent, /No sites approved yet/); assert.match(sent, /also a file at \/var\/1hc\/keys\/CERT/);
  for (const val of ["wk-1234567890abcdef", "wk-second-0987654321", "c-value-12345678"]) assert.ok(!(sent + dump()).includes(val));
  assert.equal(d1.prepare("SELECT COUNT(*) n FROM vault WHERE name='EMPTY_SLOT'").get().n, 0);
});

await scenario("a name that is already saved: the card is warned first (409 names it), nothing is saved until the person confirms, then it is replaced and reported", async () => {
  const s2 = (await R.createSession("Replace")).id;
  const { ev } = await appTurn(s2, "again", [{ tool: "request_secret", args: { fields: [{ name: "CUSTOM_VAR", label: "Mine" }] } }, "Card."]);
  const id = ev.find((x) => x.t === "secret_request").secret.id, before = d1.prepare("SELECT sealed, standin FROM vault WHERE name='CUSTOM_VAR'").get();
  const body = { op: "save", slots: [{ label: "Mine", name: "CUSTOM_VAR", value: "c-new-value-9999" }] };
  let d = await api(id, body); assert.equal(d.status, 409); assert.deepEqual(d.body.replace, ["CUSTOM_VAR"]); assert.match(d.body.error, /already saved/);
  assert.equal(d1.prepare("SELECT sealed FROM vault WHERE name='CUSTOM_VAR'").get().sealed, before.sealed); assert.equal((await R.secretView(id)).status, "open");
  seen = []; script = ["Replaced."]; d = await api(id, { ...body, replace_ok: true }); assert.equal(d.status, 200); await settle();
  const after = d1.prepare("SELECT sealed, standin FROM vault WHERE name='CUSTOM_VAR'").get(); assert.notEqual(after.sealed, before.sealed); assert.equal(after.standin, before.standin);
  assert.match(JSON.stringify(seen.at(-1)), /\$CUSTOM_VAR already existed and now holds the new value/);
  // a name made from a label never replaces: it gets a suffix
  const s3 = (await R.createSession("Suffix")).id, e3 = await appTurn(s3, "x", [{ tool: "request_secret", args: {} }, "Card."]);
  d = await api(e3.ev.find((x) => x.t === "secret_request").secret.id, { op: "save", slots: [{ label: "Custom var", value: "another-value-123" }] });
  assert.equal(d.status, 200); assert.deepEqual(d.body.saved, ["CUSTOM_VAR_2"]); await settle();
});

await scenario("Not now: the helper is told no secret was given and nothing is saved; by text the value is never asked for", async () => {
  const s2 = (await R.createSession("Weather")).id;
  const { ev } = await appTurn(s2, "get the weather", [{ tool: "request_secret", args: { service: "OpenWeather", hosts: ["api.openweathermap.org"], fields: [{ name: "OPENWEATHER_KEY" }] } }, "Card shown."]);
  const id = ev.find((x) => x.t === "secret_request").secret.id; seen = []; script = ["Okay, no problem."];
  const d = await api(id, { op: "cancel" }); assert.equal(d.status, 200); await settle();
  assert.equal(d.body.secret.status, "cancelled"); assert.match(JSON.stringify(seen.at(-1)), /no secret was given/); assert.equal(d1.prepare("SELECT COUNT(*) n FROM vault WHERE name='OPENWEATHER_KEY'").get().n, 0);
  const s3 = (await R.createSession("Texts")).id;
  await appTurn(s3, "get the weather", [{ tool: "request_secret", args: { service: "OpenWeather", hosts: ["api.openweathermap.org"], fields: [{ name: "OPENWEATHER_KEY" }] } }, "Open the app."], { viaText: true });
  assert.match(toolOut(), /never taken by text/); assert.match(toolOut(), /open 1Helm/);
});

await scenario("a failed slot removes the ones this save added", async () => {
  const r = await saveSecretSlots(env, "t1", [{ name: "FRESH_ONE", label: "a", note: "", kind: "text", value: "v1" }, { name: "x", label: "b", note: "", kind: "text", value: "v2" }], ["b.example.com"]);
  assert.ok(r.error); assert.equal(d1.prepare("SELECT COUNT(*) n FROM vault WHERE name='FRESH_ONE'").get().n, 0);
});

await scenario("workers and scheduled runs can't ask for a secret; the tools are offered to the helper", async () => {
  assert.equal(helperAllowed("request_secret", null, null), false); assert.equal(helperAllowed("sign_token", null, null), true);
  assert.match(await R.localTool("request_secret", REQ, { kind: "helper" }), /isn't available/);
  assert.match(await R.localTool("request_secret", REQ, { kind: "workflow" }), /only works while you're talking/);
});

await scenario("the Don't ask again setting: on by default, saved per account, comes back on", async () => {
  assert.equal(await secretPromptOn(env, "t1"), true);
  await setSecretPrompt(env, "t1", false); assert.equal(await secretPromptOn(env, "t1"), false); assert.equal(await secretPromptOn(env, "t2"), true);
  await setSecretPrompt(env, "t1", false); assert.equal(await secretPromptOn(env, "t1"), false);
  await setSecretPrompt(env, "t1", true); assert.equal(await secretPromptOn(env, "t1"), true);
  const { default: worker } = await import("../src/index.js"); assert.ok(worker);
});

await scenario("a cross-origin POST and a non-JSON POST are refused for save and cancel, and change nothing", async () => {
  const s4 = (await R.createSession("Csrf")).id;
  const { ev } = await appTurn(s4, "x", [{ tool: "request_secret", args: { service: "Svc", hosts: ["api.example.com"], fields: [{ name: "SVC_KEY" }] } }, "Card."]);
  const id = ev.find((x) => x.t === "secret_request").secret.id, vals = { slots: [{ name: "SVC_KEY", value: "v-csrf-12345" }] };
  for (const body of [{ op: "save", ...vals }, { op: "cancel" }]) {
    assert.equal((await api(id, body, "POST", { "content-type": "application/json", origin: "https://evil.test" })).status, 403);
    assert.equal((await api(id, body, "POST", { "content-type": "text/plain" })).status, 403);
    assert.equal((await api(id, body, "POST", {})).status, 403);
  }
  assert.equal((await R.secretView(id)).status, "open"); assert.equal(d1.prepare("SELECT COUNT(*) n FROM vault WHERE name='SVC_KEY'").get().n, 0);
  assert.equal((await api(id, { op: "cancel" }, "POST", { "content-type": "application/json", origin: "https://app.example.com" })).status, 200, "same origin is accepted");
});

// ---------- signing ----------
const verifyJwt = async (token, alg, pub) => {
  const [h, c, s] = token.split("."), msg = Buffer.from(`${h}.${c}`), sig = Buffer.from(s, "base64url");
  if (alg === "ES256") return nodeVerify("sha256", msg, { key: pub, dsaEncoding: "ieee-p1363" }, sig);
  if (alg === "RS256") return nodeVerify("sha256", msg, pub, sig);
  if (alg === "PS256") return nodeVerify("sha256", msg, { key: pub, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, sig);
  if (alg === "EdDSA") return nodeVerify(null, msg, pub, sig);
  return createHmac("sha256", pub).update(msg).digest().equals(sig);
};
const pems = (priv) => priv.export({ type: "pkcs8", format: "pem" });
const base = { hosts: ["api.example.com"], audience_host: "api.example.com", header: { kid: "k1" }, claims: { iss: "me" } };
await scenario("signatures verify: ES256, RS256 (PKCS#8 and PKCS#1), PS256, EdDSA, HS256", async () => {
  const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }), rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }), ed = generateKeyPairSync("ed25519");
  for (const [alg, kp] of [["ES256", ec], ["RS256", rsa], ["PS256", rsa], ["EdDSA", ed]]) {
    const r = await signJwt({ ...base, alg, value: pems(kp.privateKey) }); assert.ok(r.token, r.error); assert.ok(await verifyJwt(r.token, alg, kp.publicKey), alg);
    assert.equal(JSON.parse(Buffer.from(r.token.split(".")[0], "base64url")).alg, alg);
  }
  const p1 = rsa.privateKey.export({ type: "pkcs1", format: "pem" }); assert.match(p1, /BEGIN RSA PRIVATE KEY/);
  const r = await signJwt({ ...base, alg: "RS256", value: p1 }); assert.ok(r.token, r.error); assert.ok(await verifyJwt(r.token, "RS256", rsa.publicKey), "GitHub App style key");
  const esc = await signJwt({ ...base, alg: "RS256", value: pems(rsa.privateKey).replace(/\n/g, "\\n") }); assert.ok(esc.token, "a key pasted with \\n for line breaks");
  const hs = await signJwt({ ...base, alg: "HS256", value: "shared-secret" }); assert.ok(await verifyJwt(hs.token, "HS256", "shared-secret"));
  assert.match((await signJwt({ ...base, alg: "ES256", value: pems(rsa.privateKey) })).error, /doesn't work with ES256/);
  assert.match((await signJwt({ ...base, alg: "RS256", value: "not a key" })).error, /not a PEM/);
  assert.match((await signJwt({ ...base, alg: "none", value: "x" })).error, /alg must be/);
  assert.ok(privateKeyDer(P8.pem).length > 60);
});
await scenario("lifetime: over 60 minutes refused, missing exp set to 10 minutes, past refused", async () => {
  const now = Date.now(), nowS = Math.floor(now / 1000);
  assert.equal(checkLifetime({ exp: nowS + MAX_LIFE_S }, now).exp, nowS + MAX_LIFE_S); assert.ok(checkLifetime({ exp: nowS + MAX_LIFE_S + 1 }, now).error);
  assert.equal(checkLifetime({}, now).exp, nowS + 600); assert.ok(checkLifetime({ exp: nowS - 5 }, now).error); assert.ok(checkLifetime({ exp: "soon" }, now).error);
  const hs = await signJwt({ ...base, alg: "HS256", value: "s", claims: { exp: nowS + 5000 } }); assert.match(hs.error, /60 minutes/);
});
await scenario("host match: a key with sites is limited to them, wildcard sites cover subdomains, an audience is optional, a key with no sites has no limit", async () => {
  const ok = (h, hosts) => signJwt({ ...base, alg: "HS256", value: "s", hosts, audience_host: h });
  assert.ok((await ok("api.example.com", ["api.example.com"])).token); assert.ok((await ok("a.b.example.com", ["*.example.com"])).token); assert.ok((await ok("example.com", ["*.example.com"])).token);
  assert.match((await ok("notexample.com", ["*.example.com"])).error, /isn't approved for/);
  assert.match((await ok("evil.com", ["api.example.com"])).error, /isn't approved for evil\.com/);
  assert.ok((await ok("", ["api.example.com"])).token, "no audience given"); assert.ok((await ok("evil.com", [])).token, "a key with no sites");
});

console.log = log0; console.log("secret-card: all passed");
