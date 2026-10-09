-- Used only when ONEHELM_EE is disabled. The first completed sign-in claims it.
CREATE TABLE IF NOT EXISTS single_owner (id INTEGER PRIMARY KEY CHECK (id=1), user_id TEXT NOT NULL UNIQUE);
