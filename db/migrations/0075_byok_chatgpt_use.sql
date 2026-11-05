-- ChatGPT plan usage summary and the first-sign-in message. Two new tables, nothing existing is changed.
-- src/ee/byok-chatgpt.js also creates them on first use (CG_DDL), so a fresh dev D1 works without this file.
CREATE TABLE IF NOT EXISTS byok_chatgpt_use (tenant_id TEXT NOT NULL, day TEXT NOT NULL, tokens INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tenant_id, day));
CREATE TABLE IF NOT EXISTS byok_chatgpt_welcome (tenant_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, shown_at INTEGER NOT NULL DEFAULT 0);
