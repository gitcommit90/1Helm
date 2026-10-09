-- AI data privacy (src/privacy.js, Captain 10-08): which AI providers may handle the person's requests. Purely additive: three new
-- columns. '' = never chosen: every server path resolves it to 'zdr' (the strictest), so existing accounts stay on zero-data-retention
-- providers until the owner explicitly picks something else in onboarding or Settings.
--   ai_privacy:         'unrestricted' | 'no_training' | 'zdr' | '' (unset → zdr)
--   ai_privacy_version: the consent copy version the person saw when choosing (privacy.js PRIVACY_CONSENT_VERSION)
--   ai_privacy_at:      when they chose (ms)
ALTER TABLE tenants ADD COLUMN ai_privacy TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN ai_privacy_version TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN ai_privacy_at INTEGER;
