import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";

if (!parentPort) throw new Error("read-state worker requires a parent port");

const db = new DatabaseSync(workerData.databasePath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA wal_autocheckpoint = 0; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
const updateLastRead = db.prepare(`INSERT INTO members (channel_id, user_id, last_read) VALUES (?,?,?)
  ON CONFLICT(channel_id,user_id) DO UPDATE SET last_read=MAX(members.last_read, excluded.last_read)`);
const pending = new Map();
const flushRequests = new Set();
let flushTimer = null;

function keyFor(userId, channelId) {
  return `${userId}:${channelId}`;
}

function scheduleFlush(delay = 25) {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPending();
  }, delay);
  flushTimer.unref();
}

function acknowledgeFlushes() {
  for (const requestId of flushRequests) parentPort.postMessage({ type: "flushed", requestId });
  flushRequests.clear();
}

function flushPending() {
  if (pending.size === 0) {
    acknowledgeFlushes();
    return;
  }
  const updates = [...pending.values()];
  try {
    db.exec("BEGIN IMMEDIATE");
    for (const update of updates) updateLastRead.run(update.channelId, update.userId, update.lastRead);
    db.exec("COMMIT");
    for (const update of updates) {
      const key = keyFor(update.userId, update.channelId);
      if (pending.get(key)?.lastRead <= update.lastRead) pending.delete(key);
    }
    acknowledgeFlushes();
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    parentPort.postMessage({ type: "warning", message: error instanceof Error ? error.message : String(error) });
    scheduleFlush(250);
  }
}

parentPort.on("message", (message) => {
  if (message?.type === "update") {
    const key = keyFor(message.userId, message.channelId);
    const previous = pending.get(key);
    if (!previous || message.lastRead > previous.lastRead) pending.set(key, message);
    scheduleFlush();
    return;
  }
  if (message?.type === "flush") {
    flushRequests.add(message.requestId);
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    flushPending();
  }
});

const checkpointTimer = setInterval(() => {
  try {
    db.prepare("PRAGMA wal_checkpoint(PASSIVE)").all();
  } catch (error) {
    parentPort.postMessage({ type: "warning", message: `passive checkpoint failed: ${error instanceof Error ? error.message : String(error)}` });
  }
}, 30_000);
checkpointTimer.unref();
