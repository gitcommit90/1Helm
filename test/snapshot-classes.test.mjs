import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Resident } from "../src/resident.js";
import { ChannelComputer } from "../src/channel-computer.js";
import { UsageLedger } from "../src/usage-ledger.js";
import { Archive, Computer } from "../src/index.js";
import { FilePrep } from "../src/sidecar.js";
import { snapshotTables } from "../src/sqlite-snapshot.js";

const objects = new Map();
const bucket = {
  async put(key, value) { objects.set(key, typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value)); },
  async get(key) { const bytes = objects.get(key); return bytes && { size: bytes.length, arrayBuffer: async () => bytes.slice().buffer }; },
};
const env = { ENV_NAME: "selfhost", BACKUP_MAINTENANCE: "1", BACKUP_RESTORE_MODE: "1", WS: bucket };

function object(Class) {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(query, ...args) {
    if (!args.length && query.split(";").filter((part) => part.trim()).length > 1) { db.exec(query); return { toArray: () => [], one: () => undefined }; }
    const statement = db.prepare(query);
    const rows = statement.columns().length ? statement.all(...args) : (statement.run(...args), []);
    return { toArray: () => rows, one: () => rows[0] };
  } };
  let alarm = null;
  const values = new Map();
  const storage = { sql,
    kv: { get: (key) => values.get(key), put: (key, value) => values.set(key, value), list: () => values.entries() },
    transactionSync(fn) { const before = new Map(values); db.exec("BEGIN"); try { const result = fn(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); values.clear(); for (const [key, value] of before) values.set(key, value); throw error; } },
    getAlarm: async () => alarm, setAlarm: async (value) => { alarm = value; }, deleteAlarm: async () => { alarm = null; },
  };
  const ctx = { storage, container: { running: false }, waitUntil() {} };
  const holder = { db, sql, instance: new Class(ctx, env), alarm: () => alarm };
  holder.restart = () => { holder.instance = new Class(ctx, env); };
  return holder;
}

for (const [Class, kind, name] of [
  [Resident, "Resident", "res:owner:main"],
  [ChannelComputer, "ChannelComputer", "cc:owner:main"],
  [UsageLedger, "UsageLedger", "tenant:owner"],
  [Archive, "Archive", "archive:owner"],
  [Computer, "Computer", "computer:owner"],
  [FilePrep, "FilePrep", "prep:t/owner/files/example"],
]) {
  const source = object(Class);
  if (kind === "UsageLedger") source.db.prepare("INSERT INTO msgs (role,content,at) VALUES (?,?,?)").run("user", "snapshot_probe", 1);
  else if (kind === "Archive") source.db.prepare("INSERT INTO rows (tbl,id,channel_id,data) VALUES (?,?,?,?)").run("channels", "1", null, '{"slug":"main"}');
  else source.db.prepare("INSERT INTO kv (k,v) VALUES (?,?)").run("snapshot_probe", kind);
  if (kind === "Resident") {
    source.db.prepare("INSERT INTO kv (k,v) VALUES (?,?)").run("boots", '[{"v":"before-backup","at":1}]');
    source.db.prepare("INSERT INTO turns (id,at,user_text) VALUES (?,?,?)").run("legacy-turn", 1, "before tasks");
  }
  await source.instance.ctx.storage.setAlarm(123456789);
  let saved;
  for (let step = 0; step < 1000; step++) {
    saved = await source.instance.snapshotBackupStep(`backup/class-${kind}`, name);
    if (saved.done) break;
    source.restart();
  }
  assert.equal(saved.done, true, `${kind} backup completes in bounded steps`);
  const target = object(Class);
  let restored;
  for (let step = 0; step < 1000; step++) {
    restored = await target.instance.snapshotRestoreStep(saved.key, name);
    if (restored.done) break;
    target.restart();
  }
  assert.equal(restored.done, true, `${kind} restore completes in bounded steps`);
  if (kind === "UsageLedger") assert.equal(target.db.prepare("SELECT content FROM msgs").get().content, "snapshot_probe");
  else if (kind === "Archive") assert.equal(target.db.prepare("SELECT data FROM rows").get().data, '{"slug":"main"}');
  else assert.equal(target.db.prepare("SELECT v FROM kv WHERE k='snapshot_probe'").get().v, kind);
  assert.equal(target.alarm(), 123456789);
  assert.deepEqual(snapshotTables(target.sql), snapshotTables(source.sql), `${kind} table schema`);
  for (const table of snapshotTables(source.sql)) {
    const sourceRows = source.sql.exec(`SELECT * FROM "${table}" ORDER BY rowid`).toArray();
    const restoredRows = target.sql.exec(`SELECT * FROM "${table}" ORDER BY rowid`).toArray();
    assert.deepEqual(restoredRows, sourceRows, `${kind}.${table} rows`);
  }
  source.db.close(); target.db.close();
}
console.log("ok - all six real Durable Object schemas round-trip through R2 snapshots");
