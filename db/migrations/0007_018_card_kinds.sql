-- 10-05 Permission requests by iMessage: the cards table also holds Sentinel approval cards (kind 'approval' + the approval id).
-- Purely additive: existing rows are card replies (kind 'card').
ALTER TABLE cards ADD COLUMN kind TEXT NOT NULL DEFAULT 'card';
ALTER TABLE cards ADD COLUMN approval_id INTEGER;
ALTER TABLE cards ADD COLUMN channel_name TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS cards_approval ON cards(tenant_id, channel, approval_id) WHERE kind='approval';
