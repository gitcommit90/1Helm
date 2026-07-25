import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const testRoot = mkdtempSync(join(tmpdir(), "1helm-sweep-fleet-telemetry-"));
process.env.CTRL_DATA_DIR = join(testRoot, "data");
process.env.HELM_CHANNEL_COMPUTER_BACKEND = "mock";

const db = await import("../src/server/db.ts");
db.seed();
const computers = await import("../src/server/channel-computers.ts");
const bots = await import("../src/server/bots.ts");

function addResidentChannel(name) {
  const stamp = Date.now();
  const channelId = Number(db.run("INSERT INTO channels (name,slug,kind,topic,purpose,status,created) VALUES (?,?,'channel',?,?,'active',?)", name, name, name, name, stamp).lastInsertRowid);
  const botId = Number(db.run("INSERT INTO bots (name,created) VALUES (?,?)", `${name}-agent`, stamp).lastInsertRowid);
  const agentId = Number(db.run("INSERT INTO agents (bot_id,kind,name,display_name,status,created) VALUES (?,'channel',?,?,'ready',?)", botId, `${name}-agent`, `${name}-agent`, stamp).lastInsertRowid);
  db.run("INSERT INTO agent_channels (agent_id,channel_id,bound_at) VALUES (?,?,?)", agentId, channelId, stamp);
  return channelId;
}

test("fleet metadata exposes honest guest pressure and mirror semantics", () => {
  const channelId = addResidentChannel("telemetry");
  computers.ensureChannelComputerRecord(channelId);
  const sampledAt = Date.now();
  db.run(`UPDATE channel_computers SET observed_state='running',last_health=?,pressure_json=? WHERE channel_id=?`,
    sampledAt, JSON.stringify({ load1: 1.25, memoryAvailableKb: 786432, diskUsedPercent: 61 }), channelId);

  const live = computers.channelComputerView(channelId);
  assert.equal("disk_bytes" in live, false, "the mirror quota is never serialized as a VM capacity-like disk_bytes field");
  assert.equal(live.mirror_quota_bytes, computers.MANAGED_CHANNEL_DISK_BYTES);
  assert.match(live.mirror_quota_purpose, /mirror safety boundary; not VM storage capacity/i);
  assert.equal(live.guest_disk_capacity_bytes, null);
  assert.equal(live.guest_disk_capacity_status, "unknown");
  assert.deepEqual(live.pressure, {
    load1: 1.25,
    memoryAvailableKb: 786432,
    memoryAvailableBytes: 786432 * 1024,
    diskUsedPercent: 61,
    sampledAt,
    status: "live",
  });
  assert.equal(live.home_mount, "none", "telemetry does not weaken the no-host-home boundary");

  db.run("UPDATE channel_computers SET observed_state='stopped' WHERE channel_id=?", channelId);
  assert.equal(computers.channelComputerView(channelId).pressure.status, "last_known", "a stopped guest's sample is not mislabeled live");
  db.run("UPDATE channel_computers SET pressure_json='{}' WHERE channel_id=?", channelId);
  const unknown = computers.channelComputerView(channelId);
  assert.equal(unknown.pressure, undefined);
  assert.equal(unknown.pressure_status, "unknown");
});

test("Skipper tools and prompt state the fleet automation and storage contract", () => {
  const main = Number(db.q1("SELECT id FROM channels WHERE name='main' ORDER BY id LIMIT 1").id);
  let skipper = db.q1("SELECT b.id FROM bots b JOIN agents a ON a.bot_id=b.id WHERE a.kind='skipper' LIMIT 1");
  if (!skipper) {
    const stamp = Date.now();
    const botId = Number(db.run("INSERT INTO bots (name,created) VALUES ('skipper',?)", stamp).lastInsertRowid);
    db.run("INSERT INTO agents (bot_id,kind,name,display_name,status,created) VALUES (?,'skipper','skipper','Skipper','ready',?)", botId, stamp);
    skipper = { id: botId };
  }

  const prompt = bots.runtimePromptTiersForChannel(Number(skipper.id), main, true).operating;
  assert.match(prompt, /already own automatic pressure-aware/i);
  assert.match(prompt, /periodic fleet reconciliation/i);
  assert.match(prompt, /CPU\/RAM resizing/i);
  assert.match(prompt, /obligation-aware sleep, and wakeups for due work/i);
  assert.match(prompt, /mirror quota is only the guest-to-host copy safety limit, never VM storage capacity/i);
  assert.match(prompt, /actual guest capacity is unknown/i);

  const definitions = new Map(bots.runtimeToolDefinitionsForChannel(Number(skipper.id), main, true).map((tool) => [tool.name, tool.description]));
  assert.match(definitions.get("inspect_fleet"), /live guest load, available memory, and disk-used percentage/i);
  assert.match(definitions.get("inspect_fleet"), /mirror_quota_bytes is only the host-mirror safety limit/i);
  assert.match(definitions.get("care_for_channel_computer"), /existing automatic pressure-aware reconciliation, resizing, updates\/repair, safe sleep, and obligation wakeups/i);

  const contract = bots.skipperFleetManagementView();
  assert.deepEqual({
    owner: contract.owner,
    automatic: contract.automatic,
    pressure_aware: contract.pressure_aware,
    periodic_reconciliation: contract.periodic_reconciliation,
    safe_cpu_memory_resizing: contract.safe_cpu_memory_resizing,
    obligation_aware_sleep: contract.obligation_aware_sleep,
    due_obligation_wakeups: contract.due_obligation_wakeups,
  }, {
    owner: "Skipper",
    automatic: true,
    pressure_aware: true,
    periodic_reconciliation: true,
    safe_cpu_memory_resizing: true,
    obligation_aware_sleep: true,
    due_obligation_wakeups: true,
  });
  assert.match(contract.storage, /mirror_quota_bytes is the guest-to-host mirror safety limit, not VM storage capacity/i);
  assert.match(contract.storage, /guest capacity is unknown unless independently proven/i);
});

test.after(() => rmSync(testRoot, { recursive: true, force: true }));
