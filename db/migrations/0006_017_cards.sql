-- 10-05 Cards in chat by text: a card reply to a text goes out as an iMessage live app card that opens /c/<token> (no login).
-- One row per card sent. token = HMAC(key from VAULT_KEY, tenant + channel + message id): unguessable, carries no data itself.
CREATE TABLE IF NOT EXISTS cards (
  token TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  channel TEXT NOT NULL,                 -- the resident that answered (texts run in General: "main")
  msg_id TEXT NOT NULL,                  -- the turn id of the reply
  body TEXT NOT NULL,                    -- the card reply (OpenUI Lang), exactly as the helper wrote it
  say TEXT,                              -- its first Say text (page description, card caption)
  sent_at INTEGER NOT NULL,
  answered INTEGER NOT NULL DEFAULT 0,
  picked TEXT,                           -- the tap text sent back, verbatim (same format as the app: "Book it\nslot: Tuesday")
  answered_at INTEGER,
  acts INTEGER NOT NULL DEFAULT 0,       -- act attempts (rate limit)
  last_act_at INTEGER
);
CREATE INDEX IF NOT EXISTS cards_tenant ON cards(tenant_id, sent_at);
