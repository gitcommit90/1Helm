import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { installSnapshotRpc, readSnapshotManifest, readSnapshotPage, readVerifiedSnapshotPage, restoreSnapshotFromR2, restoreSnapshotPage, restoreSnapshotSequences, restoreSnapshotStepFromR2, snapshotColumns, snapshotSequences, snapshotTables, writeSnapshotStepToR2, writeSnapshotToR2 } from "../src/sqlite-snapshot.js";

const database = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE turns (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, payload BLOB); CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT)");
  const sql = { exec(query, ...args) {
    const statement = db.prepare(query);
    if (statement.columns().length) return { toArray: () => statement.all(...args) };
    statement.run(...args); return { toArray: () => [] };
  } };
  const storage = { sql, transactionSync(fn) { db.exec("BEGIN"); try { const out = fn(); db.exec("COMMIT"); return out; } catch (error) { db.exec("ROLLBACK"); throw error; } } };
  return { db, storage };
};

const source = database();
source.db.prepare("INSERT INTO turns (text,payload) VALUES (?,?)").run("hello", new Uint8Array([0, 255, 128]));
source.db.prepare("INSERT INTO turns (text,payload) VALUES (?,?)").run("world", null);
source.db.prepare("DELETE FROM turns WHERE id=2").run();
source.db.prepare("INSERT INTO kv (k,v) VALUES (?,?)").run("tenant", "owner-1");
assert.deepEqual(snapshotTables(source.storage.sql), ["kv", "turns"]);
source.db.exec('CREATE TABLE _cf_METADATA (key INTEGER PRIMARY KEY, value BLOB); CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB) WITHOUT ROWID; CREATE TABLE __miniflare_do_name (id INTEGER PRIMARY KEY, name TEXT)');
assert.deepEqual(snapshotTables(source.storage.sql), ["kv", "turns"], "platform metadata is not application data");
const oddTable = database();
oddTable.db.exec('CREATE TABLE "future-table" (id INTEGER)');
assert.throws(() => snapshotTables(oddTable.storage.sql), /unsupported snapshot table name/,
  "backup must not report success after omitting a table with an unsupported name");
const oddColumn = database();
oddColumn.db.exec('CREATE TABLE future_table ("future-column" TEXT)');
assert.throws(() => snapshotColumns(oddColumn.storage.sql, "future_table"), /unsupported snapshot column name/,
  "backup must reject a page that the restore SQL cannot address");
const first = readSnapshotPage(source.storage.sql, "turns", null, 1);
assert.equal(first.rows.length, 1);
assert.equal(first.next, 1);
assert.deepEqual(first.rows[0].values[2], { blob: "AP+A" });
assert.deepEqual(readSnapshotPage(source.storage.sql, "turns", first.next, 1).rows, []);
const kv = readSnapshotPage(source.storage.sql, "kv");
const sequences = snapshotSequences(source.storage.sql);
assert.deepEqual(sequences.map((row) => ({ ...row })), [{ name: "turns", seq: 2 }]);

