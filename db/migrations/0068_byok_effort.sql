-- Reasoning level of the main model and of the fast model on an own AI key (Settings, Use my own AI key). Empty = the service's own default, nothing is sent.
ALTER TABLE byok ADD COLUMN effort TEXT NOT NULL DEFAULT '';
ALTER TABLE byok ADD COLUMN fast_effort TEXT NOT NULL DEFAULT '';
