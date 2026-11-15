import assert from "node:assert/strict";
import worker from "../src/index.js";

const objects = new Map();
const WS = { async put(key, value) { objects.set(key, typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value)); },
  async get(key) { const bytes = objects.get(key); return bytes && { size: bytes.length, arrayBuffer: async () => bytes.slice().buffer }; } };
const calls = [];
const steps = new Map();
const namespace = (kind) => ({ idFromName: (name) => name, get(name) { return {
  channels: async () => [{ slug: "main" }], snapshotFileKeys: async () => [],
  snapshotPrepare: async () => { calls.push(["prepare", kind, name]); return { ready: true }; },
  async snapshotBackupStep(prefix, wantedName) {
    assert.equal(wantedName, name);
    const id = `${kind}:${name}`, count = (steps.get(id) || 0) + 1;
    steps.set(id, count);
    if (count === 1) {
      if (kind === "ChannelComputer" || kind === "Computer") calls.push(["prepare", kind, name]);
      calls.push(["backup-step", kind, name]); return { done: false, kind, name };
    }
    const key = `${prefix}/manifest.json`;
    await WS.put(key, JSON.stringify({ format: "onehelm-sqlite-v1", identity: { kind, name }, tables: [], sequences: [], alarm: null }));
    calls.push(["backup", kind, name]); return { done: true, key, kind, name, rows: 0, tables: 0 };
  },
  async snapshotRestoreStep(key, wantedName) { calls.push(["restore", kind, name, key]); assert.equal(wantedName, name); return { done: true, rows: 0, tables: 0 }; },
}; } });
const token = "A".repeat(43);
const env = { ENV_NAME: "selfhost", BACKUP_MAINTENANCE: "1", BACKUP_TOKEN: token, WS,
  DB: { prepare: () => ({ first: async () => ({ id: "owner-1" }) }) },
  ARCHIVE: namespace("Archive"), RESIDENT: namespace("Resident"), CHANNEL_COMPUTER: namespace("ChannelComputer"),
  LEDGER: namespace("UsageLedger"), COMPUTER: namespace("Computer"), FILE_PREP: namespace("FilePrep") };
const request = (path, body, bearer = token) => new Request(`https://owner.example.com${path}`, { method: body ? "POST" : "GET",
  headers: { authorization: `Bearer ${bearer}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body && JSON.stringify(body) });
const call = (path, body, bearer = token, e = env) => worker.route(request(path, body, bearer), e, {});

assert.equal((await call("/api/backup/plan", null, "B".repeat(43))).status, 404, "wrong secret cannot see the plan");
assert.equal((await call("/api/backup/plan", null, token, { ...env, BACKUP_MAINTENANCE: "0" })).status, 404, "backup requires maintenance");
assert.equal((await call("/w/home/app")).status, 503, "maintenance blocks ordinary app traffic");
const planResponse = await call("/api/backup/plan");
assert.equal(planResponse.status, 200);
const plan = await planResponse.json();
assert.match(plan.backup_id, /^[a-f0-9]{32}$/);
assert.equal(plan.targets.length, 6);
assert.equal((await call("/api/backup/object", { backup_id: plan.backup_id, target: { kind: "Archive", name: "archive:other" } })).status, 400,
  "backup cannot address an object outside the owner plan");
const backed = [];
for (const target of plan.targets) {
  const first = await call("/api/backup/object", { backup_id: plan.backup_id, target });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).done, false);
  const response = await call("/api/backup/object", { backup_id: plan.backup_id, target });
  assert.equal(response.status, 200);
  backed.push(await response.json());
}
assert.equal(calls.filter((row) => row[0] === "backup").length, 6);
assert.equal(calls.filter((row) => row[0] === "prepare").length, 3, "both computer objects and the channel computer save before snapshotting");
assert.equal((await call("/api/backup/finalize", { backup_id: plan.backup_id, objects: backed.slice(1) })).status, 400, "partial snapshots have no index");
const finished = await call("/api/backup/finalize", { backup_id: plan.backup_id, objects: backed });
assert.equal(finished.status, 200);
const index = await finished.json();
assert.equal(index.objects, 6);
assert.equal(objects.has(index.key), true);
assert.equal((await call("/api/backup/restore-object", { backup_id: plan.backup_id, target: plan.targets[0] })).status, 403,
  "restore needs a separate explicit mode");
const restorePlan = await call(`/api/backup/restore-plan?id=${plan.backup_id}`, null, token, { ...env, BACKUP_RESTORE_MODE: "1" });
assert.equal(restorePlan.status, 200);
assert.deepEqual((await restorePlan.json()).targets, plan.targets);
const restore = await call("/api/backup/restore-object", { backup_id: plan.backup_id, target: plan.targets[0] }, token, { ...env, BACKUP_RESTORE_MODE: "1" });
assert.equal(restore.status, 200);
assert.equal(calls.at(-1)[0], "restore");
const originalIndex = objects.get(index.key);
const tampered = JSON.parse(new TextDecoder().decode(originalIndex));
tampered.objects[0].name = "archive:other";
await WS.put(index.key, JSON.stringify(tampered));
assert.equal((await call(`/api/backup/restore-plan?id=${plan.backup_id}`, null, token, { ...env, BACKUP_RESTORE_MODE: "1" })).status, 500,
  "a copied index cannot redirect restore to a different workspace");
objects.set(index.key, originalIndex);
console.log("ok - backup API requires a secret and maintenance, covers every target, and gates restore separately");
