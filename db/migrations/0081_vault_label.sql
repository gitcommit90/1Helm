-- Saved keys get a plain label ("App Store Connect"), an optional note (what the key is for) and a kind (text or file).
-- Purely additive. An existing key keeps its name; its label stays empty and the app shows the name instead.
-- The sites list may now be empty ("[]"): a key with no approved sites asks the person before it is used on a new site.
ALTER TABLE vault ADD COLUMN label TEXT;
ALTER TABLE vault ADD COLUMN note TEXT;
ALTER TABLE vault ADD COLUMN kind TEXT;
