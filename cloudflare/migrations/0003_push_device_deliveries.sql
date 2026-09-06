CREATE TABLE IF NOT EXISTS push_device_deliveries (
  installation_id TEXT NOT NULL REFERENCES push_installations(installation_id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  device_id INTEGER NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
  delivered_at INTEGER NOT NULL,
  PRIMARY KEY (installation_id,idempotency_key,device_id)
);
