import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Archive, finishImport, handleImport } from "../src/index.js";
import { IMPORT_MAX_LINE, IMPORT_MAX_MANIFEST, readImportManifest, readImportRows, validateImportManifest } from "../src/import-data.js";
import { verifyImportLayer } from "../src/import-tar.js";

const data = new DatabaseSync(":memory:");
const sql = { exec: (query, ...args) => {
  if (!args.length && query.split(";").filter((x) => x.trim()).length > 1) { data.exec(query); return { toArray: () => [], one: () => undefined }; }
  const st = data.prepare(query), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(query) ? st.all(...args) : (st.run(...args), []);
  return { toArray: () => rows, one: () => rows[0] };
} };
const storage = { sql, transactionSync: (fn) => { data.exec("BEGIN"); try { const out = fn(); data.exec("COMMIT"); return out; } catch (e) { data.exec("ROLLBACK"); throw e; } } };
crypto.DigestStream ??= class extends WritableStream { constructor() { const h = createHash("sha256"); let resolve; const digest = new Promise((done) => { resolve = done; }); super({ write: (chunk) => { h.update(chunk); }, close: () => resolve(h.digest().buffer) }); this.digest = digest; } };
globalThis.FixedLengthStream ??= class extends TransformStream { constructor(n) { let seen = 0; super({ transform(chunk, ctl) { seen += chunk.byteLength; if (seen > n) throw new Error("part body exceeds declared length"); ctl.enqueue(chunk); }, flush() { if (seen !== n) throw new Error("part body is shorter than declared length"); } }); } };
const env = {}, A = new Archive({ storage }, env);
env.ARCHIVE = { idFromName: (s) => s, get: () => A };
let blob = gzipSync(""), registered = 0;
const tarLayer = (entries) => {
  const blocks = [];
  for (const { name, kind = "0", body = "", link = "" } of entries) {
    const bytes = Buffer.from(body), header = Buffer.alloc(512);
    header.write(name, 0, 100); header.write("0000644\0", 100); header.write("0000000\0", 108); header.write("0000000\0", 116);
    header.write(bytes.length.toString(8).padStart(11, "0") + "\0", 124); header.write("00000000000\0", 136);
    header.fill(32, 148, 156); header.write(kind, 156); header.write(link, 157, 100);
    header.write("ustar\0", 257); header.write("00", 263);
    const sum = header.reduce((n, b) => n + b, 0);
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
};
const paxPath = (path) => {
  const pair = ` path=${path}\n`;
  let size = Buffer.byteLength(pair) + 2;
  while (Buffer.byteLength(String(size) + pair) !== size) size = Buffer.byteLength(String(size) + pair);
  return String(size) + pair;
};
const layerName = "base.tar.gz";
let layerBytes = tarLayer([{ name: "notes.txt", body: "computer layer bytes" }]);
const splitLayer = new ReadableStream({ start(controller) { for (const byte of layerBytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
await verifyImportLayer(splitLayer, createHash("sha256").update(layerBytes).digest("hex"), async () => {});
const storedBytes = (key) => key.endsWith(`/${layerName}`) ? layerBytes : blob;
env.WS = { head: async (key) => ({ size: storedBytes(key).length }), get: async (key) => ({ size: storedBytes(key).length, body: new Response(storedBytes(key)).body }) };
env.COMPUTER = { idFromName: (s) => s, get: () => ({ importLayers: async (_, layers) => { registered++; return { layers: layers.length }; } }) };
const id = "import-one", obj = "data.jsonl.gz";
await A.createImport(id, "hash"); await A.putObject(id, obj, `t/tenant/import/${id}/${obj}`, "upload-id"); await A.markDone(id, obj);
const manifest = (rows) => ({ objects: { [obj]: { kind: "data", bytes: blob.length, sha256: createHash("sha256").update(blob).digest("hex") } }, rows });
const setData = (plain) => { blob = gzipSync(plain); };

assert.match(validateImportManifest(null), /invalid/);
assert.match(validateImportManifest({ objects: {}, rows: {} }), /incomplete/);
assert.match(validateImportManifest({ objects: { [obj]: { kind: "data", bytes: -1, sha256: "a".repeat(64) } }, rows: { channels: 1 } }), /invalid import object/);
assert.equal(validateImportManifest(manifest({ channels: 1 })), null);
assert.deepEqual(await readImportManifest(new Request("https://example.com/finish", { method: "POST", body: JSON.stringify(manifest({ channels: 1 })) })), manifest({ channels: 1 }));
await assert.rejects(readImportManifest(new Request("https://example.com/finish", { method: "POST", body: "x".repeat(IMPORT_MAX_MANIFEST + 1) })), /exceeds 1 MiB/);
await assert.rejects(readImportManifest(new Request("https://example.com/finish", { method: "POST", body: "{" })), /invalid import manifest JSON/);

await A.createImport("parts", "hash"); await A.putObject("parts", "file.tar.gz", "t/tenant/import/parts/file.tar.gz", "upload-id");
await Promise.all([A.addPart("parts", "file.tar.gz", { partNumber: 1, etag: "one" }), A.addPart("parts", "file.tar.gz", { partNumber: 2, etag: "two" })]);
assert.deepEqual(JSON.parse((await A.object("parts", "file.tar.gz")).parts).map((p) => p.partNumber).sort(), [1, 2]);
await A.markDone("parts", "file.tar.gz");
await assert.rejects(A.addPart("parts", "file.tar.gz", { partNumber: 3, etag: "three" }), /not accepting parts/);
await A.createImport("part-range", createHash("sha256").update("token").digest("hex"));
for (const number of ["0", "10001", "9999999999999999999999"]) {
  const request = new Request(`https://example.com/import/part-range/obj/file.tar.gz/part/${number}`, { method: "PUT", headers: { authorization: "Bearer token", "content-length": "6" }, body: "123456" });
  const response = await handleImport(request, env, "tenant", "part-range", `/obj/file.tar.gz/part/${number}`);
  assert.equal(response.status, 400); assert.match((await response.json()).error, /part number/);
}
await A.createImport("bounded-part", createHash("sha256").update("token").digest("hex"));
await A.putObject("bounded-part", "file.tar.gz", "t/tenant/import/bounded-part/file.tar.gz", "upload-id");
const uploaded = [];
env.WS.resumeMultipartUpload = () => ({ async uploadPart(partNumber, body) {
  const bytes = new Uint8Array(await new Response(body).arrayBuffer());
  uploaded.push({ partNumber, bytes }); return { partNumber, etag: `part-${partNumber}` };
} });
const partReq = (number, length, body = "123456") => new Request(`https://example.com/import/bounded-part/obj/file.tar.gz/part/${number}`, {
  method: "PUT", headers: { authorization: "Bearer token", ...(length == null ? {} : { "content-length": String(length) }) }, body,
});
for (const length of [null, "0", "-1", "1.5", "NaN", "+6", "0x6", String(50 * 1024 * 1024 + 1)]) {
  const response = await handleImport(partReq(1, length), env, "tenant", "bounded-part", "/obj/file.tar.gz/part/1");
  assert.equal(response.status, 400, `invalid content-length ${length}`);
}
assert.equal(uploaded.length, 0);
const accepted = await handleImport(partReq(1, 6), env, "tenant", "bounded-part", "/obj/file.tar.gz/part/1");
assert.equal(accepted.status, 200);
assert.equal(uploaded.length, 1); assert.equal(uploaded[0].bytes.length, 6);
for (const length of [3, 7]) {
  await assert.rejects(handleImport(partReq(2, length), env, "tenant", "bounded-part", "/obj/file.tar.gz/part/2"), /part body/);
  assert.equal(uploaded.length, 1, `mismatched length ${length} must not register a part`);
  assert.deepEqual(JSON.parse((await A.object("bounded-part", "file.tar.gz")).parts).map((p) => p.partNumber), [1]);
}

// Two parts can each fit in the remaining space while their combined object cannot.
const usageDb = new DatabaseSync(":memory:");
usageDb.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY, plan TEXT); CREATE TABLE storage_usage (tenant_id TEXT, kind TEXT, bytes INTEGER, objects INTEGER, PRIMARY KEY (tenant_id, kind)); CREATE TABLE storage_plan (tenant_id TEXT PRIMARY KEY, blocks INTEGER, updated_at INTEGER, refused_at INTEGER, refused_what TEXT)");
usageDb.prepare("INSERT INTO tenants VALUES ('tenant','byok')").run();
usageDb.prepare("INSERT INTO storage_usage VALUES ('tenant','files',?,0)").run(1e9 - 9);
env.DB = { prepare(query) { let args = []; return {
  bind(...values) { args = values; return this; },
  async first() { return usageDb.prepare(query).get(...args) || null; },
  async all() { return { results: usageDb.prepare(query).all(...args) }; },
  async run() { usageDb.prepare(query).run(...args); },
}; } };
env.SELFHOST_STORAGE_GB = "1";
const oldWs = env.WS;
let completedParts = null;
env.WS = {
  head: async () => ({ size: 12 }),
  resumeMultipartUpload: () => ({
    async uploadPart(partNumber, body) { await new Response(body).arrayBuffer(); return { partNumber, etag: `quota-${partNumber}` }; },
    async complete(parts) { completedParts = parts; return { size: 12 }; },
  }),
};
await A.createImport("quota", createHash("sha256").update("token").digest("hex"));
await A.putObject("quota", "file.tar.gz", "t/tenant/import/quota/file.tar.gz", "upload-id");
const quotaUrl = "https://example.com/import/quota/obj/file.tar.gz";
for (const number of [1, 2]) {
  const response = await handleImport(new Request(`${quotaUrl}/part/${number}`, { method: "PUT", headers: { authorization: "Bearer token", "content-length": "6" }, body: "123456" }), env, "tenant", "quota", `/obj/file.tar.gz/part/${number}`);
  assert.equal(response.status, 200);
}
const completeQuota = () => handleImport(new Request(`${quotaUrl}/complete`, { method: "POST", headers: { authorization: "Bearer token" } }), env, "tenant", "quota", "/obj/file.tar.gz/complete");
const refused = await completeQuota();
assert.equal(refused.status, 507);
assert.equal((await refused.json()).storage_full, true);
assert.equal(completedParts, null, "an over-limit object never reaches R2 complete");
usageDb.prepare("UPDATE storage_usage SET bytes=0").run();
assert.equal((await completeQuota()).status, 200);
assert.deepEqual(completedParts, [{ partNumber: 1, etag: "quota-1" }, { partNumber: 2, etag: "quota-2" }]);
assert.equal(usageDb.prepare("SELECT bytes FROM storage_usage WHERE tenant_id='tenant' AND kind='other'").get().bytes, 12);
// Separate objects in the same tenant must not both spend the same nine free bytes.
usageDb.prepare("UPDATE storage_usage SET bytes=0").run();
usageDb.prepare("UPDATE storage_usage SET bytes=? WHERE kind='files'").run(1e9 - 9);
await A.createImport("parallel-quota", createHash("sha256").update("token").digest("hex"));
let parallelCompletes = 0;
env.WS = {
  head: async () => ({ size: 6 }),
  resumeMultipartUpload: () => ({ async complete() { parallelCompletes++; await new Promise((resolve) => setTimeout(resolve, 30)); return { size: 6 }; } }),
};
for (const name of ["a.tar.gz", "b.tar.gz"]) {
  await A.putObject("parallel-quota", name, `t/tenant/import/parallel-quota/${name}`, `upload-${name}`);
  await A.addPart("parallel-quota", name, { partNumber: 1, etag: name, bytes: 6 });
}
const parallelStatus = await Promise.all(["a.tar.gz", "b.tar.gz"].map(async (name) => {
  const response = await handleImport(new Request(`https://example.com/import/parallel-quota/obj/${name}/complete`, { method: "POST", headers: { authorization: "Bearer token" } }), env, "tenant", "parallel-quota", `/obj/${name}/complete`);
  return response.status;
}));
assert.deepEqual(parallelStatus.sort(), [200, 507]);
assert.equal(parallelCompletes, 1, "only one object reached R2 complete");
const completedName = (await A.object("parallel-quota", "a.tar.gz")).done ? "a.tar.gz" : "b.tar.gz";
const repeated = await handleImport(new Request(`https://example.com/import/parallel-quota/obj/${completedName}/complete`, { method: "POST", headers: { authorization: "Bearer token" } }), env, "tenant", "parallel-quota", `/obj/${completedName}/complete`);
assert.equal(repeated.status, 200);
assert.equal(parallelCompletes, 1, "a repeated completion does not call R2 again");
env.WS = oldWs; delete env.DB; delete env.SELFHOST_STORAGE_GB;

setData('{"t":"channels","r":{"id":1,"slug":"first","name":"First"}}\nnot json\n');
let result = await finishImport(env, "tenant", id, manifest({ channels: 2 }));
assert.equal(result.ok, false); assert.match(result.problems[0], /JSON|Unexpected|json/i);
assert.deepEqual(await A.counts(), {}, "a parser failure did not expose partial rows");
assert.equal(data.prepare("SELECT COUNT(*) n FROM import_rows").get().n, 0); assert.equal(registered, 0);

setData('{"t":"channels","r":{"id":1,"slug":"first","name":"First"}}\n');
result = await finishImport(env, "tenant", id, manifest({ channels: 2 }));
assert.equal(result.ok, false); assert.match(result.mismatches[0], /channels: 1 != 2/);
assert.deepEqual(await A.counts(), {}, "a count mismatch did not expose staged rows");
assert.equal(registered, 0);

result = await finishImport(env, "tenant", id, manifest({ channels: 1 }));
assert.equal(result.ok, true); assert.equal(registered, 1);
assert.deepEqual(await A.counts(), { channels: 1 });
assert.equal(data.prepare("SELECT COUNT(*) n FROM import_rows").get().n, 0);
assert.equal(data.prepare("SELECT status FROM imports WHERE id=?").get(id).status, "done");

await A.createImport("poison-slug", "hash"); await A.putObject("poison-slug", obj, "t/tenant/import/poison-slug/data.jsonl.gz", "upload-id"); await A.markDone("poison-slug", obj);
setData(JSON.stringify({ t: "channels", r: { id: 2, slug: 'bad\" onmouseover=\"alert(1)', name: "Bad" } }) + "\n");
result = await finishImport(env, "tenant", "poison-slug", manifest({ channels: 1 }));
assert.equal(result.ok, false); assert.match(result.problems[0], /invalid import record/);
assert.deepEqual(await A.counts(), { channels: 1 }, "a hostile channel slug is never published to app boot");
assert.equal(data.prepare("SELECT COUNT(*) n FROM import_rows").get().n, 0);

setData('{"t":"channels","r":{"id":1,"slug":"first","name":"First"}}\n');
await A.createImport("bad-hash", "hash"); await A.putObject("bad-hash", obj, "t/tenant/import/bad-hash/data.jsonl.gz", "upload-id"); await A.markDone("bad-hash", obj);
result = await finishImport(env, "tenant", "bad-hash", { ...manifest({ channels: 1 }), objects: { [obj]: { ...manifest({ channels: 1 }).objects[obj], sha256: "0".repeat(64) } } });
assert.equal(result.ok, false); assert.match(result.problems[0], /checksum mismatch/);
assert.equal(data.prepare("SELECT COUNT(*) n FROM import_rows").get().n, 0);

await A.createImport("layer-hash", "hash");
for (const name of [obj, layerName]) {
  await A.putObject("layer-hash", name, `t/tenant/import/layer-hash/${name}`, "upload-id"); await A.markDone("layer-hash", name);
}
const layerManifest = (sha256) => ({ ...manifest({ channels: 1 }), objects: {
  ...manifest({ channels: 1 }).objects, [layerName]: { kind: "files", bytes: layerBytes.length, sha256, files: 1 },
} });
const beforeLayer = registered;
result = await finishImport(env, "tenant", "layer-hash", layerManifest("0".repeat(64)));
assert.equal(result.ok, false, "a file layer with a false checksum must not be imported");
assert.match(result.problems[0], /checksum mismatch/);
assert.equal(registered, beforeLayer, "bad layer bytes must not be registered with the computer");
assert.equal(data.prepare("SELECT status FROM imports WHERE id='layer-hash'").get().status, "uploading");
result = await finishImport(env, "tenant", "layer-hash", layerManifest(createHash("sha256").update(layerBytes).digest("hex")));
assert.equal(result.ok, true, "the same import can finish with the correct checksum");
assert.equal(registered, beforeLayer + 1);

for (const [caseName, badLayer] of [
  ["traversal", tarLayer([{ name: "../outside.txt", body: "escape" }])],
  ["absolute", tarLayer([{ name: "/tmp/outside.txt", body: "escape" }])],
  ["symlink", tarLayer([{ name: "link", kind: "2", link: "../../outside" }])],
  ["hardlink", tarLayer([{ name: "link", kind: "1", link: "../outside.txt" }])],
  ["pax-traversal", tarLayer([{ name: "PaxHeaders/path", kind: "x", body: paxPath("../outside.txt") }, { name: "safe.txt", body: "escape" }])],
  ["corrupt", Buffer.from("not a gzip tar")],
]) {
  const importId = `layer-${caseName}`;
  await A.createImport(importId, "hash");
  for (const name of [obj, layerName]) { await A.putObject(importId, name, `t/tenant/import/${importId}/${name}`, "upload-id"); await A.markDone(importId, name); }
  layerBytes = badLayer;
  const before = registered;
  const bad = await finishImport(env, "tenant", importId, layerManifest(createHash("sha256").update(layerBytes).digest("hex")));
  assert.equal(bad.ok, false, `${caseName} must be refused even with a matching digest`);
  assert.equal(registered, before, `${caseName} must not reach the computer`);
  assert.equal(data.prepare("SELECT status FROM imports WHERE id=?").get(importId).status, "uploading");
}
layerBytes = tarLayer([{ name: "notes.txt", body: "computer layer bytes" }]);

await A.createImport("layer-concurrent", "hash");
for (const name of [obj, layerName]) {
  await A.putObject("layer-concurrent", name, `t/tenant/import/layer-concurrent/${name}`, "upload-id"); await A.markDone("layer-concurrent", name);
}
let releaseLayer, enteredLayer;
const layerGate = new Promise((resolve) => { releaseLayer = resolve; });
const layerEntered = new Promise((resolve) => { enteredLayer = resolve; });
const normalGet = env.WS.get;
env.WS.get = async (key) => { if (key.endsWith(`/${layerName}`)) { enteredLayer(); await layerGate; } return normalGet(key); };
const hashing = finishImport(env, "tenant", "layer-concurrent", layerManifest("0".repeat(64)));
await layerEntered;
const duplicate = await finishImport(env, "tenant", "layer-concurrent", layerManifest("0".repeat(64)));
assert.equal(duplicate.ok, false); assert.match(duplicate.problems[0], /already running/);
releaseLayer(); assert.equal((await hashing).ok, false);
env.WS.get = normalGet;

await A.createImport("concurrent", "hash"); await A.putObject("concurrent", obj, "t/tenant/import/concurrent/data.jsonl.gz", "upload-id"); await A.markDone("concurrent", obj);
let resumeGet; const gate = new Promise((resolve) => { resumeGet = resolve; });
const ordinaryGet = env.WS.get;
env.WS.get = async (...args) => { await gate; return ordinaryGet(...args); };
const first = finishImport(env, "tenant", "concurrent", manifest({ channels: 1 }));
for (let i = 0; i < 20 && !data.prepare("SELECT COUNT(*) n FROM import_finishes WHERE id='concurrent'").get().n; i++) await new Promise((resolve) => setImmediate(resolve));
assert.equal(data.prepare("SELECT COUNT(*) n FROM import_finishes WHERE id='concurrent'").get().n, 1);
const second = await finishImport(env, "tenant", "concurrent", manifest({ channels: 1 }));
assert.equal(second.ok, false); assert.match(second.problems[0], /already running/);
resumeGet(); assert.equal((await first).ok, true);
env.WS.get = ordinaryGet;
assert.equal(data.prepare("SELECT COUNT(*) n FROM import_finishes").get().n, 0);

await A.createImport("takeover", "hash");
assert.equal(await A.beginImportFinish("takeover", "old"), true);
data.prepare("UPDATE import_finishes SET expires=0 WHERE id='takeover'").run();
assert.equal(await A.beginImportFinish("takeover", "new"), true);
await assert.rejects(A.stageImportRows("takeover", "old", [{ t: "channels", r: { id: 99 } }]), /lease expired/);
await A.releaseImportFinish("takeover", "old");
assert.equal(data.prepare("SELECT attempt FROM import_finishes WHERE id='takeover'").get().attempt, "new");
await A.releaseImportFinish("takeover", "new");

await assert.rejects(readImportRows(new Response(gzipSync("x".repeat(IMPORT_MAX_LINE + 1))).body, async () => {}), /4 MiB/);
await assert.rejects(readImportRows(new Response(gzipSync(JSON.stringify({ t: "channels", r: { id: 4, slug: 'bad\" onmouseover=\"alert(1)', name: "Bad" } }) + "\n")).body, async () => {}), /invalid import record/);
console.log("ok - legacy import bounds malformed data and publishes rows only after validation");
