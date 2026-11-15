-- The "Use your ChatGPT plan in this app" invite banner: one new table, a row means the account dismissed it. Nothing existing is changed.
-- src/ee/byok-chatgpt.js also creates it on first use (CG_DDL).
CREATE TABLE IF NOT EXISTS byok_chatgpt_invite (tenant_id TEXT PRIMARY KEY, dismissed_at INTEGER NOT NULL);
