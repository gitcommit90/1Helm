import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const testRoot = mkdtempSync(join(tmpdir(), "1helm-oci-backend-"));
const dataDir = join(testRoot, "data");
const fakeState = join(testRoot, "oci");
mkdirSync(fakeState, { recursive: true });
const fakeCli = resolve(root, "test", "fake-oci-runtime.mjs");
await chmod(fakeCli, 0o700);
process.env.CTRL_DATA_DIR = dataDir;
process.env.HELM_CHANNEL_COMPUTER_BACKEND = "oci";
process.env.HELM_OCI_HELPER = fakeCli;
process.env.HELM_OCI_HELPER_USE_SUDO = "0";
process.env.HELM_OCI_HOST_STATE_ROOT = fakeState;
process.env.HELM_OCI_STATE_ROOT_OVERRIDE = fakeState;
process.env.FAKE_OCI_STATE = fakeState;
process.env.FAKE_CONTAINER_STATE = fakeState;
process.env.HELM_FLEET_INITIAL_MS = "600000";
process.env.HELM_FLEET_INTERVAL_MS = "600000";

const db = await import("../src/server/db.ts");
db.seed();
const computers = await import("../src/server/channel-computers.ts");
const stamp = Date.now();
const channelId = Number(db.run("INSERT INTO channels (name,slug,kind,topic,purpose,status,created) VALUES ('backend','backend','channel','backend','backend','active',?)", stamp).lastInsertRowid);
const botId = Number(db.run("INSERT INTO bots (name,created) VALUES ('backend-agent',?)", stamp).lastInsertRowid);
const agentId = Number(db.run("INSERT INTO agents (bot_id,kind,name,display_name,status,created) VALUES (?,'channel','backend-agent','backend-agent','ready',?)", botId, stamp).lastInsertRowid);
db.run("INSERT INTO agent_channels (agent_id,channel_id,bound_at) VALUES (?,?,?)", agentId, channelId, stamp);
const record = computers.ensureChannelComputerRecord(channelId);
const authoritativeRoot = join(fakeState, "channels", record.machine_id);

try {
  const provisioned = await computers.provisionChannelComputer(channelId);
  assert.equal(provisioned.backend, "oci");
  assert.equal(provisioned.home_mount, "none");
  assert.equal(provisioned.observed_state, "running");

  const callsBeforeReady = readFileSync(join(fakeState, "oci-calls.log"), "utf8").trim().split("\n").length;
  await computers.ensureChannelComputerRunning(channelId, "single inspection regression");
  const readyCalls = readFileSync(join(fakeState, "oci-calls.log"), "utf8").trim().split("\n").slice(callsBeforeReady).map((line) => JSON.parse(line));
  assert.equal(readyCalls.filter((call) => call[0] === "inspect").length, 1, "an already-running OCI channel is inspected exactly once per readiness interaction");

  let result = await computers.runChannelCommand(channelId, "printf runtime-authority > result.txt; printf direct-file > files/direct.txt; nohup sh -c 'sleep 2; printf background > background.txt' >/dev/null 2>&1 &");
  assert.equal(result.exit_code, 0);
  assert.equal(readFileSync(join(authoritativeRoot, "workspace", "result.txt"), "utf8"), "runtime-authority");
  assert.equal(readFileSync(join(authoritativeRoot, "files", "direct.txt"), "utf8"), "direct-file");
  writeFileSync(join(authoritativeRoot, "workspace", "human.txt"), "human-direct");
  result = await computers.runChannelCommand(channelId, "cat human.txt");
  assert.match(result.output, /human-direct/);
  await new Promise((resolveWait) => setTimeout(resolveWait, 2200));
  assert.equal(readFileSync(join(authoritativeRoot, "workspace", "background.txt"), "utf8"), "background");

  const networkPath = join(authoritativeRoot, "network.json");
  const networkBefore = readFileSync(networkPath, "utf8");
  await computers.stopChannelComputer(channelId, "maintenance");
  await computers.ensureChannelComputerRunning(channelId, "restart test");
  assert.equal(readFileSync(networkPath, "utf8"), networkBefore, "channel network identity survives stop/start");
  result = await computers.runChannelCommand(channelId, "cat result.txt files/direct.txt");
  assert.match(result.output, /runtime-authority/);
  assert.match(result.output, /direct-file/);
  const resized = await computers.resizeChannelComputer(channelId, 1, 1024 ** 3);
  assert.equal(resized.cpus, 1);
  assert.equal(resized.memory_bytes, 1024 ** 3);

  await computers.stopChannelComputer(channelId, "archive");
  const backupRoot = join(fakeState, "backups");
  assert.equal(existsSync(backupRoot), true);
  rmSync(join(fakeState, "machines", record.machine_id), { recursive: true, force: true });
  rmSync(authoritativeRoot, { recursive: true, force: true });
  db.run("UPDATE channels SET status='active' WHERE id=?", channelId);
  db.run("UPDATE channel_computers SET desired_state='auto',observed_state='missing' WHERE channel_id=?", channelId);
  await computers.ensureChannelComputerRunning(channelId, "digest recovery test");
  result = await computers.runChannelCommand(channelId, "cat result.txt");
  assert.match(result.output, /runtime-authority/);

  const ownerPath = join(authoritativeRoot, "var-lib-1helm", "owner");
  const expectedOwner = readFileSync(ownerPath, "utf8");
  writeFileSync(ownerPath, "ffffffffffffffff:999\n");
  await assert.rejects(computers.deleteChannelComputer(channelId), /ownership marker/i);
  writeFileSync(ownerPath, expectedOwner);
  const expectedNetwork = readFileSync(networkPath, "utf8");
  const tamperedNetwork = JSON.parse(expectedNetwork);
  tamperedNetwork.ip = "10.89.0.254";
  writeFileSync(networkPath, `${JSON.stringify(tamperedNetwork)}\n`);
  await assert.rejects(computers.deleteChannelComputer(channelId), /network identity/i, "typed delete refuses a container whose static network identity was altered");
  writeFileSync(networkPath, expectedNetwork);
  await computers.deleteChannelComputer(channelId);
  assert.equal(existsSync(join(fakeState, "machines", record.machine_id)), false);
  assert.equal(existsSync(authoritativeRoot), false);
  const calls = readFileSync(join(fakeState, "oci-calls.log"), "utf8");
  assert.doesNotMatch(calls, /sync|import.*workspace|export.*workspace/i, "OCI commands never invoke a workspace copy journal");
  process.stdout.write("oci lifecycle ok\n");
} finally {
  await computers.shutdownChannelComputers();
  rmSync(testRoot, { recursive: true, force: true });
}
