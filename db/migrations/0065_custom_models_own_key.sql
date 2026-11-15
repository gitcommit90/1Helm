-- Custom Model Selection on an own AI key (src/byok-custom.js). An account whose chat is answered by its own key keeps a setting apart from the one for 1Helm's models,
-- because its models are the ones its own endpoint serves:
--   custom_models_own_on: 1 = chat on the own key uses these categories (custom_models_own), 0 = the one main model of the own AI key settings (every existing account)
--   custom_models_own:    the categories as JSON (one to three models per category, the facts of each model, max price on OpenRouter); kept when the setting is turned off
ALTER TABLE tenants ADD COLUMN custom_models_own_on INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN custom_models_own TEXT;
