import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const testRoot = mkdtempSync(join(tmpdir(), "1helm-read-state-"));
process.env.CTRL_DATA_DIR = join(testRoot, "data");

const database = await import("../src/server/db.ts");
const readState = await import("../src/server/read-state.ts");

test("WAL commits and checkpoints do not synchronously fsync the HTTP connection", () => {
  assert.equal(Number(database.q1("PRAGMA synchronous")?.synchronous), 1, "the HTTP connection uses synchronous=NORMAL");
  assert.equal(Number(database.q1("PRAGMA wal_autocheckpoint")?.wal_autocheckpoint), 0, "foreground automatic checkpoints are disabled");
});

test("read receipts are coalesced and can never move backward", async () => {
  const stamp = Date.now();
  const userId = database.run("INSERT INTO users (username,pass,display,created) VALUES ('reader','x','Reader',?)", stamp).lastInsertRowid;
  const channelId = database.run("INSERT INTO channels (name,created) VALUES ('reads',?)", stamp).lastInsertRowid;
  database.run("INSERT INTO members (channel_id,user_id,last_read) VALUES (?,?,?)", channelId, userId, 2);

  readState.queueLastRead(userId, channelId, 8);
  readState.queueLastRead(userId, channelId, 12);
  readState.queueLastRead(userId, channelId, 9);
  await readState.flushLastReads();
  assert.equal(Number(database.q1("SELECT last_read FROM members WHERE channel_id=? AND user_id=?", channelId, userId)?.last_read), 12);

  readState.queueLastRead(userId, channelId, 4);
  await readState.flushLastReads();
  assert.equal(Number(database.q1("SELECT last_read FROM members WHERE channel_id=? AND user_id=?", channelId, userId)?.last_read), 12);
});

test("fleet reconciliation defaults avoid startup and once-a-minute I/O storms", async () => {
  const source = await readFile(join(root, "src", "server", "channel-computers.ts"), "utf8");
  assert.match(source, /HELM_FLEET_INTERVAL_MS \|\| 5 \* 60_000/);
  assert.match(source, /HELM_FLEET_INITIAL_MS \|\| 30_000/);
});

test.after(async () => {
  await readState.shutdownReadStateWorker();
  database.db.close();
  rmSync(testRoot, { recursive: true, force: true });
});
