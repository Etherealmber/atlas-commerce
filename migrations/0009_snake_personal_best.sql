-- One private score per app_users account, plus one slot for the environment owner.
-- Ensure app_users exists before referencing it.
CREATE TABLE IF NOT EXISTS app_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  password_salt TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  display_name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT DEFAULT 'admin',
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT
);

CREATE TABLE IF NOT EXISTS snake_personal_best (
  user_id INTEGER UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
  owner_slot INTEGER UNIQUE CHECK (owner_slot IS NULL OR owner_slot = 1),
  personal_best INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(personal_best) = 'integer' AND personal_best BETWEEN 0 AND 2147483647),
  CHECK ((user_id IS NOT NULL AND owner_slot IS NULL) OR
         (user_id IS NULL AND owner_slot IS NOT NULL AND owner_slot = 1))
);
