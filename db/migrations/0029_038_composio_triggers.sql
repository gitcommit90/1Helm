-- 10-07 Composio stage 5: "when <app event> happens" workflows (src/composio-triggers.js, src/app-events.js). Purely additive: two new tables.
-- composio_triggers: one row per Composio trigger instance 1Helm made for a workflow the person set up. The project webhook
--   (/composio/webhook) routes each signed event by trigger_id to its tenant + channel (the Resident) + workflow, and only there.
--   status: active | paused | delete_pending (Composio couldn't delete it yet; the next event for it or the workspace's deletion retries).
--   Deleted with the workflow (Stop), the connected account (disconnect) and the workspace (deletion.js: every table with tenant_id).
CREATE TABLE IF NOT EXISTS composio_triggers (trigger_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, channel TEXT NOT NULL, workflow_id INTEGER NOT NULL,
  slug TEXT NOT NULL, app TEXT NOT NULL, account_id TEXT, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS composio_triggers_tenant ON composio_triggers(tenant_id, account_id);
-- composio_webhook_seen: webhook-id of every signed webhook accepted in the last day, so a replay (same id) is refused. Pruned as it goes.
CREATE TABLE IF NOT EXISTS composio_webhook_seen (id TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS composio_webhook_seen_at ON composio_webhook_seen(at);
