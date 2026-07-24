import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const testRoot = mkdtempSync(join(tmpdir(), "1helm-channel-computers-"));
const dataDir = join(testRoot, "data");
const fakeState = join(testRoot, "fake-state");
const fakeCli = join(testRoot, "container");
await mkdir(fakeState, { recursive: true });
await writeFile(fakeCli, `#!/bin/sh\nexec "${process.execPath}" "${join(root, "test", "fake-container.mjs")}" "$@"\n`, { mode: 0o700 });
await chmod(fakeCli, 0o700);

process.env.CTRL_DATA_DIR = dataDir;
process.env.HELM_CHANNEL_COMPUTER_BACKEND = "apple";
process.env.HELM_CONTAINER_CLI = fakeCli;
process.env.FAKE_CONTAINER_STATE = fakeState;
process.env.HELM_FLEET_INTERVAL_MS = "600000";
process.env.HELM_FLEET_INITIAL_MS = "25";
process.env.HELM_MACHINE_IDLE_MS = "60000";

const db = await import("../src/server/db.ts");
db.seed();
const computers = await import("../src/server/channel-computers.ts");
const agents = await import("../src/server/agents.ts");

function addResidentChannel(name) {
  const stamp = Date.now();
  const channelId = db.run("INSERT INTO channels (name,slug,kind,topic,purpose,status,created) VALUES (?,?,'channel',?,?,'active',?)", name, name, name, name, stamp).lastInsertRowid;
  const botId = db.run("INSERT INTO bots (name,created) VALUES (?,?)", `${name}-agent`, stamp).lastInsertRowid;
  const agentId = db.run("INSERT INTO agents (bot_id,kind,name,display_name,status,created) VALUES (?,'channel',?,?,'ready',?)", botId, `${name}-agent`, `${name}-agent`, stamp).lastInsertRowid;
  db.run("INSERT INTO agent_channels (agent_id,channel_id,bound_at) VALUES (?,?,?)", agentId, channelId, stamp);
  return { channelId, botId, agentId };
}

