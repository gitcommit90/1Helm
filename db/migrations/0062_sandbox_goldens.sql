-- The golden answers an administrator saved for a Sandbox job (additive, new table). Written and read by src/ee/sandbox-goldens.js.
CREATE TABLE IF NOT EXISTS sandbox_goldens (job TEXT PRIMARY KEY, golden TEXT NOT NULL, at INTEGER NOT NULL, by TEXT);
