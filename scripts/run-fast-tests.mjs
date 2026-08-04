#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { selectFastTests } from "./fast-test-lib.mjs";

const root = resolve(import.meta.dirname, "..");
try {
  const tests = selectFastTests(root, process.argv.slice(2));
  process.stdout.write(`Fast test selection: ${tests.join(", ")}\n`);
  process.stdout.write("This is an inner-loop check only; npm run ci remains required before merge.\n");
  const result = spawnSync(process.execPath, ["--test", ...tests], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "test" },
    stdio: "inherit",
  });
  process.exitCode = result.status || (result.signal ? 1 : 0);
} catch (error) {
  process.stderr.write(`Fast test selection error: ${error.message}\n`);
  process.stderr.write("Usage: npm run test:fast -- [test/focused-file.mjs ...]\n");
  process.stderr.write("npm run ci remains required before merge.\n");
  process.exitCode = 2;
}
