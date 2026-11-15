import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Computer } from "../src/index.js";

crypto.DigestStream ??= class extends WritableStream {
  constructor() {
    const hash = createHash("sha256"); let finish;
    const digest = new Promise((resolve) => { finish = resolve; });
    super({ write: (chunk) => { hash.update(chunk); }, close: () => finish(hash.digest().buffer) });
    this.digest = digest;
  }
};

const archive = gzipSync("checkpoint tar bytes");
const sha256 = createHash("sha256").update(archive).digest("hex");
const restored = async (deleted, rmCode = 0, laterDeleted = undefined) => {
  const calls = { get: 0, tar: 0, rm: 0, list: "" };
  const machine = {
    sh: async () => ({ code: 0, out: "" }), installAgent: async () => {},
    chain: () => [
      { seq: 1, kind: "delta", key: "t/owner/ckpt/1.tar.gz", bytes: archive.length, sha256, deleted: JSON.stringify(deleted) },
      ...(laterDeleted === undefined ? [] : [{ seq: 2, kind: "delta", key: "t/owner/ckpt/2.tar.gz", bytes: archive.length, sha256, deleted: JSON.stringify(laterDeleted) }]),
    ],
    env: { WS: { get: async () => { calls.get++; return { body: new Response(archive).body }; } } },
    ctx: { container: { exec: async (args, options) => {
      if (args[0] === "tar") { calls.tar++; return { output: async () => ({ exitCode: 0 }) }; }
      if (args[0] === "bash") {
        calls.rm++;
        calls.list = await new Response(options.stdin).text();
        return { output: async () => ({ exitCode: rmCode }) };
      }
      throw new Error(`unexpected command: ${args[0]}`);
    } } },
  };
  return { result: Computer.prototype.restore.call(machine), calls };
};

for (const bad of ["../outside", "/tmp/outside", "folder/../outside", "folder//outside", ".", "bad\0name"]) {
  const { result, calls } = await restored([bad]);
  await assert.rejects(result, /invalid restore deletion path/);
  assert.equal(calls.get, 0, `bad path ${JSON.stringify(bad)} must stop before R2 and tar`);
  assert.equal(calls.tar, 0);
  assert.equal(calls.rm, 0);
}
for (const badList of [null, {}, ["good", 42]]) {
  const { result, calls } = await restored(badList);
  await assert.rejects(result, /invalid restore deletion (list|path)/);
  assert.equal(calls.get, 0);
}
const laterBad = await restored(["safe.txt"], 0, ["../outside"]);
await assert.rejects(laterBad.result, /invalid restore deletion path/);
assert.equal(laterBad.calls.get, 0, "a later bad checkpoint stops before earlier layers are applied");

const failed = await restored(["docs/old.txt"], 123);
await assert.rejects(failed.result, /restore deletion failed/);
assert.equal(failed.calls.rm, 1);
assert.equal(failed.calls.list, "docs/old.txt\0");

const good = await restored(["docs/old.txt"]);
assert.equal((await good.result).sha_ok, true);
assert.equal(good.calls.rm, 1);
assert.equal(good.calls.list, "docs/old.txt\0");
const literalBackslash = await restored(["docs/old\\name.txt"]);
assert.equal((await literalBackslash.result).sha_ok, true);
console.log("ok - computer restore refuses unsafe deletion paths and failed deletes");
