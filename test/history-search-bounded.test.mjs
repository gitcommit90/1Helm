// node --import ./test/stubs/register.mjs test/history-search-bounded.test.mjs
// The recall_history tool used to run one statement over every saved message of the channel. The Resident answers nothing while
// a statement runs, so a long one could end with "storage operation exceeded timeout" and reset the object. The search is now read in small windows, newest first, and
// stops on a time budget. This test checks that the answers did not change, that the budget stops a search and says so, and that msgs has an index on turn.
import assert from "node:assert/strict";
import { world } from "./deploy-harness.mjs";
import { recallHistory } from "../src/history-search.js";

const R = world().R, sql = R.sql;
let n = 0;
const add = (turn, role, content = "", calls = null, id = null) => sql.exec("INSERT INTO msgs (turn,role,content,tool_calls,tool_call_id,at) VALUES (?,?,?,?,?,?)", turn, role, content, calls ? JSON.stringify(calls) : null, id, ++n);
const call = (id, name, args) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
add("t-old", "user", "The marmalade recipe needs 400 g of oranges");
add("t-old", "assistant", "", [call("r1", "read_file", { path: "marmalade.txt" })]);
add("t-old", "tool", "marmalade file says: boil for 40 minutes", null, "r1");
for (let i = 0; i < 400; i++) { add(`t${i}`, "user", `filler question number ${i}`); add(`t${i}`, "assistant", `filler answer number ${i}`); }
add("t-big", "tool", "x".repeat(60000) + " hiddenword", null, "none");
const ctx = { turn: "t-now" };
const run = (a, opts = {}) => recallHistory(sql, a, ctx, opts);

let passed = 0; const ok = (m) => { passed++; console.log("  ok", m); };

const whole = run({ query: "marmalade", limit: 10 }, { window: 100000 });
assert.match(whole, /400 g of oranges/); assert.match(whole, /boil for 40 minutes/); assert.match(whole, /marmalade\.txt/);
for (const window of [10, 37, 150]) assert.equal(run({ query: "marmalade", limit: 10 }, { window }), whole, `window ${window} gives the same answer`);
ok("a search in small windows gives the same answer as one pass, including a tool result and the call behind it, found 800 messages back");

assert.equal(run({ query: "hiddenword" }, { window: 50 }), "No matches in past conversation.");
ok("only the first 20000 characters of a message are searched, so a huge message does not slow the search");

const cut = run({ query: "marmalade", limit: 10 }, { window: 10, budgetMs: 0 });
assert.match(cut, /Only the newest \d+ saved messages were searched/); assert.doesNotMatch(cut, /400 g of oranges/);
assert.match(run({ query: "nothing-like-this" }, { window: 10, budgetMs: 0 }), /^No matches in the newest part of the past conversation that was searched\./);
ok("a search that uses its time budget stops, and the answer says that older messages were not searched");

const recent = run({ query: "filler answer number 399", limit: 1 }, { window: 10, budgetMs: 0 });
assert.match(recent, /number 399/); assert.doesNotMatch(recent, /Only the newest/);
ok("a search that finds enough matches before its budget ends says nothing about a limit");

const idx = sql.exec("SELECT name FROM sqlite_master WHERE type='index' AND name='msgs_turn'").toArray();
assert.equal(idx.length, 1);
ok("msgs has an index on turn (a card step, a resume and a task delete read by turn)");

console.log(`history-search-bounded: ${passed} checks passed`);
