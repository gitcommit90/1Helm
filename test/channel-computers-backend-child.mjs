import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const backend = process.argv[2];
assert.ok(backend === "lxc" || backend === "wsl");
const root = resolve(import.meta.dirname, "..");
const testRoot = mkdtempSync(join(tmpdir(), `1helm-${backend}-`));
const dataDir = join(testRoot, "data");
const fakeState = join(testRoot, "fake-state");
mkdirSync(fakeState, { recursive: true });
const fakeCli = resolve(root, "test", backend === "lxc" ? "fake-lxc-runtime.mjs" : "fake-wsl.mjs");
await chmod(fakeCli, 0o700);
process.env.CTRL_DATA_DIR = dataDir;
process.env.HELM_CHANNEL_COMPUTER_BACKEND = backend;
process.env.FAKE_CONTAINER_STATE = fakeState;
process.env.HELM_FLEET_INITIAL_MS = "600000";
process.env.HELM_FLEET_INTERVAL_MS = "600000";
if (backend === "lxc") {
  process.env.HELM_LXC_HELPER = fakeCli;
  process.env.HELM_LXC_HELPER_USE_SUDO = "0";
} else process.env.HELM_WSL_CLI = fakeCli;

const db = await import("../src/server/db.ts");
db.seed();
const computers = await import("../src/server/channel-computers.ts");
const stamp = Date.now();
const channelId = Number(db.run("INSERT INTO channels (name,slug,kind,topic,purpose,status,created) VALUES ('backend','backend','channel','backend','backend','active',?)", stamp).lastInsertRowid);
const botId = Number(db.run("INSERT INTO bots (name,created) VALUES ('backend-agent',?)", stamp).lastInsertRowid);
const agentId = Number(db.run("INSERT INTO agents (bot_id,kind,name,display_name,status,created) VALUES (?,'channel','backend-agent','backend-agent','ready',?)", botId, stamp).lastInsertRowid);
db.run("INSERT INTO agent_channels (agent_id,channel_id,bound_at) VALUES (?,?,?)", agentId, channelId, stamp);
const record = computers.ensureChannelComputerRecord(channelId);

// A production host upgrade must migrate compatibility rows created by older
// releases onto the host's real isolation backend without losing the channel.
db.run("UPDATE channel_computers SET backend='native',observed_state='running',provision_status='ready' WHERE channel_id=?", channelId);
db.migrate();
assert.equal(db.q1("SELECT backend FROM channel_computers WHERE channel_id=?", channelId).backend, backend);

if (backend === "wsl") {
  const machineRoot = join(fakeState, "machines", record.machine_id);
  mkdirSync(join(machineRoot, "workspace", "files"), { recursive: true });
  mkdirSync(join(machineRoot, "var", "lib", "1helm"), { recursive: true });
  writeFileSync(join(machineRoot, "config.json"), JSON.stringify({ id: record.machine_id, status: "stopped", cpus: 2, memory: 2 * 1024 ** 3, homeMount: "none" }));
  const owner = `${db.q1("SELECT installation_id FROM workspace WHERE id=1").installation_id}:${channelId}`;
  writeFileSync(join(machineRoot, "var", "lib", "1helm", "owner"), `${owner}\n`);
  mkdirSync(join(dataDir, "wsl", record.machine_id), { recursive: true });
}

try {
  let provisioning;
  if (backend === "lxc") {
    process.env.FAKE_LXC_CREATE_DELAY_MS = "500";
    const pending = computers.provisionChannelComputer(channelId);
    const machineConfig = join(fakeState, "machines", record.machine_id, "config.json");
    for (let attempt = 0; !existsSync(machineConfig) && attempt < 100; attempt++) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    assert(existsSync(machineConfig), "the fake LXC entered its marker-less provisioning window");
    const concurrent = await computers.reconcileChannelComputers([channelId]);
    assert.deepEqual(concurrent, { checked: 1, errors: 0 }, "fleet reconciliation leaves an active provisioning transaction alone");
    assert.equal(db.q1("SELECT last_error FROM channel_computers WHERE channel_id=?", channelId).last_error, "");
    provisioning = await pending;
    delete process.env.FAKE_LXC_CREATE_DELAY_MS;
  } else provisioning = await computers.provisionChannelComputer(channelId);
  const provisioned = provisioning;
  assert.equal(provisioned.backend, backend);
  assert.equal(provisioned.home_mount, "none");
  assert.equal(provisioned.observed_state, "running");
  let result = await computers.runChannelCommand(channelId, "printf backend-persistence > result.txt");
  assert.equal(result.exit_code, 0);
  assert.equal(readFileSync(join(dataDir, "channels", String(channelId), "workspace", "result.txt"), "utf8"), "backend-persistence");
  await computers.stopChannelComputer(channelId, "maintenance");
  assert.equal(db.q1("SELECT observed_state FROM channel_computers WHERE channel_id=?", channelId).observed_state, "stopped");
  await computers.ensureChannelComputerRunning(channelId, "backend restart test");
  result = await computers.runChannelCommand(channelId, "cat result.txt");
  assert.match(result.output, /backend-persistence/);
  if (backend === "lxc") {
    const resized = await computers.resizeChannelComputer(channelId, 1, 1024 ** 3);
    assert.equal(resized.cpus, 1);
    assert.equal(resized.memory_bytes, 1024 ** 3);
  }
  const ownerPath = join(fakeState, "machines", record.machine_id, "var", "lib", "1helm", "owner");
  const expectedOwner = readFileSync(ownerPath, "utf8");
  writeFileSync(ownerPath, "ffffffffffffffff:999\n");
  await assert.rejects(computers.deleteChannelComputer(channelId), /ownership marker/i);
  writeFileSync(ownerPath, expectedOwner);
  await computers.deleteChannelComputer(channelId);
  assert.equal(existsSync(join(fakeState, "machines", record.machine_id)), false);
  if (backend === "wsl") assert.equal(existsSync(join(dataDir, "wsl", record.machine_id)), false);
  process.stdout.write(`${backend} lifecycle ok\n`);
} finally {
  await computers.shutdownChannelComputers();
  rmSync(testRoot, { recursive: true, force: true });
}
