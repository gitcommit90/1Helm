-- Why the job's main model did not answer when a fallback served the call (additive). Written by src/ee/model-served.js, read by the Models console.
ALTER TABLE model_served ADD COLUMN last_error TEXT;
