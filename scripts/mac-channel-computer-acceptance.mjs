#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WebSocket, WebSocketServer } from "ws";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Real channel-computer acceptance requires Apple Silicon macOS.");
const root = resolve(import.meta.dirname, "..");
const acceptanceRoot = mkdtempSync(join(tmpdir(), "1helm-real-channel-computers-"));
process.env.CTRL_DATA_DIR = join(acceptanceRoot, "data");
process.env.HELM_APP_ROOT = root;
process.env.HELM_CHANNEL_COMPUTER_BACKEND = "apple";
process.env.HELM_MACHINE_IDLE_MS = "60000";
process.env.HELM_FLEET_INTERVAL_MS = "600000";

const db = await import("../src/server/db.ts");
db.seed();
const fleet = await import("../src/server/channel-computers.ts");
const agents = await import("../src/server/agents.ts");
const created = [];
let assertions = 0;
const pass = (condition, label) => { assert.ok(condition, label); assertions++; process.stdout.write(`ok ${assertions} - ${label}\n`); };

function addResidentChannel(name) {
  const stamp = Date.now();
  const channelId = db.run("INSERT INTO channels (name,slug,kind,topic,purpose,status,created) VALUES (?,?,'channel',?,?,'active',?)", name, name, name, name, stamp).lastInsertRowid;
  const botId = db.run("INSERT INTO bots (name,created) VALUES (?,?)", `${name}-agent`, stamp).lastInsertRowid;
  const agentId = db.run("INSERT INTO agents (bot_id,kind,name,display_name,status,created) VALUES (?,'channel',?,?,'ready',?)", botId, `${name}-agent`, `${name}-agent`, stamp).lastInsertRowid;
  db.run("INSERT INTO agent_channels (agent_id,channel_id,bound_at) VALUES (?,?,?)", agentId, channelId, stamp);
  created.push(channelId);
  return { channelId, botId, agentId };
}

function container(args, allowFailure = false) {
  const cli = ["/usr/local/bin/container", "/opt/homebrew/bin/container", "container"].find((candidate) => candidate === "container" || existsSync(candidate));
  const result = spawnSync(cli, args, { encoding: "utf8", timeout: 10 * 60_000 });
  if (!allowFailure && result.status !== 0) throw new Error((result.stderr || result.stdout || `container ${args.join(" ")} failed`).trim());
  return result;
}

function inspectMachine(id) {
  const result = container(["machine", "inspect", id]);
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

async function terminalCommand(channelId, command) {
  const ownerId = 9173;
  const sessionId = await fleet.openChannelTerminal(channelId, ownerId, 100, 30);
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolveReady, reject) => { server.once("listening", resolveReady); server.once("error", reject); });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  server.once("connection", (socket) => { void fleet.attachChannelTerminal(sessionId, socket, ownerId); });
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  let output = "";
  try {
    await new Promise((resolveOpen, reject) => { client.once("open", resolveOpen); client.once("error", reject); });
    const encoded = Buffer.from(`${command}; echo ACCEPTANCE_TERM_DONE`, "utf8").toString("base64");
    client.send(JSON.stringify({ type: "input", data: `printf '%s' '${encoded}' | base64 -d | bash\r` }));
    await new Promise((resolveDone, reject) => {
      const timeout = setTimeout(() => reject(new Error(`terminal acceptance timed out: ${output}`)), 20_000);
      client.on("message", (chunk) => {
        output += chunk.toString();
        if (output.includes("ACCEPTANCE_TERM_DONE")) { clearTimeout(timeout); resolveDone(); }
      });
      client.once("error", reject);
    });
    return { sessionId, output };
  } catch (error) {
    fleet.closeChannelTerminal(sessionId);
    throw error;
  } finally {
    client.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

async function cleanupGuestObligations(channelId) {
  await fleet.runChannelCommand(channelId, [
    "sudo systemctl disable --now 1helm-acceptance.timer 1helm-acceptance.service cron >/dev/null 2>&1 || true",
    "sudo rm -f /etc/systemd/system/1helm-acceptance.timer /etc/systemd/system/1helm-acceptance.service /etc/cron.d/1helm-acceptance",
    "sudo systemctl daemon-reload",
  ].join("; "));
}

async function reconcileUntilState(channelId, expected, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await fleet.reconcileChannelComputers();
    if (db.q1("SELECT observed_state FROM channel_computers WHERE channel_id=?", channelId)?.observed_state === expected) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 750));
  }
  return false;
}

