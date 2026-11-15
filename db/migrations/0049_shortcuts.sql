-- 10-10 Settings → Keyboard shortcuts: per-account custom key bindings (src/account.js POST /api/account/prefs {shortcuts}).
-- Purely additive: one nullable JSON column. NULL = every action keeps its default key.
ALTER TABLE tenants ADD COLUMN shortcuts TEXT;
