// Temp folders made by a test are removed when the test process ends, whether it passed, failed or called process.exit.
// Wrap the folder at creation:  const dir = cleanupOnExit(mkdtempSync(join(tmpdir(), "x-")));
// test/tmp-cleanup.test.mjs fails when a test file creates a temp folder without this (or its own rmSync).
import { rmSync } from "node:fs";
const dirs = new Set();
let armed = false;
export function cleanupOnExit(dir) {
  dirs.add(dir);
  if (!armed) { armed = true; process.on("exit", () => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* already gone */ } } }); }
  return dir;
}
