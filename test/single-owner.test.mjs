import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ownerAccount, ownerAllowsEmail } from "../src/single-owner.js";

const sql = new DatabaseSync(":memory:");
sql.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)");
const prepare = (query) => {
  const stmt = sql.prepare(query);
  let args = [];
  const bound = { bind(...next) { args = next; return bound; }, first: async () => stmt.get(...args) || null,
    run: async () => ({ meta: { changes: Number(stmt.run(...args).changes) } }), _run: () => stmt.run(...args) };
  return bound;
};
const env = { DB: { prepare, batch: async (statements) => {
  sql.exec("BEGIN");
  try { for (const statement of statements) statement._run(); sql.exec("COMMIT"); }
  catch (error) { sql.exec("ROLLBACK"); throw error; }
} } };

assert.equal(await ownerAllowsEmail(env, "one@example.com"), true);
const [first, competitor] = await Promise.all([ownerAccount(env, "one@example.com"), ownerAccount(env, "two@example.com")]);
assert.ok(first && !competitor);
assert.equal(sql.prepare("SELECT COUNT(*) n FROM users").get().n, 1);
assert.equal((await ownerAccount(env, "one@example.com")).id, first.id);
assert.equal(await ownerAllowsEmail(env, "two@example.com"), false);
assert.equal(await ownerAllowsEmail(env, "one@example.com"), true);

sql.prepare("UPDATE users SET email=? WHERE id=?").run("new@example.com", first.id);
assert.equal(await ownerAllowsEmail(env, "one@example.com"), false);
assert.equal((await ownerAccount(env, "new@example.com")).id, first.id);
sql.prepare("DELETE FROM users WHERE id=?").run(first.id);
sql.prepare("DELETE FROM single_owner WHERE user_id=?").run(first.id);
assert.ok(await ownerAccount(env, "two@example.com"));
console.log("ok - first completed sign-in wins; only its account can return; deletion reopens the server");