const target = database();
assert.equal(restoreSnapshotPage(target.storage, JSON.parse(JSON.stringify(first))), 1);
assert.equal(restoreSnapshotPage(target.storage, JSON.parse(JSON.stringify(kv))), 1);
restoreSnapshotSequences(target.storage, sequences);
assert.deepEqual(target.db.prepare("SELECT id,text,payload FROM turns").all(), source.db.prepare("SELECT id,text,payload FROM turns").all());
assert.deepEqual(target.db.prepare("SELECT * FROM kv").all(), source.db.prepare("SELECT * FROM kv").all());
target.db.prepare("INSERT INTO turns (text) VALUES (?)").run("next");
assert.equal(target.db.prepare("SELECT MAX(id) id FROM turns").get().id, 3, "deleted AUTOINCREMENT ids remain reserved");
const empty = database();
restoreSnapshotSequences(empty.storage, sequences);
empty.db.prepare("INSERT INTO turns (text) VALUES (?)").run("after-delete");
assert.equal(empty.db.prepare("SELECT id FROM turns").get().id, 3, "sequence survives even if every source row was deleted");
assert.throws(() => restoreSnapshotPage(target.storage, { ...first, table: "other" }), /unknown snapshot table/);
assert.throws(() => restoreSnapshotPage(target.storage, { ...first, columns: ["text"] }), /schema differs/);
assert.throws(() => restoreSnapshotPage(target.storage, { ...first, rows: [{ rowid: 4, values: [] }] }), /invalid snapshot row/);
const objects = new Map();
const bucket = { async put(key, bytes) { objects.set(key, new Uint8Array(bytes)); }, async get(key) {
  const bytes = objects.get(key); return bytes && { size: bytes.length, arrayBuffer: async () => bytes.slice().buffer };
} };
source.storage.getAlarm = async () => 123456;
const written = await writeSnapshotToR2(source.storage, bucket, "backup/fixture", { kind: "Resident", name: "res:owner:main" });
assert.equal(written.key, "backup/fixture/manifest.json");
const manifest = await readSnapshotManifest(bucket, written.key);
assert.equal(manifest.alarm, 123456);
assert.deepEqual(manifest.identity, { kind: "Resident", name: "res:owner:main" });
const firstDescriptor = manifest.tables.find((entry) => entry.name === "turns").pages[0];
const verified = await readVerifiedSnapshotPage(bucket, firstDescriptor);
assert.equal(verified.rows[0].values[1], "hello");
const recovered = database();
let restoredAlarm;
recovered.storage.setAlarm = async (at) => { restoredAlarm = at; };
recovered.storage.deleteAlarm = async () => { restoredAlarm = null; };
recovered.db.prepare("INSERT INTO kv (k,v) VALUES (?,?)").run("temporary", "to be removed");
assert.deepEqual(await restoreSnapshotFromR2(recovered.storage, bucket, written.key, manifest.identity), { tables: 2, rows: 2, alarm: 123456 });
assert.equal(restoredAlarm, 123456);
assert.deepEqual(recovered.db.prepare("SELECT * FROM kv").all(), source.db.prepare("SELECT * FROM kv").all());
assert.deepEqual(recovered.db.prepare("SELECT * FROM turns").all(), source.db.prepare("SELECT * FROM turns").all());
await assert.rejects(restoreSnapshotFromR2(database().storage, bucket, written.key, { kind: "Archive", name: "res:owner:main" }), /identity mismatch/);
objects.set(firstDescriptor.key, new TextEncoder().encode("{}"));
await assert.rejects(readVerifiedSnapshotPage(bucket, firstDescriptor), /checksum mismatch/);
recovered.db.prepare("INSERT INTO kv (k,v) VALUES (?,?)").run("keep", "this");
await assert.rejects(restoreSnapshotFromR2(recovered.storage, bucket, written.key, manifest.identity), /checksum mismatch/);
assert.equal(recovered.db.prepare("SELECT v FROM kv WHERE k='keep'").get().v, "this", "corrupt source leaves destination untouched");
const memory = database();
memory.db.exec("CREATE TABLE mem_rows (id TEXT PRIMARY KEY, source TEXT, text TEXT); CREATE VIRTUAL TABLE mem_fts USING fts5(text,id UNINDEXED)");
memory.db.prepare("INSERT INTO mem_rows VALUES (?,?,?)").run("m1", "chat", "the blue notebook");
memory.db.prepare("INSERT INTO mem_fts (text,id) VALUES (?,?)").run("chat the blue notebook", "m1");
assert.deepEqual(snapshotTables(memory.storage.sql), ["kv", "mem_rows", "turns"], "FTS shadow tables are derived, not exported");
memory.storage.getAlarm = async () => null;
const savedMemory = await writeSnapshotToR2(memory.storage, bucket, "backup/memory", { kind: "Resident", name: "res:owner:memory" });
const memoryTarget = database();
memoryTarget.db.exec("CREATE TABLE mem_rows (id TEXT PRIMARY KEY, source TEXT, text TEXT); CREATE VIRTUAL TABLE mem_fts USING fts5(text,id UNINDEXED)");
memoryTarget.storage.deleteAlarm = async () => {};
await restoreSnapshotFromR2(memoryTarget.storage, bucket, savedMemory.key, savedMemory.manifest.identity);
assert.equal(memoryTarget.db.prepare("SELECT id FROM mem_fts WHERE mem_fts MATCH 'notebook'").get().id, "m1", "memory search is rebuilt from rows");
class ExampleObject { constructor(storage, env) { this.ctx = { storage }; this.env = env; this.busy = false; } }
installSnapshotRpc(ExampleObject, "Example", (self) => self.busy);
memory.storage.kv = { list: () => new Map().entries() };
const object = new ExampleObject(memory.storage, { ENV_NAME: "dev", WS: bucket });
await assert.rejects(object.snapshotBackupStep("backup/blocked", "example"), /unavailable/);
object.env.ENV_NAME = "selfhost"; object.env.BACKUP_MAINTENANCE = "1"; object.busy = true;
await assert.rejects(object.snapshotBackupStep("backup/blocked", "example"), /busy/);
object.busy = false;
let rpcBackup;
do { rpcBackup = await object.snapshotBackupStep("backup/rpc", "example"); } while (!rpcBackup.done);
assert.equal(rpcBackup.kind, "Example");
memoryTarget.storage.kv = { get: () => undefined, put: () => {} };
const restoredObject = new ExampleObject(memoryTarget.storage, { ENV_NAME: "selfhost", BACKUP_MAINTENANCE: "1", BACKUP_RESTORE_MODE: "1", WS: bucket });
await assert.rejects(restoredObject.snapshotRestoreStep(rpcBackup.key, "wrong"), /identity mismatch/);
const large = database();
large.db.prepare("INSERT INTO turns (text,payload) VALUES (?,?)").run("too big", new Uint8Array(7 * 1024 * 1024));
large.storage.getAlarm = async () => null;
await assert.rejects(writeSnapshotToR2(large.storage, bucket, "backup/oversize", { kind: "Resident", name: "large" }), /row exceeds page limit/);
assert.equal(objects.has("backup/oversize/manifest.json"), false, "an incomplete snapshot never gets a completion manifest");
const paged = database();
for (let i = 0; i < 650; i++) paged.db.prepare("INSERT INTO turns (text) VALUES (?)").run(`row-${i}`);
paged.storage.getAlarm = async () => null;
paged.storage.kv = { list: () => new Map().entries() };
let interrupted = false;
const flaky = { get: bucket.get, async put(key, bytes, opts) {
  if (!interrupted && key === "backup/paged/progress.json" && objects.has("backup/paged/turns/00000000.json")) {
    interrupted = true; throw new Error("lost after page write");
  }
  return bucket.put(key, bytes, opts);
} };
await writeSnapshotStepToR2(paged.storage, flaky, "backup/paged", { kind: "Resident", name: "res:owner:paged" });
await assert.rejects(writeSnapshotStepToR2(paged.storage, flaky, "backup/paged", { kind: "Resident", name: "res:owner:paged" }), /lost after page write/);
let pagedResult;
for (let step = 0; step < 30; step++) {
  pagedResult = await writeSnapshotStepToR2(paged.storage, bucket, "backup/paged", { kind: "Resident", name: "res:owner:paged" });
  if (pagedResult.done) break;
}
assert.equal(pagedResult.done, true);
const emptyList = paged.storage.kv.list;
paged.storage.kv.list = () => new Map([["application-key", "would-be-lost"]]).entries();
await assert.rejects(writeSnapshotStepToR2(paged.storage, bucket, "backup/unsupported-kv", { kind: "Resident", name: "res:owner:paged" }), /unsupported Durable Object KV/);
paged.storage.kv.list = emptyList;
const pagedManifest = await readSnapshotManifest(bucket, pagedResult.key);
assert.ok(pagedManifest.tables.find((entry) => entry.name === "turns").pages.length > 1, "large tables use multiple requests");
const pagedTarget = database(), progress = new Map();
pagedTarget.storage.kv = { get: (key) => progress.get(key), put: (key, value) => progress.set(key, value) };
pagedTarget.storage.deleteAlarm = async () => {};
pagedTarget.storage.setAlarm = async () => {};
pagedTarget.db.prepare("INSERT INTO kv (k,v) VALUES (?,?)").run("must_preserve", "until preflight");
const pagedDescriptor = pagedManifest.tables.find((entry) => entry.name === "turns").pages[0];
const realPage = objects.get(pagedDescriptor.key);
objects.set(pagedDescriptor.key, new TextEncoder().encode("{}"));
await assert.rejects((async () => {
  for (let step = 0; step < 30; step++) await restoreSnapshotStepFromR2(pagedTarget.storage, bucket, pagedResult.key, { kind: "Resident", name: "res:owner:paged" });
})(), /checksum mismatch/);
assert.equal(pagedTarget.db.prepare("SELECT v FROM kv WHERE k='must_preserve'").get().v, "until preflight");
objects.set(pagedDescriptor.key, realPage);
let restoreResult;
for (let step = 0; step < 50; step++) {
  restoreResult = await restoreSnapshotStepFromR2(pagedTarget.storage, bucket, pagedResult.key, { kind: "Resident", name: "res:owner:paged" });
  if (restoreResult.done) break;
}
assert.equal(restoreResult.done, true);
assert.deepEqual(pagedTarget.db.prepare("SELECT text FROM turns ORDER BY id").all(), paged.db.prepare("SELECT text FROM turns ORDER BY id").all());
assert.equal(pagedTarget.db.prepare("SELECT COUNT(*) n FROM kv WHERE k='must_preserve'").get().n, 0);
console.log("ok - SQLite snapshot pages preserve BLOBs, row IDs and AUTOINCREMENT across a fresh database");