test("Apple channel-computer contract preserves isolation, files, wakes, archive, and exact ownership", async (t) => {
  t.after(() => rmSync(testRoot, { recursive: true, force: true }));
  const alpha = addResidentChannel("alpha");
  const beta = addResidentChannel("beta");
  const mainId = Number(db.q1("SELECT id FROM channels WHERE name='main'").id);
  assert.throws(() => computers.ensureChannelComputerRecord(mainId), /not found/i, "#main/Skipper never receives an ordinary channel VM");

  const alphaComputer = await computers.provisionChannelComputer(alpha.channelId);
  const betaComputer = await computers.provisionChannelComputer(beta.channelId);
  assert.notEqual(alphaComputer.machine_id, betaComputer.machine_id);
  assert.match(alphaComputer.machine_id, /^1helm-[a-f0-9]{16}-channel-\d+$/);
  assert.equal(alphaComputer.home_mount, "none");
  assert.equal(betaComputer.home_mount, "none");
  assert.equal(db.q1("SELECT COUNT(*) n FROM bot_computers WHERE bot_id IN (?,?)", alpha.botId, beta.botId).n, 0, "residents have no native This Computer assignment");
  const staleUpdate = Date.now() - 8 * 24 * 60 * 60_000;
  db.run("UPDATE channel_computers SET last_update=?,last_update_attempt=0 WHERE channel_id IN (?,?)", staleUpdate, alpha.channelId, beta.channelId);
  const scopedReconcile = await computers.reconcileChannelComputers([alpha.channelId]);
  assert.deepEqual(scopedReconcile, { checked: 1, errors: 0 });
  assert.ok(Number(db.q1("SELECT last_update FROM channel_computers WHERE channel_id=?", alpha.channelId).last_update) > 0, "Skipper applies unattended guest updates while the VM is quiescent");
  assert.equal(Number(db.q1("SELECT last_update FROM channel_computers WHERE channel_id=?", beta.channelId).last_update), staleUpdate, "a scoped fleet reconciliation cannot inspect or update another channel computer");
  await computers.reconcileChannelComputers();

  let result = await computers.runChannelCommand(alpha.channelId, "printf alpha > agent.txt; printf upload-from-guest > files/guest.txt");
  assert.equal(result.exit_code, 0);
  assert.equal(readFileSync(join(dataDir, "channels", String(alpha.channelId), "workspace", "agent.txt"), "utf8"), "alpha");
  assert.equal(readFileSync(join(dataDir, "channels", String(alpha.channelId), "files", "guest.txt"), "utf8"), "upload-from-guest", "guest /workspace/files mirrors to the Files tree");
  assert.equal(existsSync(join(fakeState, "machines", betaComputer.machine_id, "workspace", "agent.txt")), false, "channel B cannot see channel A's workspace");

  const betaRoot = join(fakeState, "machines", betaComputer.machine_id);
  db.run("UPDATE channel_computers SET last_used=? WHERE channel_id=?", Date.now() - 120_000, beta.channelId);
  writeFileSync(join(betaRoot, ".uncertain-quiescence"), "1");
  await computers.reconcileChannelComputers();
  assert.equal(db.q1("SELECT observed_state FROM channel_computers WHERE channel_id=?", beta.channelId).observed_state, "running", "uncertain guest inspection conservatively keeps a VM running");
  rmSync(join(betaRoot, ".uncertain-quiescence"));
  writeFileSync(join(betaRoot, ".resident-runtime"), "1");
  await computers.reconcileChannelComputers();
  assert.equal(db.q1("SELECT observed_state FROM channel_computers WHERE channel_id=?", beta.channelId).observed_state, "running", "a guest systemd timer prevents unsafe idle sleep");
  const betaConfigPath = join(betaRoot, "config.json");
  const externallyStopped = JSON.parse(readFileSync(betaConfigPath, "utf8"));
  externallyStopped.status = "stopped";
  writeFileSync(betaConfigPath, JSON.stringify(externallyStopped));
  await computers.reconcileChannelComputers();
  assert.equal(db.q1("SELECT observed_state FROM channel_computers WHERE channel_id=?", beta.channelId).observed_state, "running", "a previously detected guest timer/service wakes again after an unexpected VM stop");
  rmSync(join(betaRoot, ".resident-runtime"));
  db.run("UPDATE channel_computers SET last_used=? WHERE channel_id=?", Date.now() - 120_000, beta.channelId);
  await computers.reconcileChannelComputers();
  assert.equal(db.q1("SELECT observed_state FROM channel_computers WHERE channel_id=?", beta.channelId).observed_state, "stopped", "a proven-quiescent stale VM may sleep");

  await computers.ensureChannelComputerRunning(beta.channelId, "terminal safety test");
  const terminalId = await computers.openChannelTerminal(beta.channelId, 7, 80, 24);
  await computers.stopChannelComputer(beta.channelId, "idle");
  assert.equal(db.q1("SELECT observed_state FROM channel_computers WHERE channel_id=?", beta.channelId).observed_state, "running", "active terminal prevents stopping");
  computers.closeChannelTerminal(terminalId);
  const resized = await computers.resizeChannelComputer(beta.channelId, 1, 1024 ** 3);
  assert.equal(resized.cpus, 1);
  assert.equal(resized.memory_bytes, 1024 ** 3);
  assert.equal(resized.home_mount, "none", "safe resize re-verifies resources and the no-home-mount invariant");

  const hostUpload = join(dataDir, "channels", String(alpha.channelId), "files", "host.txt");
  writeFileSync(hostUpload, "upload-from-host");
  computers.markWorkspaceDirty(alpha.channelId, "files/host.txt", "upsert");
  result = await computers.runChannelCommand(alpha.channelId, "cat files/host.txt; rm files/guest.txt; printf '%s' \"semi; quote ' and space\" > 'name with spaces.txt'");
  assert.match(result.output, /upload-from-host/);
  assert.equal(readFileSync(join(dataDir, "channels", String(alpha.channelId), "workspace", "name with spaces.txt"), "utf8"), "semi; quote ' and space", "guest command quoting survives Apple's login-shell handoff");
  assert.equal(existsSync(join(dataDir, "channels", String(alpha.channelId), "files", "guest.txt")), false, "guest deletions do not resurrect stale Files entries");

  computers.upsertObligation(alpha.channelId, "command", "held", "resident", "active work");
  await computers.stopChannelComputer(alpha.channelId, "idle");
  assert.equal(db.q1("SELECT observed_state FROM channel_computers WHERE channel_id=?", alpha.channelId).observed_state, "running", "resident work prevents idle sleep");
  computers.satisfyObligation(alpha.channelId, "command", "held");
  await computers.stopChannelComputer(alpha.channelId, "idle");
  assert.equal(db.q1("SELECT observed_state FROM channel_computers WHERE channel_id=?", alpha.channelId).observed_state, "stopped");
  assert.equal(db.q1("SELECT status FROM channels WHERE id=?", alpha.channelId).status, "active", "idle sleep is distinct from archive");

  computers.upsertObligation(alpha.channelId, "followup", "due", "wakeable", "native scheduled work", Date.now() - 1);
  const wake = await computers.wakeDueChannelComputers();
  assert.equal(wake.woken, 1);
  assert.equal(db.q1("SELECT observed_state FROM channel_computers WHERE channel_id=?", alpha.channelId).observed_state, "running", "native follow-up wakes a stopped VM");
  computers.satisfyObligation(alpha.channelId, "followup", "due");

  await agents.archiveChannel(alpha.channelId);
  assert.equal(db.q1("SELECT status FROM channels WHERE id=?", alpha.channelId).status, "archived");
  assert.equal(db.q1("SELECT observed_state FROM channel_computers WHERE channel_id=?", alpha.channelId).observed_state, "stopped");
  await agents.restoreChannel(alpha.channelId);
  const restored = db.q1("SELECT machine_id,observed_state FROM channel_computers WHERE channel_id=?", alpha.channelId);
  assert.equal(restored.machine_id, alphaComputer.machine_id, "restore starts the same persistent VM");
  assert.equal(restored.observed_state, "running");
  result = await computers.runChannelCommand(alpha.channelId, "cat agent.txt");
  assert.match(result.output, /alpha/, "VM filesystem persists across stop/start");

  writeFileSync(join(fakeState, "machines", alphaComputer.machine_id, "var", "lib", "1helm", "owner"), "somebody-else:999\n");
  await assert.rejects(computers.deleteChannelComputer(alpha.channelId), /ownership marker/i, "typed delete refuses a name collision without exact guest ownership");
  const installationId = db.q1("SELECT installation_id FROM workspace WHERE id=1").installation_id;
  writeFileSync(join(fakeState, "machines", alphaComputer.machine_id, "var", "lib", "1helm", "owner"), `${installationId}:${alpha.channelId}\n`);
  await computers.deleteChannelComputer(alpha.channelId);
  assert.equal(existsSync(join(fakeState, "machines", alphaComputer.machine_id)), false);
  assert.equal(existsSync(join(fakeState, "machines", betaComputer.machine_id)), true, "exact delete never removes another channel's VM");

  const calls = (await readFile(join(fakeState, "calls.log"), "utf8")).trim().split("\n").map(JSON.parse);
  const creates = calls.filter((call) => call[0] === "machine" && call[1] === "create");
  assert.ok(creates.length >= 2 && creates.every((call) => call.includes("--home-mount") && call.includes("none")), "every Apple create argv disables the Mac home mount");
  const setupCalls = calls.filter((call) => call.some((word) => word.includes("image-contract")) && call.some((word) => word.includes("/var/lib/1helm/owner")));
  assert.ok(setupCalls.length >= creates.length * 2, "a new machine's transient first guest transport failure is retried without weakening setup checks");
  assert.ok(calls.some((call) => call.includes("-w") && call.includes("/workspace") && call.some((word) => word.includes("/bin/bash")) && call.some((word) => word.includes("-lc"))), "resident commands execute in the correct VM workspace");
  assert.equal(db.q1("SELECT disk_bytes FROM channel_computers WHERE channel_id=?", beta.channelId).disk_bytes, computers.MANAGED_CHANNEL_DISK_BYTES, "reported storage is the managed writable allocation, not Apple's host-backed virtual capacity");
  const backend = await readFile(join(root, "src", "server", "channel-computers.ts"), "utf8");
  assert.match(backend, /terminal \? \["-it"\] : pipeInput \? \["-i"\]/, "Apple terminal and streamed-stdin invocations request the exact interactive mode they need");
  assert.match(backend, /isolatedInvocation\(\["\/bin\/bash", "-l"\][\s\S]*true\)/, "interactive isolated terminals request an explicit guest login shell");
  assert.match(backend, /args: \[\.\.\.words, \.\.\.guestWords\(\.\.\.args\)\]/, "Apple guest argv remains quoted for the runtime's documented second shell parse");
  assert.match(backend, /WSL_ROOTFS_RELEASE = "20240423"/);
  assert.match(backend, /ubuntu-noble-wsl-amd64-wsl\.rootfs\.tar\.gz/);
  assert.match(backend, /ubuntu-noble-wsl-arm64-wsl\.rootfs\.tar\.gz/);
  assert.doesNotMatch(backend, /cloud-images\.ubuntu\.com\/wsl\/releases\/24\.04\/current/, "WSL provisioning never trusts Canonical's mutable current alias");

  // Reproduce the real Apple race: uninstall begins while an automatic fleet
  // pass is already inspecting a machine. Removal must wait for that pass,
  // fence future ticks, and leave nothing for a stale snapshot to recreate.
  process.env.FAKE_CONTAINER_INSPECT_DELAY_MS = "200";
  computers.startChannelComputerReconciler();
  await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  const removal = await computers.prepareAppRemoval();
  assert.equal(removal.deleted, 1, "uninstall preparation deletes every remaining VM owned by this exact 1Helm installation");
  assert.equal(removal.remaining, 0);
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  assert.equal(existsSync(join(fakeState, "machines", betaComputer.machine_id)), false, "no owned channel VM survives uninstall preparation");
  computers.reactivateComputersAfterPreparedRemoval();
  assert.equal(db.q1("SELECT desired_state FROM channel_computers WHERE channel_id=?", beta.channelId).desired_state, "auto", "a later reinstall can rebuild the removed VM from its preserved host mirror");
});

