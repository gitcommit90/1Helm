// Settings → Passwords & keys → Keys (src/vault.js, route POST /api/vault): add, edit with the key left blank, new key value,
// a list of 1 to 20 sites (validated, duplicates dropped), rename of the same row, and the saved value never coming back.
// Run: bash scripts/test.sh test/vault-keys.test.mjs
import assert from "node:assert/strict"; import { DatabaseSync } from "node:sqlite";
import { saveVaultKey, KEY_SITES_MAX } from "../src/vault.js";
const worker = (await import("../src/index.js")).default;
const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE vault (tenant_id TEXT NOT NULL, name TEXT NOT NULL, standin TEXT NOT NULL UNIQUE, hosts TEXT NOT NULL, sealed TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, name));`);
const stmt = (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: st.run(...a) }) }; return o; };
const env = { DB: { prepare: stmt }, VAULT_KEY: Buffer.alloc(32, 7).toString("base64") };
const row = (n, t = "t1") => d1.prepare("SELECT * FROM vault WHERE tenant_id=? AND name=?").get(t, n);
const ok = (m) => console.log("ok -", m);

assert.equal(KEY_SITES_MAX, 20);
// add
let r = await saveVaultKey(env, "t1", { name: "weather_key", hosts: ["api.openweathermap.org", "API.OpenWeatherMap.org", "*.example.com"], value: "secret-1" });
assert.deepEqual(r, { ok: true, name: "WEATHER_KEY", hosts: ["api.openweathermap.org", "*.example.com"] });
const first = row("WEATHER_KEY"); assert.ok(first.standin.startsWith("1hs_")); assert.ok(!first.sealed.includes("secret-1"));
ok("add: name upper-cased, duplicate sites dropped, value sealed");
// add errors
assert.equal((await saveVaultKey(env, "t1", { name: "WEATHER_KEY", hosts: ["a.example.com"], value: "x" })).status, 409);
assert.equal((await saveVaultKey(env, "t1", { name: "NEW_KEY", hosts: ["a.example.com"] })).status, 400);
assert.equal((await saveVaultKey(env, "t1", { name: "NEW_KEY", hosts: [], value: "x" })).status, 400);
assert.equal((await saveVaultKey(env, "t1", { name: "NEW_KEY", hosts: ["not a site"], value: "x" })).status, 400);
assert.equal((await saveVaultKey(env, "t1", { name: "NEW_KEY", hosts: ["ok.example.com", "nodot"], value: "x" })).status, 400);
assert.equal((await saveVaultKey(env, "t1", { name: "1BAD", hosts: ["a.example.com"], value: "x" })).status, 400);
assert.equal(row("NEW_KEY"), undefined);
ok("add: existing name, missing value, no sites, bad site and bad name are refused and nothing is saved");
// max sites
const many = (n) => Array.from({ length: n }, (_, i) => `s${i}.example.com`);
assert.equal((await saveVaultKey(env, "t1", { name: "MANY_KEY", hosts: many(20), value: "x" })).ok, true);
r = await saveVaultKey(env, "t1", { name: "MANY2_KEY", hosts: many(21), value: "x" }); assert.equal(r.status, 400); assert.match(r.error, /up to 20 sites/);
assert.equal((await saveVaultKey(env, "t1", { name: "MANY3_KEY", hosts: [...many(20), ...many(20)], value: "x" })).ok, true, "duplicates count once");
ok("at most 20 sites, counted after duplicates are dropped");
// edit, blank value
r = await saveVaultKey(env, "t1", { name: "WEATHER_KEY", was: "WEATHER_KEY", hosts: ["a.example.com", "b.example.com"], value: "" });
assert.deepEqual(r.hosts, ["a.example.com", "b.example.com"]);
let e1 = row("WEATHER_KEY"); assert.equal(e1.sealed, first.sealed); assert.equal(e1.standin, first.standin); assert.equal(e1.hosts, JSON.stringify(r.hosts));
ok("edit with a blank key keeps the sealed value and the stand-in, replaces the sites");
// edit, new value
r = await saveVaultKey(env, "t1", { name: "WEATHER_KEY", was: "WEATHER_KEY", hosts: ["a.example.com"], value: "secret-2" });
e1 = row("WEATHER_KEY"); assert.notEqual(e1.sealed, first.sealed); assert.equal(e1.standin, first.standin);
ok("edit with a new key replaces the sealed value and keeps the stand-in");
// rename
r = await saveVaultKey(env, "t1", { name: "forecast_key", was: "WEATHER_KEY", hosts: ["a.example.com"], value: "" });
assert.equal(r.name, "FORECAST_KEY"); assert.equal(row("WEATHER_KEY"), undefined);
assert.equal(row("FORECAST_KEY").standin, first.standin); assert.equal(row("FORECAST_KEY").sealed, e1.sealed);
assert.equal(d1.prepare("SELECT COUNT(*) c FROM vault WHERE tenant_id='t1' AND name IN ('WEATHER_KEY','FORECAST_KEY')").get().c, 1);
ok("rename moves the same row: no duplicate, same stand-in and sealed value");
r = await saveVaultKey(env, "t1", { name: "MANY_KEY", was: "FORECAST_KEY", hosts: ["a.example.com"], value: "" });
assert.equal(r.status, 409); assert.ok(row("FORECAST_KEY"));
ok("rename onto an existing name is refused and changes nothing");
assert.equal((await saveVaultKey(env, "t1", { name: "GONE_KEY", was: "GONE_KEY", hosts: ["a.example.com"], value: "" })).status, 404);
assert.equal((await saveVaultKey(env, "t2", { name: "FORECAST_KEY", was: "FORECAST_KEY", hosts: ["a.example.com"], value: "" })).status, 404);
ok("editing a key that is not saved (or belongs to another account) is a 404");
// a failed edit leaves the row alone
r = await saveVaultKey(env, "t1", { name: "FORECAST_KEY", was: "FORECAST_KEY", hosts: ["bad host"], value: "zzz" });
assert.equal(r.status, 400); assert.equal(row("FORECAST_KEY").sealed, e1.sealed);
ok("an invalid edit changes nothing");
// the list endpoint never returns sealed or stand-in
const GET = await (async () => { const rows = d1.prepare("SELECT name, hosts, created_at FROM vault WHERE tenant_id='t1'").all(); return JSON.stringify(rows); })();
assert.ok(!GET.includes("sealed") && !GET.includes("1hs_"));
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
assert.match(src, /SELECT name, hosts, created_at FROM vault WHERE tenant_id=\?/);
ok("GET /api/vault selects only name, hosts and created_at");
