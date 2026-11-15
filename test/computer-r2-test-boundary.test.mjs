import assert from "node:assert/strict";
import { Computer } from "../src/index.js";

const reads = [], commands = [];
const machine = {
  get: (key) => key === "tenant" ? "owner-a" : null,
  env: { WS: {
    head: async (key) => { reads.push(["head", key]); return { size: 4 }; },
    get: async (key, opts) => { reads.push(["get", key, opts.range]); return { body: new Response("data").body }; },
  } },
  sh: async (command) => { commands.push(["shell", command]); return { code: 0 }; },
  ctx: { container: { exec: async (argv) => { commands.push(argv); return { output: async () => ({ exitCode: 0, stdout: new Uint8Array() }) }; } } },
};

for (const key of ["t/owner-b/files/other", "backup/owner-a/index.json", "t/owner-ae/files/other"]) {
  const result = await Computer.prototype.testR2ToFile.call(machine, key, "/workspace/out", 1);
  assert.match(result.error, /key/i, `${key} must be refused`);
  assert.deepEqual(reads, [], `${key} must stop before R2`);
  assert.deepEqual(commands, [], `${key} must stop before the computer`);
}
for (const parts of [0, -1, 1.5, Infinity, 65]) {
  const result = await Computer.prototype.testR2ToFile.call(machine, "t/owner-a/exp/sample", "/workspace/out", parts);
  assert.match(result.error, /parts/i);
  assert.deepEqual(reads, [], `invalid ${parts} must stop before R2`);
}

const path = "/workspace/file; touch /tmp/escaped";
const result = await Computer.prototype.testR2ToFile.call(machine, "t/owner-a/exp/sample", path, 1);
assert.deepEqual(result, { key: "t/owner-a/exp/sample", bytes: 4, parts: 1, ms: result.ms });
assert.equal(reads.length, 2);
assert.deepEqual(commands[0], ["rm", "-f", "--", path]);
assert.deepEqual(commands[1], ["truncate", "-s", "4", "--", path]);
assert.deepEqual(commands[2].slice(0, 2), ["dd", `of=${path}`]);
assert.ok(commands.every((argv) => argv[0] !== "shell"), "the path must never enter a shell command");
console.log("ok - test R2 copy stays in tenant storage and treats the path as data");
