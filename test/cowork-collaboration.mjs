import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "1helm-cowork-collab-"));
process.env.CTRL_DATA_DIR = dataDir;
await import("../src/server/db.ts");
const { textReplaceOps } = await import("../src/server/cowork-collaboration.ts");

test("textReplaceOps is a no-op for identical strings", () => {
  assert.equal(textReplaceOps("hello", "hello"), null);
  assert.equal(textReplaceOps("", ""), null);
});

test("textReplaceOps edits only the middle span that changed", () => {
  const ops = textReplaceOps("alpha beta gamma", "alpha BETA gamma");
  assert.deepEqual(ops, { start: 6, deleteLen: 4, insert: "BETA" });
});

test("textReplaceOps handles pure insert and pure delete", () => {
  assert.deepEqual(textReplaceOps("ab", "aXb"), { start: 1, deleteLen: 0, insert: "X" });
  assert.deepEqual(textReplaceOps("aXb", "ab"), { start: 1, deleteLen: 1, insert: "" });
});

test("textReplaceOps replaces the whole document when nothing is shared", () => {
  assert.deepEqual(textReplaceOps("aaa", "bbb"), { start: 0, deleteLen: 3, insert: "bbb" });
});

test("textReplaceOps keeps a long shared prefix/suffix so scroll anchors stay valid", () => {
  const head = "line\n".repeat(80);
  const tail = "end\n".repeat(40);
  const prev = `${head}OLD${tail}`;
  const next = `${head}NEW${tail}`;
  const ops = textReplaceOps(prev, next);
  assert.equal(ops?.start, head.length);
  assert.equal(ops?.deleteLen, 3);
  assert.equal(ops?.insert, "NEW");
});

process.on("exit", () => {
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
});
