CREATE TABLE IF NOT EXISTS native_text_polls (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  session TEXT NOT NULL,
  source_turn TEXT NOT NULL,
  question_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  client_message_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'pending',
  poll_guid TEXT,
  body_json TEXT NOT NULL,
  options_json TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  UNIQUE(tenant_id,channel,source_turn),
  UNIQUE(tenant_id,poll_guid)
);
