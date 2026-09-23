import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/client/board-operations.ts", import.meta.url), "utf8");

test("Board exposes Cancel while a scheduled wake is actively running", () => {
  assert.match(source, /h\("div", \{ class: "flex items-center gap-1" \}, cancel, running \? null : bump\)/);
  assert.doesNotMatch(source, /running \? null : h\("div", \{ class: "flex items-center gap-1" \}, cancel, bump\)/);
  assert.match(source, /thread\.followup && \["pending", "running"\]\.includes\(thread\.followup\.status\) \? followupMeta\(thread\) : null/);
});
