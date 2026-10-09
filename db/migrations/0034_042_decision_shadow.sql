-- Decision shadow (dev only, DECISION_SHADOW="on" in wrangler.dev.jsonc; src/decision-shadow.js): every real Jev decision next to
-- what perplexity/pplx-decider-v1.1-27b answers for the exact same state and questions. Purely additive. Never applied to prod.
-- Dev test override (TEST_MODEL, e.g. TEST_MODEL_SCOPE=all-dev): the test model decides; Jev and Perplexity both run as probes on the
-- exact state Jev would have had (mode both_shadow). One row per Jev call: written "pending" when both calls start, then "done" / "shadow_error" / "jev_error" / "both_error".
-- Only a short redacted preview of the input is kept (never the whole state or page). Rows older than 7 days are deleted hourly.
CREATE TABLE IF NOT EXISTS decision_shadow (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  done_at INTEGER,
  kind TEXT NOT NULL,              -- route | browser_action | browser_done
  mode TEXT NOT NULL DEFAULT 'jev_live',  -- jev_live: Jev decided for real | both_shadow: the dev test model decided, Jev + Perplexity only probed
  status TEXT NOT NULL,            -- pending | done | shadow_error | jev_error | both_error
  tenant_id TEXT,
  channel TEXT,
  session TEXT,
  preview TEXT,                    -- ≤ 160 chars, secrets scrubbed
  shadow_model TEXT,
  actual TEXT,                     -- JSON: what really decided (both_shadow: the test model's model + decision)
  jev TEXT,                        -- JSON: Jev's answer and what it decided (route / choice / done)
  shadow TEXT,                     -- JSON: the shadow's answer and what the same rule would have decided
  agree INTEGER,                   -- 1 same decision, 0 different, NULL when either side failed
  label_agree INTEGER,             -- route: same label (conversation / task / unsure / hard); browser: same as agree
  jev_ms INTEGER,
  shadow_ms INTEGER,
  jev_nano INTEGER,
  shadow_nano INTEGER,
  jev_cost_src TEXT,               -- reported (usage.cost) | estimated (tokens × list price)
  shadow_cost_src TEXT
);
CREATE INDEX IF NOT EXISTS decision_shadow_at ON decision_shadow(at);
CREATE INDEX IF NOT EXISTS decision_shadow_kind_at ON decision_shadow(kind, at);
CREATE INDEX IF NOT EXISTS decision_shadow_status_at ON decision_shadow(status, at);
CREATE INDEX IF NOT EXISTS decision_shadow_tenant ON decision_shadow(tenant_id, channel, session);