test("runtime digest and packaged image recipe stay pinned", async () => {
  assert.equal(computers.APPLE_RUNTIME_SHA256, "0ca1c42a2269c2557efb1d82b1b38ac553e6a3a3da1b1179c439bcee1e7d6714");
  assert.match(computers.APPLE_RUNTIME_URL, /\/1\.1\.0\/container-1\.1\.0-installer-signed\.pkg$/);
  assert.equal(computers.DEFAULT_CHANNEL_IMAGE, "local/1helm-channel-machine:0.0.6");
  const packaging = await readFile(join(root, "scripts", "package-mac-dmg.cjs"), "utf8");
  assert.match(packaging, /container\(\?:\$\|\\\/\)/, "release packaging includes container/ image assets");
  const image = await readFile(join(root, "container", "Containerfile"), "utf8");
  for (const unit of ["systemd-tmpfiles-clean.timer", "systemd-sysext.socket", "systemd-ask-password-console.path", "systemd-ask-password-wall.path"]) {
    assert.match(image, new RegExp(unit.replaceAll(".", "\\.")), `image masks stock ${unit} baseline`);
  }
  const backend = await readFile(join(root, "src", "server", "channel-computers.ts"), "utf8");
  assert.match(backend, /pkgutil.*--check-signature/s);
  assert.match(backend, /spctl.*--type.*install/s);
  assert.doesNotMatch(backend, /command -v \$\{candidate\}/, "container CLI discovery never interpolates an environment value into a shell command");
  assert.match(backend, /apple\(\["machine", "delete", computer\.machine_id\]/, "channel deletion uses Apple's full machine-delete lifecycle rather than leaving runtime services behind");
  assert.doesNotMatch(backend, /apple\(\["machine", "rm"/, "no product deletion path uses Apple's record-only machine rm operation");
  const acceptance = await readFile(join(root, "scripts", "mac-channel-computer-acceptance.mjs"), "utf8");
  assert.match(acceptance, /acceptance cleanup left/, "the real Apple acceptance test fails instead of silently leaking channel VMs");
  assert.doesNotMatch(acceptance, /deleteChannelComputer\(channelId\)\.catch\(\(\) => undefined\)/, "acceptance cleanup never suppresses a failed VM deletion");

});
