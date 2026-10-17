-- Removes the memory_shadow table of the deleted memory use shadow (arm B2 is the default, and the shadow is not kept). Only a development
-- deployment ever wrote it, so a self-hosted deployment is not affected.
DROP TABLE IF EXISTS memory_shadow;
