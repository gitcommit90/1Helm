import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const child = resolve(import.meta.dirname, "channel-computers-backend-child.mjs");
for (const backend of ["lxc", "wsl"]) {
  test(`${backend.toUpperCase()} channel computer lifecycle is deterministic and ownership-gated`, () => {
    const result = spawnSync(process.execPath, [child, backend], { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8", timeout: 120_000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, new RegExp(`${backend} lifecycle ok`));
  });
}
