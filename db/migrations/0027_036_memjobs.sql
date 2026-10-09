-- Background memory jobs (src/memjobs.js, Muse overhaul Stage 3). Additive: two new tables. The code also creates them on first
-- use (CREATE TABLE IF NOT EXISTS), so this file only makes them explicit.
-- memjob_runs: one row per run (upkeep / people / reflect): what it read, what changed (with the person's quoted words), the models,
-- the cost charged (nano$, cost + 15%), and why it was skipped or found nothing. Read by GET /_ops/memjobs (dev).
CREATE TABLE IF NOT EXISTS memjob_runs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, channel TEXT NOT NULL, job TEXT NOT NULL, trigger TEXT NOT NULL, started_at INTEGER NOT NULL, ms INTEGER, status TEXT NOT NULL, why TEXT, window_from INTEGER, window_to INTEGER, turns INTEGER NOT NULL DEFAULT 0, proposed INTEGER NOT NULL DEFAULT 0, verified INTEGER NOT NULL DEFAULT 0, applied INTEGER NOT NULL DEFAULT 0, changes TEXT NOT NULL DEFAULT '[]', steps TEXT NOT NULL DEFAULT '[]', models TEXT, cost_nano INTEGER NOT NULL DEFAULT 0, error TEXT);
CREATE INDEX IF NOT EXISTS memjob_runs_t ON memjob_runs(tenant_id, started_at);
-- memjob_state: per channel, when it last had activity and when each job last ran (the hourly cron picks what's due from here).
CREATE TABLE IF NOT EXISTS memjob_state (tenant_id TEXT NOT NULL, channel TEXT NOT NULL, last_activity INTEGER NOT NULL DEFAULT 0, upkeep_at INTEGER NOT NULL DEFAULT 0, people_at INTEGER NOT NULL DEFAULT 0, reflect_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tenant_id, channel));
