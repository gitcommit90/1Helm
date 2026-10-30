-- What 1Helm itself did with a Link purchase after Link approved it (additive only).
-- card_filled_at/card_filled_host: the one-time card was typed into a checkout form.
-- fill_failed_at/fill_failed_why: filling the card failed (why is a short plain sentence, never card data).
-- handoff_at: the checkout was handed to the person to finish.
ALTER TABLE link_purchases ADD COLUMN card_filled_at INTEGER;
ALTER TABLE link_purchases ADD COLUMN card_filled_host TEXT;
ALTER TABLE link_purchases ADD COLUMN fill_failed_at INTEGER;
ALTER TABLE link_purchases ADD COLUMN fill_failed_why TEXT;
ALTER TABLE link_purchases ADD COLUMN handoff_at INTEGER;
