-- Logo route (src/logo.js), proxy mode only: upstream logo.dev fetches per month ("cdn:2026-10" → n), the hard cap's counter.
CREATE TABLE IF NOT EXISTS logo_usage (k TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0);
