-- Saved model settings, one version per change, per environment (dev and live have separate databases; the column keeps accidental mixing apart).
-- Each version holds, for every job the platform runs a model for, the model, its reasoning level and its fallback models.
-- Additive: the earlier table model_settings_versions is not changed. The Worker creates this table itself if it is missing (same statement),
-- so applying this file first is optional. Append-only; a conditional insert gives optimistic concurrency.
CREATE TABLE IF NOT EXISTS model_job_settings_versions (
  environment TEXT NOT NULL,
  revision INTEGER NOT NULL,
  config TEXT NOT NULL,
  at INTEGER NOT NULL,
  by TEXT NOT NULL,
  action TEXT NOT NULL,
  PRIMARY KEY (environment, revision)
);
