-- 10-05 Get to know you (src/interview.js): one row per person once the task has been offered. status: creating | open | removed.
-- step = the question they're on (= total when finished); answers = {question id: {pick|picks, text, rows:[{id,sec,text}], skipped}}.
-- known = what onboarding/the network already knew (first name, tone, city, time zone). Purely additive.
CREATE TABLE IF NOT EXISTS interviews (tenant_id TEXT PRIMARY KEY, session_id TEXT, status TEXT NOT NULL DEFAULT 'open', step INTEGER NOT NULL DEFAULT 0, answers TEXT NOT NULL DEFAULT '{}', known TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finished_at INTEGER);
