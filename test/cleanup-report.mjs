import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAge,
  formatBytes,
  formatCleanupReport,
  isGeneratedAgentBackup,
  scanDirectory,
} from "../scripts/cleanup-report-lib.mjs";

test("cleanup report recognizes only the timestamped backup pattern", () => {
  assert.equal(isGeneratedAgentBackup("agent.ts.bak-normal-terminal-20260804-024305"), true);
  assert.equal(isGeneratedAgentBackup("agent.ts"), false);
  assert.equal(isGeneratedAgentBackup("other.ts.bak-normal-terminal-20260804-024305"), false);
});

test("an existing generated directory remains present but incomplete when enumeration fails", async () => {
  const directoryStat = { isDirectory: () => true, isSymbolicLink: () => false };
  const scan = await scanDirectory("/generated", "Generated", ".generated/", {
    lstatImpl: async () => directoryStat,
    readdirImpl: async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); },
  });
  assert.equal(scan.exists, true);
  assert.equal(scan.incomplete, true);
  assert.equal(scan.fileCount, 0);
  assert.match(formatCleanupReport({ checkedAt: new Date().toISOString(), paths: [scan] }), /present, but contents could not be fully enumerated[\s\S]*scan incomplete/);
});

test("cleanup report formats sizes and ages for a nontechnical reader", () => {
  assert.equal(formatBytes(999), "999 B");
  assert.equal(formatBytes(1536), "1.5 KiB");
  assert.equal(formatAge(Date.UTC(2026, 7, 2), Date.UTC(2026, 7, 4, 12)), "2 days");

  const text = formatCleanupReport({
    checkedAt: "2026-08-04T12:00:00.000Z",
    readOnly: true,
    removed: false,
    paths: [
      { label: "Release scratch data", path: ".release-tmp/", exists: true, fileCount: 2, bytes: 1536, oldestMtimeMs: Date.UTC(2026, 7, 2), newestMtimeMs: Date.UTC(2026, 7, 4), incomplete: false },
      { label: "Native test data", path: ".native-test-data/", exists: false, fileCount: 0, bytes: 0, oldestMtimeMs: null, newestMtimeMs: null, incomplete: false },
      { label: "Timestamped backups", path: "src/server/agent.ts.bak-normal-terminal-<timestamp>", exists: true, fileCount: 1, bytes: 12, oldestMtimeMs: Date.UTC(2026, 7, 4), newestMtimeMs: Date.UTC(2026, 7, 4), incomplete: true },
    ],
  });
  assert.match(text, /2 files, 1\.5 KiB/);
  assert.match(text, /Status: not present/);
  assert.match(text, /scan incomplete/);
  assert.match(text, /nothing was removed/i);
});
