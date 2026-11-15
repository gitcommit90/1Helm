-- The plan an OpenCode connection uses: 'go' (the person's OpenCode Go plan) or 'payg' (pay as you go from their OpenCode balance). Purely additive: one new column.
-- Every connection already saved, including the OpenCode ones, becomes 'go'.
ALTER TABLE byok_connections ADD COLUMN oc_plan TEXT NOT NULL DEFAULT 'go';
