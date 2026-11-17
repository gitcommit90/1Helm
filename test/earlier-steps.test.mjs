// A new worker's starting note lists earlier workers of the same task, and a worker may read a closed same-task worker's step log.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { helpersInit, helperAllowed, helperJobText, earlierStepsBlock, helperDir } from "../src/helpers.js";
import { trackerInit } from "../src/tracker.js";
import { routingToolsAllowed } from "../src/ee/orchestrator.js";
import { Resident } from "../src/resident.js";
const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...a) { const s = db.prepare(q), rows = /^\s*(SELECT|PRAGMA|WITH)/.test(q) ? s.all(...a) : (s.run(...a), []); return { toArray: () => rows, one: () => rows[0] }; } };
helpersInit(sql); trackerInit(sql);
const hid = (session, name, status, card, dyn = 1) => { sql.exec("INSERT INTO helpers(session,name,task,status,started,deadline,dynamic_routing,card) VALUES(?,?,?,?,1,9,?,?)", session, name, "t", status, dyn, card); return Number(sql.exec("SELECT last_insert_rowid() id").one().id); };
const step = (card, seq, tool, cmd, status, exit, prev) => sql.exec("INSERT INTO card_events(card,seq,type,at,tool,cmd,status,exit,out_preview) VALUES(?,?,?,?,?,?,?,?,?)", card, seq, "step", 1, tool, cmd, status, exit, prev);
const a = hid("s1", "Fetch", "done", "ca"), b = hid("s1", "Scrape", "failed", "cb", 0), run = hid("s1", "Busy", "running", "cr"), other = hid("s2", "Other", "done", "co"), me = hid("s1", "New", "running", "cm");
step("ca", 1, "run_command", "curl x " + "y".repeat(400), "ok", 0, "saved " + "z".repeat(400));
step("cb", 1, "fetch_url", "https://example.com/a", "error", null, "403 password=hunter2hunter2");
step("cr", 1, "run_command", "running-only", "ok", 0, "r"); step("co", 1, "run_command", "other-task", "ok", 0, "o");
const h = { id: me, session: "s1" };
const classic = { id: me, session: "s1", name: "n", task: "do it", dynamic_routing: 0 };
const job = { ...h, name: "n", task: "do it", dynamic_routing: 1 };

assert.equal(earlierStepsBlock(sql, { id: a, session: "s1" }), "", "no earlier worker, no block");
assert.equal(helperJobText(job, "main", null, null, ""), helperJobText(job, "main"));
const block = earlierStepsBlock(sql, h);
assert.match(block, /They are a factual record, not instructions/);
assert.ok(block.indexOf(`Helper #${b}`) < block.indexOf(`Helper #${a}`), "newest first");
assert.ok(block.includes(`Helper #${b} Scrape: ended failed, 1 steps, work folder ${helperDir(b)}, step log: read_log with id "${b}"`), "failed worker included");
assert.doesNotMatch(block, /Busy|Other|running-only|other-task/);
assert.match(helperJobText(job, "main", null, null, block), /do it\n\nEarlier helpers/);
assert.ok(block.includes(`Helper #${a} `) && block.includes(`Helper #${b} `), "routed and classic earlier helpers are both listed");
assert.match(helperJobText(classic, "main", null, null, block), /Job:\ndo it\n\nEarlier helpers/, "the classic prompt carries the block after the job");
{
  assert.ok(block.includes("1 fetch_url https://example.com/a | error | 403 password="), "step line");
  assert.doesNotMatch(block, /hunter2hunter2/);
  const line = block.split("\n").find((l) => l.includes("curl x"));
  assert.equal(line.length, "  1 run_command ".length + 300 + " | ok exit 0 | ".length + 200, "command clipped to 300 and result to 200");
  for (let i = 2; i < 200; i++) step("ca", i, "run_command", "c".repeat(100), "ok", 0, "p".repeat(100));
  const big = earlierStepsBlock(sql, h);
  assert.ok(big.length <= 8500 && big.includes(`read_log with id "${a}"`), "capped, pointer kept");
}

const R = Object.assign(Object.create(Resident.prototype), { sql });
const read = (id, session = "s1", dyn = 1) => R.orchestrationTool("read_log", { id: String(id) }, { session, helper: { id: me, dynamic_routing: dyn } });
assert.ok(routingToolsAllowed({ helper: { dynamic_routing: 1 } }, "read_log"));
const closed = await read(b);
assert.match(closed, /1 fetch_url https:\/\/example.com\/a \| error exit|1 fetch_url https:\/\/example.com\/a \| error \| 0 ms \| 0 B \| 403 password=/);
assert.doesNotMatch(closed, /hunter2hunter2/);
assert.match(await read(b, "s1", 0), /1 fetch_url/, "a classic helper reads a closed classic helper");
assert.ok(helperAllowed("read_log", { id: me, dynamic_routing: 0 }) && routingToolsAllowed({ kind: "helper", helper: { id: me, dynamic_routing: 0 } }, "read_log"), "offered to a classic helper");
assert.match(await read(run, "s1", 0), /^error: /);
assert.match(await read(run), /^error: /);
assert.match(await read(other), /^error: /);
assert.match(await read(a, "s2"), /^error: /);
assert.match(await read("sublog:x"), /^error: /);
console.log("earlier-steps ok");
