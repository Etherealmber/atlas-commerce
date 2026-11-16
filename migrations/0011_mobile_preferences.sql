-- Private preferences: one row per active app_users identity or the environment owner.
CREATE TABLE IF NOT EXISTS mobile_preferences_v1 (
  user_id INTEGER UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
  owner_username TEXT UNIQUE CHECK (owner_username IS NULL OR length(owner_username) > 0),
  settings_json TEXT NOT NULL DEFAULT '{}',
  sync_frequency TEXT NOT NULL DEFAULT 'daily' CHECK (sync_frequency IN ('daily','weekly','monthly','yearly')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision >= 0),
  updated_at TEXT,
  last_synced_at TEXT,
  CHECK ((user_id IS NOT NULL AND owner_username IS NULL) OR
         (user_id IS NULL AND owner_username IS NOT NULL))
);
