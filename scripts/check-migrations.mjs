// Exercise the public D1 migration set against a genuinely empty SQLite DB.
// Wrangler records each file's full name and applies only unapplied files.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const directory = resolve(import.meta.dirname, "../db/migrations");
const files = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
assert.ok(files.length > 0, "no migrations");
const db = new DatabaseSync(":memory:");
const upgraded = new DatabaseSync(":memory:");
for (const [index, name] of files.entries()) {
  assert.equal(Number(name.slice(0, 4)), index + 1, `migration sequence at ${name}`);
  try { db.exec(readFileSync(resolve(directory, name), "utf8")); }
  catch (error) { throw new Error(`${name}: ${error.message}`, { cause: error }); }
}
// Simulate an installed October 9 database, including an existing owner's row,
// before applying only the newly appended migration suffix.
for (const name of files.slice(0, 40)) upgraded.exec(readFileSync(resolve(directory, name), "utf8"));
upgraded.prepare("INSERT INTO users(id,email,created_at) VALUES(?,?,?)").run("upgrade-probe", "owner@example.com", 1);
for (const name of files.slice(40)) upgraded.exec(readFileSync(resolve(directory, name), "utf8"));
assert.equal(upgraded.prepare("SELECT email FROM users WHERE id=?").get("upgrade-probe").email, "owner@example.com");
const schema = database => database.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();
assert.deepEqual(schema(upgraded), schema(db), "existing-install upgrade schema matches a fresh install");
const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
for (const name of ["users", "tenants", "sessions", "magic_links", "single_owner", "byok", "storage_usage", "deletion_jobs", "email_changes", "signin_code_fails"])
  assert.ok(tables.has(name), `${name} is missing`);
const columns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
for (const name of ["created_at", "ua", "place"]) assert.ok(columns("sessions").has(name), `sessions.${name} is missing`);
for (const name of ["plan", "onboarding_completed", "slug_chosen", "host_ready", "ai_privacy"]) assert.ok(columns("tenants").has(name), `tenants.${name} is missing`);
console.log(`ok - ${files.length} ordered migrations build a fresh owner-capable D1 schema`);
console.log(`ok - existing 40-migration install upgrades through ${files.length}, retaining its owner`);
