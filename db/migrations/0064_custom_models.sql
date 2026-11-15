-- Custom Model Selection (src/custom-models.js): a per-account setting, off by default, that replaces the chat categories for that account only.
-- Purely additive: two new columns on tenants, the same scope as ai_privacy.
--   custom_models_on: 1 = this account's chat uses its own categories (custom_models), 0 = our saved chat categories (every existing account)
--   custom_models:    the account's own categories as JSON (one chain of three models per category, the facts of each model, max price); kept when the setting is turned off
ALTER TABLE tenants ADD COLUMN custom_models_on INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN custom_models TEXT;
