-- A shared copy of each connected AI service's model list (src/ee/byok-custom.js endpointRecords), so the model picker shows models at once and a token refresh
-- or a call to the service is not needed to open it. Purely additive: one new table. Keyed by account and connection (never by key or token); sig names the address
-- the list came from, so a service whose address changed is read again. list_json holds only what the service's public list states (ids, names, levels, context).
CREATE TABLE IF NOT EXISTS byok_model_lists (
  tenant_id TEXT NOT NULL, conn_id TEXT NOT NULL, sig TEXT NOT NULL DEFAULT '', list_json TEXT NOT NULL DEFAULT '[]', fetched_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, conn_id));
