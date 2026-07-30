import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

test("OCI channel computer lifecycle uses authoritative storage and digest-verified recovery", () => {
  const child = resolve(import.meta.dirname, "channel-computers-backend-child.mjs");
  const result = spawnSync(process.execPath, [child], { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8", timeout: 120_000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /oci lifecycle ok/);
});
