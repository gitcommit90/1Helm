-- What actually served each /models job (additive). One row per environment and job; upserted by src/ee/model-served.js.
CREATE TABLE IF NOT EXISTS model_served (
  environment TEXT NOT NULL,
  job_id TEXT NOT NULL,
  requested TEXT,
  served_model TEXT,
  served_provider TEXT,
  last_at INTEGER NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  last_status TEXT,
  last_error_at INTEGER,
  PRIMARY KEY (environment, job_id)
);
