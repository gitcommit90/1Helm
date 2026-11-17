// Sign-in email send limits (src/signin-code.js sendLimit, db/migrations/0086_signin_email_sends.sql).
// Run: node --import ./test/stubs/register.mjs test/signin-email-limit.test.mjs
// Checks: 5 per hour and 20 per day per network, the service-wide cap and its log line, test addresses never counted or refused,
// window expiry, the per-address limit, and the same limits on /auth/start (app host and a person's own address).
import assert from "node:assert/strict"; import { DatabaseSync } from "node:sqlite"; import { readFileSync, readdirSync } from "node:fs";
const worker = (await import("../src/index.js")).default;
const errors = []; const oe = console.error.bind(console); console.error = (...a) => { errors.push(a.map(String).join(" ")); oe(...a); };
const ok = (m) => console.log("ok -", m);
const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE magic_links (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, owner_user_id TEXT, status TEXT, onboarding_completed INTEGER, onboard_step TEXT, slug_chosen INTEGER, helper_name TEXT, helper_avatar INTEGER, first_name TEXT, plan TEXT, host_ready INTEGER, stripe_customer TEXT NOT NULL DEFAULT '', updated_at INTEGER);
  CREATE TABLE logins (tenant_id TEXT NOT NULL, site TEXT NOT NULL, username TEXT NOT NULL DEFAULT '', sealed TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, site, username));
  INSERT INTO users VALUES ('u1','sam@corp.test',0), ('u3','zed@example.com',0);
  INSERT INTO tenants VALUES ('t1','ck1','u1','active',1,'done',1,'Ollie',8,'Sam','plus',1,'cus_1',0), ('t3','ck3','u3','active',1,'done',1,'Pip',8,'Zed','plus',1,'',0);`);
for (const f of readdirSync(new URL("../db/migrations/", import.meta.url)).sort()) d1.exec(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), "utf8"));
const stmt = (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }), _run: () => st.run(...a) }; return o; };
const DB = { prepare: stmt, batch: async (list) => { for (const s of list) s._run(); return []; } };
const mail = [];
const env = { DB, ONEHELM_EE: "1hc", PUBLIC_BASE_DOMAIN: "example.test", TEST_MODE: "1", GATEWAY_HOST: "app.example.test", APP_HOST: "app.example.test", VAULT_KEY: Buffer.alloc(32, 7).toString("base64"),
  EMAIL: { send: async (m) => { mail.push(m); } }, LEDGER: { idFromName: (x) => x, get: () => ({}) } };
const H = "https://app.example.test";
// A tiny browser: its own cookie jar, its own network address.
const ageProof = (await (await import("../src/age-gate.js")).ageCookie(env)).split(";")[0].split("=")[1];
function browser(ip = "203.0.113.7", host = H) {
  // These are sign-in/code regressions after explicit acknowledgement; the age-gate suite tests fresh browsers.
  const jar = { hc_age: ageProof };
  const take = (r) => { for (const c of r.headers.getSetCookie?.() || []) { const [kv] = c.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i), v = kv.slice(i + 1); if (/Max-Age=0/.test(c)) delete jar[k]; else jar[k] = v; } return r; };
  const req = (path, { b, form, origin = host, method } = {}) => worker.fetch(new Request(`${host}${path}`, {
    method: method || (b !== undefined || form ? "POST" : "GET"), redirect: "manual",
    headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "), ...(origin ? { origin } : {}), "cf-connecting-ip": ip, "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
      "content-type": form ? "application/x-www-form-urlencoded" : "application/json" },
    ...(form ? { body: new URLSearchParams(form).toString() } : b !== undefined ? { body: JSON.stringify(b) } : {}) }), env, { waitUntil() {} }).then(take);
  return { jar, req, api: async (op, b) => { const r = await req(`/onboard/api/${op}`, { b }); return { status: r.status, ...(await r.json()) }; } };
}

const sends = () => d1.prepare("SELECT COUNT(*) n FROM signin_email_sends").get().n;
const reset = () => { d1.prepare("DELETE FROM signin_email_sends").run(); d1.prepare("DELETE FROM magic_links").run(); mail.length = 0; };
const user = (n) => `u${n}@corp.test`;

// 6th email in an hour from one network is refused with 429 and the page's error shape; another network still passes.
{
  const A = browser("198.51.100.1");
  for (let i = 0; i < 5; i++) { const r = await A.api("email", { email: user(i), adult: true, age_version: "1" }); assert.equal(r.status, 200); assert.equal(r.ok, true); }
  const r = await A.api("email", { email: user(5), adult: true, age_version: "1" });
  assert.equal(r.status, 429); assert.equal(r.error, "Too many sign-in emails from this network. Try again in an hour.");
  assert.equal(mail.length, 5, "the refused request sent nothing"); assert.equal(d1.prepare("SELECT COUNT(*) n FROM magic_links WHERE email=?").get(user(5)).n, 0, "and made no sign-in");
  assert.equal((await browser("198.51.100.2").api("email", { email: user(5), adult: true, age_version: "1" })).status, 200);
  ok("sixth email in an hour from one network refused, another network passes");
  // The same network is refused on /auth/start too.
  const x = await A.req("/auth/start", { form: { email: user(6), adult: "1", version: "1" } }); assert.equal(x.status, 429); assert.match(await x.text(), /Too many sign-in emails from this network/);
  ok("/auth/start refused for the same network");
  // Window expiry: after an hour the hourly limit frees up.
  d1.prepare("UPDATE signin_email_sends SET at=at-3700000").run();
  assert.equal((await A.api("email", { email: user(7), adult: true, age_version: "1" })).status, 200);
  ok("hourly window expires");
}
// Day limit: 20 in a day, even when each hour is under 5.
reset();
{
  const ip = "198.51.100.3", B = browser(ip);
  await B.api("email", { email: user(0), adult: true, age_version: "1" });
  const h = d1.prepare("SELECT ip FROM signin_email_sends").get().ip;
  d1.prepare("DELETE FROM signin_email_sends").run();
  for (let i = 0; i < 20; i++) d1.prepare("INSERT INTO signin_email_sends VALUES (?,?)").run(h, Date.now() - 2 * 3600e3 - i);
  const r = await B.api("email", { email: user(1), adult: true, age_version: "1" }); assert.equal(r.status, 429);
  d1.prepare("UPDATE signin_email_sends SET at=at-23*3600000").run();
  assert.equal((await B.api("email", { email: user(1), adult: true, age_version: "1" })).status, 200);
  ok("20 per day limit, and it expires");
}
// Service-wide cap: 300 in an hour from anywhere refuses everyone and logs one line; the line never holds an address or network.
reset();
{
  for (let i = 0; i < 300; i++) d1.prepare("INSERT INTO signin_email_sends VALUES (?,?)").run(`h${i}`, Date.now() - 1000);
  errors.length = 0;
  const r = await browser("198.51.100.4").api("email", { email: user(0), adult: true, age_version: "1" });
  assert.equal(r.status, 429); assert.equal(r.error, "We can't send sign-in emails right now. Try again in a few minutes.");
  assert.deepEqual(errors, ["signin email service cap reached"]);
  const t = await browser("198.51.100.4").api("email", { email: "chk+9@example.com", adult: true, age_version: "1" }); assert.equal(t.status, 200); assert.ok(t.test_link);
  ok("service cap refuses and logs one line; test addresses still pass");
}
// Test addresses are never counted or refused, even after many.
reset();
{
  const T = browser("198.51.100.5");
  for (let i = 0; i < 30; i++) { const r = await T.api("email", { email: `chk+${i}@example.com`, adult: true, age_version: "1" }); assert.equal(r.status, 200); assert.ok(r.test_link); }
  assert.equal(sends(), 0); assert.equal(mail.length, 0);
  const x = await T.req("/auth/start", { form: { email: "chk+99@example.com", adult: "1", version: "1" } }); assert.equal(x.status, 200); assert.equal(sends(), 0);
  ok("test addresses never counted or refused");
}
// The per-address limit still works (different networks, one address).
reset();
{
  let last;
  for (let i = 0; i < 8; i++) last = await browser(`192.0.2.${i + 1}`).api("email", { email: user(50), adult: true, age_version: "1" });
  assert.match(last.error, /We just sent you a few links/); assert.equal(sends(), 6);
  ok("per-address limit still works and refused tries are not counted");
}
// A person's own address (ck1.example.test): a decoy is not counted, the owner's real email is, and a limit refusal is the same for any address.
reset();
{
  const HH = "https://ck1.example.test", O = browser("198.51.100.6", HH), f = (email) => ({ form: { email, adult: "1", version: "1" } });
  await O.req("/auth/start", f("someone@else.test")); assert.equal(sends(), 0, "a decoy is not counted");
  await O.req("/auth/start", f("sam@corp.test")); assert.equal(sends(), 1); assert.equal(mail.length, 1);
  const h = d1.prepare("SELECT ip FROM signin_email_sends").get().ip;
  for (let i = 0; i < 4; i++) d1.prepare("INSERT INTO signin_email_sends VALUES (?,?)").run(h, Date.now());
  for (const e of ["someone@else.test", "sam@corp.test"]) { const x = await O.req("/auth/start", f(e)); assert.equal(x.status, 429); assert.match(await x.text(), /Too many sign-in emails from this network/); }
  assert.equal(mail.length, 1);
  ok("own-address page: decoys not counted, refusal identical for any address");
}
console.log("signin-email-limit: all passed");
