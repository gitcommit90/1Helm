-- Router lab (dev only, ROUTER_LAB="on" in wrangler.dev.jsonc; src/router-lab.js): the classic router's decision on a user-edited
-- pool, asked of Jev, Perplexity and Clef on the same input, next to the two-model rule and fixed baselines. Purely additive. Never prod.
-- Catalog snapshots (explicit refresh; last 3 kept): every text model with its ZDR hosts, prices, efforts, AA score or unrated, and why excluded.
CREATE TABLE IF NOT EXISTS router_lab_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  by TEXT,
  ok INTEGER NOT NULL DEFAULT 1,       -- 0: the refresh failed (sources.error), the previous good snapshot stays in use
  models TEXT NOT NULL,                -- JSON array
  sources TEXT                         -- JSON: source times, per-source errors, counts
);
-- Named pools; exactly one active. Every save is a new version (router_lab_pool_versions keeps each config).
CREATE TABLE IF NOT EXISTS router_lab_pools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL,                -- JSON: models [{id, efforts, hosts}], exclude_hosts, max_in, max_out, baselines
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
CREATE TABLE IF NOT EXISTS router_lab_pool_versions (
  pool_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  at INTEGER NOT NULL,
  by TEXT,
  name TEXT,
  config TEXT NOT NULL,
  PRIMARY KEY (pool_id, version)
);
-- One row per main-chat message: a short redacted preview, the pool version used, each decider's result, the baselines. 7 days.
CREATE TABLE IF NOT EXISTS router_lab_runs (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  done_at INTEGER,
  status TEXT NOT NULL,                -- pending | done | partial | error | skipped
  error TEXT,
  tenant_id TEXT,
  channel TEXT,
  session TEXT,
  preview TEXT,                        -- ≤ 160 chars, secrets scrubbed
  msg_key TEXT,                        -- one comparison per message
  pool_id TEXT,
  pool_version INTEGER,
  pool_name TEXT,
  catalog_at INTEGER,
  in_tok_est INTEGER,                  -- chars / 3 of the real first call's prompt, before it ran
  in_tok_actual INTEGER,               -- that call's reported input tokens, after the turn
  img INTEGER,
  actual TEXT,                         -- JSON: the route the turn really used
  ctx TEXT,                            -- JSON: shared context summary + rejected pairs
  jev TEXT, pplx TEXT, clef TEXT,      -- JSON: each decider's answers summary, pick, fallbacks, reason, candidates, cost of the call
  baselines TEXT,                      -- JSON: the two-model rule + fixed baselines, estimated
  overhead_nano INTEGER                -- the three decider calls together (platform cost, never billed)
);
CREATE UNIQUE INDEX IF NOT EXISTS router_lab_runs_msg ON router_lab_runs(msg_key);
CREATE INDEX IF NOT EXISTS router_lab_runs_at ON router_lab_runs(at);
CREATE INDEX IF NOT EXISTS router_lab_runs_tenant ON router_lab_runs(tenant_id, channel, session);
-- Each decider's own incumbent (what it would be running), per tenant/channel/session. Never the serving route.
CREATE TABLE IF NOT EXISTS router_lab_incumbents (
  tenant_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  session TEXT NOT NULL,
  judge TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, channel, session, judge)
);
