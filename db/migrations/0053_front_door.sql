-- Memory Overhaul phase 4B (flag HS_WALLS): purely additive. front_door is General's optional front door (DESIGN.md 6.4).
-- 0 (default) = General asks with the "Inspect other channels?" card before it reads another channel. 1 = General reads other channels without asking.
-- Apply to dev before the deploy: ALTER TABLE has no IF NOT EXISTS, so run it once. Until it is applied, the code treats a missing column as 0 (ask first).
ALTER TABLE tenants ADD COLUMN front_door INTEGER NOT NULL DEFAULT 0;
