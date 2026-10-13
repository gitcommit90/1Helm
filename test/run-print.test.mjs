// node --import ./test/stubs/register.mjs test/run-print.test.mjs
// The gateway "px" tag carries a run part: one value per chat task, and a separate one for each helper or workflow run in that task.
import assert from "node:assert/strict";
import { runPrint, prefixPrint } from "../src/model.js";

const chat1 = { kind: "chat", session: "s1", turn: "t1" }, chat1b = { kind: "chat", session: "s1", turn: "t2" }, chat2 = { kind: "chat", session: "s2", turn: "t3" };
const helperA = { kind: "helper", session: "s1", turn: "hA" }, helperB = { kind: "helper", session: "s1", turn: "hB" }, flow = { kind: "workflow", session: "s1", turn: "wA" };
assert.equal(runPrint(chat1), runPrint(chat1b), "follow-up turns of one task share a run");
assert.notEqual(runPrint(chat1), runPrint(chat2), "different tasks differ");
assert.equal(new Set([runPrint(chat1), runPrint(helperA), runPrint(helperB), runPrint(flow)]).size, 4, "each helper and workflow run is its own run");
assert.match(runPrint(null), /^[0-9a-f]{8}$/);
assert.equal(`${prefixPrint([{ role: "system", content: "x" }], [])}.${runPrint(chat1)}`.split(".").length, 3, "px has system, tools and run parts");
console.log("run-print ok");
