import assert from "node:assert/strict";
import { snapshotStub, snapshotTargets } from "../src/backup-plan.js";

const names = [];
const ns = (methods) => ({ idFromName: (name) => name, get(name) { names.push(name); return methods(name); } });
const tenantId = "owner-1";
const env = { ENV_NAME: "selfhost",
  ARCHIVE: ns(() => ({ channels: async () => [{ slug: "main" }, { slug: "project" }] })),
  RESIDENT: ns((name) => ({ snapshotFileKeys: async () => name.endsWith(":main")
    ? ["t/owner-1/files/main/a", "t/owner-1/files/main/a", "t/owner-1/files/main/a.v2"] : [] })),
  CHANNEL_COMPUTER: ns(() => ({})), LEDGER: ns(() => ({})), COMPUTER: ns(() => ({})), FILE_PREP: ns(() => ({})) };
const targets = await snapshotTargets(env, tenantId);
assert.deepEqual(targets.map((t) => t.kind), ["Archive", "UsageLedger", "Computer", "Computer", "Resident", "ChannelComputer", "FilePrep", "FilePrep", "Resident", "ChannelComputer"]);
assert.equal(targets.filter((t) => t.name === "prep:t/owner-1/files/main/a").length, 1, "same file version is planned once");
assert.equal(snapshotStub(env, { kind: "Resident", name: "res:owner-1:main" }) !== null, true);
assert.equal(names.at(-1), "res:owner-1:main");
assert.throws(() => snapshotStub(env, { kind: "SomethingElse", name: "x" }), /invalid snapshot target/);
await assert.rejects(snapshotTargets({ ...env, ENV_NAME: "dev" }, tenantId), /unavailable/);
console.log("ok - backup plan names all core Durable Objects, channels and file preparation objects once");
