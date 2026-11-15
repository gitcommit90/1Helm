-- 10-07 Ambient → Bee, §10 step 3 (src/bee-sync.js). Purely additive: three new columns on bee_accounts, the card's sync line
-- mirrored from the person's BeeSync DO after every run (so GET /api/bee and a look-only view read it without waking the DO).
--   synced_at: the last successful sync (ms) · conv_count: conversations synced into memory · sync_note: why syncing is paused, in plain words.
ALTER TABLE bee_accounts ADD COLUMN synced_at INTEGER;
ALTER TABLE bee_accounts ADD COLUMN conv_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bee_accounts ADD COLUMN sync_note TEXT;
