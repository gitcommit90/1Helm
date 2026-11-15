-- 10-01 Text with your helper (BYOP: each person's own free Photon project). One row per workspace.
CREATE TABLE IF NOT EXISTS texting (
  tenant_id TEXT PRIMARY KEY,
  hook_id TEXT NOT NULL UNIQUE,          -- random path segment of this workspace's Photon webhook URL
  phone TEXT NOT NULL,                   -- the person's cell (E.164); the ONLY number that can ever talk to this helper
  status TEXT NOT NULL,                  -- signup | awaiting_code | connected | off
  device_code_sealed TEXT, user_code TEXT, verify_url TEXT, device_expires INTEGER,
  project_id TEXT, project_secret_sealed TEXT, webhook_id TEXT, webhook_secret_sealed TEXT,
  assigned TEXT,                         -- the number Photon assigned this person (what they text)
  code TEXT, code_expires INTEGER,
  inbound_count INTEGER NOT NULL DEFAULT 0,
  last_inbound_id TEXT,
  error TEXT,
  connected_at INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS texting_seen (msg_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, at INTEGER NOT NULL);
