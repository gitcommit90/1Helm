import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("legacy channel-computer backend schema widens without losing worlds or obligations", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "1helm-backend-migration-"));
  const legacy = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  legacy.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE channels (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'channel',
      topic TEXT NOT NULL DEFAULT '',
      created_by INTEGER,
      created INTEGER NOT NULL
    );
    CREATE TABLE channel_computers (
      channel_id INTEGER PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
      backend TEXT NOT NULL CHECK (backend IN ('apple','native','mock')),
      machine_id TEXT NOT NULL UNIQUE,
      image TEXT NOT NULL DEFAULT '',
      desired_state TEXT NOT NULL DEFAULT 'auto' CHECK (desired_state IN ('auto','running','stopped','deleted')),
      observed_state TEXT NOT NULL DEFAULT 'unknown',
      cpus INTEGER NOT NULL,
      memory_bytes INTEGER NOT NULL,
      disk_bytes INTEGER NOT NULL DEFAULT 0,
      home_mount TEXT NOT NULL DEFAULT 'none' CHECK (home_mount='none'),
      provision_status TEXT NOT NULL DEFAULT 'pending' CHECK (provision_status IN ('pending','provisioning','ready','repairing','error','deleted')),
      maintenance_state TEXT NOT NULL DEFAULT 'idle',
      host_revision INTEGER NOT NULL DEFAULT 0,
      synced_host_revision INTEGER NOT NULL DEFAULT 0,
      guest_revision INTEGER NOT NULL DEFAULT 0,
      pressure_json TEXT NOT NULL DEFAULT '{}',
      low_pressure_streak INTEGER NOT NULL DEFAULT 0,
      last_update INTEGER NOT NULL DEFAULT 0,
      last_update_attempt INTEGER NOT NULL DEFAULT 0,
      last_health INTEGER NOT NULL DEFAULT 0,
      last_used INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      created INTEGER NOT NULL,
      updated INTEGER NOT NULL
    );
    CREATE INDEX idx_channel_computers_state ON channel_computers(desired_state, observed_state, provision_status);
    CREATE TABLE channel_computer_obligations (
      channel_id INTEGER NOT NULL REFERENCES channel_computers(channel_id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'resident' CHECK (mode IN ('resident','wakeable')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','satisfied','cancelled')),
      details TEXT NOT NULL DEFAULT '',
      due_at INTEGER,
      created INTEGER NOT NULL,
      updated INTEGER NOT NULL,
      PRIMARY KEY (channel_id, kind, ref)
    );
    CREATE INDEX idx_computer_obligations_active ON channel_computer_obligations(channel_id, status, mode, due_at);
    CREATE TABLE channel_workspace_changes (
      channel_id INTEGER NOT NULL REFERENCES channel_computers(channel_id) ON DELETE CASCADE,
      relative_path TEXT NOT NULL,
      operation TEXT NOT NULL DEFAULT 'upsert' CHECK (operation IN ('upsert','delete','full')),
      created INTEGER NOT NULL,
      PRIMARY KEY (channel_id, relative_path)
    );
    INSERT INTO channels (id,name,kind,topic,created) VALUES (91,'legacy-world','channel','',1000);
    INSERT INTO channel_computers
      (channel_id,backend,machine_id,image,desired_state,observed_state,cpus,memory_bytes,disk_bytes,home_mount,provision_status,created,updated)
      VALUES (91,'native','1helm-0123456789abcdef-channel-91','legacy-image','auto','running',2,2147483648,2147483648,'none','ready',1000,1000);
    INSERT INTO channel_computer_obligations
      (channel_id,kind,ref,mode,status,details,due_at,created,updated)
      VALUES (91,'followup','legacy-followup','wakeable','active','preserve me',2000,1000,1000);
    INSERT INTO channel_workspace_changes (channel_id,relative_path,operation,created)
      VALUES (91,'workspace/retained.txt','upsert',1000);
  `);
  legacy.close();

  process.env.CTRL_DATA_DIR = dataDir;
  process.env.HELM_CHANNEL_COMPUTER_BACKEND = "native";
  const database = await import(`../src/server/db.ts?backend-migration=${Date.now()}`);
  try {
    database.migrate();
    const schema = String(database.q1("SELECT sql FROM sqlite_master WHERE type='table' AND name='channel_computers'")?.sql || "");
    assert.match(schema, /'lxc'/);
    assert.match(schema, /'wsl'/);
    assert.equal(database.q1("SELECT backend FROM channel_computers WHERE channel_id=91")?.backend, "native");
    assert.equal(database.q1("SELECT details FROM channel_computer_obligations WHERE channel_id=91")?.details, "preserve me");
    assert.equal(database.q1("SELECT operation FROM channel_workspace_changes WHERE channel_id=91 AND relative_path='workspace/retained.txt'")?.operation, "upsert");
    assert.equal(database.q("PRAGMA foreign_key_check").length, 0);
  } finally {
    database.db.close();
    delete process.env.CTRL_DATA_DIR;
    delete process.env.HELM_CHANNEL_COMPUTER_BACKEND;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
