-- 10-06 Account notes: a short plain-text note the person (or the helper, when they say so) leaves on one connected account,
-- e.g. "my work email; use for anything Tennis Channel". Keyed by workspace + Composio connected-account id. Shown under the account
-- in the app page and Settings → Connected accounts, and in the helper's connected-apps line. Deleted when the account is disconnected
-- (composio.js appDisconnect) and with the workspace (deletion.js: every table with tenant_id). Purely additive.
CREATE TABLE IF NOT EXISTS account_note (tenant_id TEXT NOT NULL, account_id TEXT NOT NULL, app TEXT NOT NULL DEFAULT '', note TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'person', updated_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, account_id));