async function reconcileUntilQuiescent(channelId, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await fleet.reconcileChannelComputers();
    const running = db.q1("SELECT observed_state FROM channel_computers WHERE channel_id=?", channelId)?.observed_state === "running";
    const resident = fleet.computerObligations(channelId).some((obligation) => obligation.mode === "resident");
    if (running && !resident) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 750));
  }
  const computer = db.q1("SELECT observed_state,last_error,last_health,last_used FROM channel_computers WHERE channel_id=?", channelId);
  process.stderr.write(`quiescence diagnostic: computer=${JSON.stringify(computer)} obligations=${JSON.stringify(fleet.computerObligations(channelId))}\n`);
  return false;
}

try {
  const readiness = fleet.runtimeReadiness();
  pass(readiness.ready === true, "pinned Apple container 1.1.0 runtime is running");
  const alpha = addResidentChannel("accept-alpha");
  const beta = addResidentChannel("accept-beta");
  const mainId = Number(db.q1("SELECT id FROM channels WHERE name='main'").id);
  assert.throws(() => fleet.ensureChannelComputerRecord(mainId), /not found/i);
  pass(true, "#main/Skipper remains native and has no ordinary channel VM");

  let alphaComputer = await fleet.provisionChannelComputer(alpha.channelId);
  let betaComputer = await fleet.provisionChannelComputer(beta.channelId);
  pass(alphaComputer.machine_id !== betaComputer.machine_id, "two ordinary channels create two distinct VMs");
  const alphaInspect = inspectMachine(alphaComputer.machine_id);
  const betaInspect = inspectMachine(betaComputer.machine_id);
  pass(alphaInspect.homeMount === "none" && betaInspect.homeMount === "none", "both real VMs have homeMount none");
  pass(!db.q1("SELECT 1 FROM bot_computers WHERE bot_id IN (?,?)", alpha.botId, beta.botId), "neither resident is assigned the native Mac computer");

  let result = await fleet.runChannelCommand(alpha.channelId, "printf alpha-persistent > durable.txt; printf guest-file > files/from-guest.txt");
  pass(result.exit_code === 0, "agent command executes inside channel A VM");
  result = await fleet.runChannelCommand(beta.channelId, "test ! -e durable.txt && printf beta-only > beta.txt");
  pass(result.exit_code === 0, "channel B cannot see channel A filesystem");
  result = await fleet.runChannelCommand(alpha.channelId, "test ! -d /Users || test -z \"$(find /Users -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)\"");
  pass(result.exit_code === 0, "ordinary channel cannot see the Mac home tree");
  pass(readFileSync(join(process.env.CTRL_DATA_DIR, "channels", String(alpha.channelId), "files", "from-guest.txt"), "utf8") === "guest-file", "guest /workspace/files mirrors into Files UI state");

  const terminal = await terminalCommand(alpha.channelId, "printf terminal-shared > terminal.txt");
  pass(/ACCEPTANCE_TERM_DONE/.test(terminal.output), "human Terminal runs in the channel VM");
  await fleet.stopChannelComputer(alpha.channelId, "idle");
  pass(db.q1("SELECT observed_state FROM channel_computers WHERE channel_id=?", alpha.channelId).observed_state === "running", "active terminal prevents stopping");
  fleet.closeChannelTerminal(terminal.sessionId);
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  result = await fleet.runChannelCommand(alpha.channelId, "cat terminal.txt");
  pass(/terminal-shared/.test(result.output), "Terminal and resident command share one persistent VM workspace");

  await fleet.stopChannelComputer(alpha.channelId, "idle");
  await fleet.ensureChannelComputerRunning(alpha.channelId, "persistence acceptance");
  result = await fleet.runChannelCommand(alpha.channelId, "cat durable.txt");
  pass(/alpha-persistent/.test(result.output), "VM filesystem persists across stop/start");

  const hostFile = join(process.env.CTRL_DATA_DIR, "channels", String(alpha.channelId), "files", "from-host.txt");
  writeFileSync(hostFile, "host-upload");
  fleet.markWorkspaceDirty(alpha.channelId, "files/from-host.txt", "upsert");
  result = await fleet.runChannelCommand(alpha.channelId, "cat files/from-host.txt; rm files/from-guest.txt");
  pass(/host-upload/.test(result.output) && !existsSync(join(process.env.CTRL_DATA_DIR, "channels", String(alpha.channelId), "files", "from-guest.txt")), "Files bridge works both directions without stale deletion resurrection");

  await fleet.stopChannelComputer(alpha.channelId, "idle");
  fleet.upsertObligation(alpha.channelId, "followup", "real-due", "wakeable", "real native wake acceptance", Date.now() - 1);
  const wake = await fleet.wakeDueChannelComputers();
  fleet.satisfyObligation(alpha.channelId, "followup", "real-due");
  pass(wake.woken === 1 && db.q1("SELECT observed_state FROM channel_computers WHERE channel_id=?", alpha.channelId).observed_state === "running", "native follow-up wakes a stopped VM");

  const obligationsScript = [
    "sudo sh -c 'printf \"[Unit]\\nDescription=1Helm acceptance service\\n[Service]\\nExecStart=/bin/sleep infinity\\n\" > /etc/systemd/system/1helm-acceptance.service'",
    "sudo sh -c 'printf \"[Unit]\\nDescription=1Helm acceptance timer\\n[Timer]\\nOnCalendar=*-*-* 00:00:00\\nPersistent=true\\n[Install]\\nWantedBy=timers.target\\n\" > /etc/systemd/system/1helm-acceptance.timer'",
    "sudo sh -c 'printf \"17 3 * * * root /bin/true\\n\" > /etc/cron.d/1helm-acceptance'",
    "sudo systemctl daemon-reload",
    "sudo systemctl enable --now 1helm-acceptance.service 1helm-acceptance.timer cron",
  ].join("; ");
  result = await fleet.runChannelCommand(beta.channelId, obligationsScript);
  assert.equal(result.exit_code, 0, result.output);
  db.run("UPDATE channel_computers SET last_used=? WHERE channel_id=?", Date.now() - 120_000, beta.channelId);
  await fleet.reconcileChannelComputers();
  pass(db.q1("SELECT observed_state FROM channel_computers WHERE channel_id=?", beta.channelId).observed_state === "running", "guest service, systemd timer, and cron prevent unsafe stopping");
  container(["machine", "stop", betaComputer.machine_id]);
  await fleet.reconcileChannelComputers();
  pass(db.q1("SELECT observed_state FROM channel_computers WHERE channel_id=?", beta.channelId).observed_state === "running", "known guest schedules wake again after an unexpected VM stop or host restart");
  await cleanupGuestObligations(beta.channelId);
  db.run("UPDATE channel_computers SET last_used=? WHERE channel_id=?", Date.now() - 120_000, beta.channelId);
  pass(await reconcileUntilState(beta.channelId, "stopped"), "a fresh VM with no user obligations can sleep after quiescence is proved");

  result = await fleet.runChannelCommand(beta.channelId, "sudo mv /usr/bin/systemctl /usr/bin/systemctl.1helm-acceptance");
  assert.equal(result.exit_code, 0, result.output);
  try {
    db.run("UPDATE channel_computers SET last_used=? WHERE channel_id=?", Date.now() - 120_000, beta.channelId);
    await fleet.reconcileChannelComputers();
    pass(db.q1("SELECT observed_state FROM channel_computers WHERE channel_id=?", beta.channelId).observed_state === "running", "uncertain guest quiescence keeps the real VM running");
  } finally {
    result = await fleet.runChannelCommand(beta.channelId, "sudo mv /usr/bin/systemctl.1helm-acceptance /usr/bin/systemctl");
    assert.equal(result.exit_code, 0, result.output);
  }
  pass(await reconcileUntilQuiescent(beta.channelId), "a healthy probe clears the conservative uncertainty obligation before maintenance");

  betaComputer = await fleet.resizeChannelComputer(beta.channelId, betaComputer.cpus === 1 ? 2 : 1, betaComputer.memory_bytes === 1024 ** 3 ? 2 * 1024 ** 3 : 1024 ** 3);
  const resizedInspect = inspectMachine(betaComputer.machine_id);
  pass(Number(resizedInspect.cpus) === betaComputer.cpus && Number(resizedInspect.memory) === betaComputer.memory_bytes && resizedInspect.homeMount === "none", "safe resize verifies target CPU/RAM and security boundary");

  await agents.archiveChannel(alpha.channelId);
  pass(db.q1("SELECT observed_state FROM channel_computers WHERE channel_id=?", alpha.channelId).observed_state === "stopped", "archive stops and preserves the exact VM");
  await agents.restoreChannel(alpha.channelId);
  alphaComputer = fleet.channelComputer(alpha.channelId);
  result = await fleet.runChannelCommand(alpha.channelId, "cat durable.txt");
  pass(alphaComputer.machine_id === alphaInspect.id && /alpha-persistent/.test(result.output), "restore starts the same persistent VM");

  // Simulate external loss. Reconciliation must recreate the same owned ID,
  // replay the host mirror, and never duplicate a machine.
  container(["machine", "delete", betaComputer.machine_id]);
  await fleet.reconcileChannelComputers();
  betaComputer = fleet.channelComputer(beta.channelId);
  result = await fleet.runChannelCommand(beta.channelId, "cat beta.txt");
  const machineList = container(["machine", "ls", "--format", "json"]);
  const listPayload = JSON.parse(machineList.stdout);
  const listed = (Array.isArray(listPayload) ? listPayload : listPayload.machines || []).filter((machine) => machine.id === betaComputer.machine_id);
  pass(listed.length === 1 && /beta-only/.test(result.output), "startup reconciliation repairs a missing machine without duplicates and restores its mirror");

  await fleet.runChannelCommand(alpha.channelId, "sudo sh -c 'printf wrong-owner > /var/lib/1helm/owner'");
  await assert.rejects(fleet.deleteChannelComputer(alpha.channelId), /ownership marker/i);
  pass(true, "delete refuses a machine without the exact in-guest ownership marker");
  const installationId = String(db.q1("SELECT installation_id FROM workspace WHERE id=1").installation_id);
  container(["machine", "run", "--root", "-n", alphaComputer.machine_id, "--", "'/bin/sh'", "'-lc'", `'printf "%s\\n" "${installationId}:${alpha.channelId}" > /var/lib/1helm/owner'`]);
  await fleet.deleteChannelComputer(alpha.channelId);
  pass(inspectMachine(betaComputer.machine_id).id === betaComputer.machine_id, "typed exact delete removes only its owned VM and leaves the other channel intact");

  process.stdout.write(`REAL_APPLE_ACCEPTANCE_OK assertions=${assertions}\n`);
} finally {
  const cleanupFailures = [];
  for (const channelId of created) {
    try {
      const computer = fleet.channelComputer(channelId);
      if (!computer || computer.observed_state === "deleted") continue;
      const installationId = String(db.q1("SELECT installation_id FROM workspace WHERE id=1")?.installation_id || "");
      container(["machine", "run", "--root", "-n", computer.machine_id, "--", "'/bin/bash'", "'-lc'", `'test -e /usr/bin/systemctl || mv /usr/bin/systemctl.1helm-acceptance /usr/bin/systemctl; printf "%s\\n" "${installationId}:${channelId}" > /var/lib/1helm/owner'`], true);
      await fleet.deleteChannelComputer(channelId);
      const residual = container(["machine", "inspect", computer.machine_id], true);
      if (residual.status === 0) throw new Error(`acceptance cleanup left ${computer.machine_id} behind`);
    } catch (error) {
      cleanupFailures.push(`channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  try { db.db.close(); } catch { /* already closed */ }
  rmSync(acceptanceRoot, { recursive: true, force: true });
  if (cleanupFailures.length) throw new Error(`Real Apple acceptance cleanup failed:\n${cleanupFailures.join("\n")}`);
}
