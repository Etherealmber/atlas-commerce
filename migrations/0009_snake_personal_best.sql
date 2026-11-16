-- One private score per app_users account, plus one slot for the environment owner.
-- app_users is created by the existing security-schema initializer.
CREATE TABLE IF NOT EXISTS snake_personal_best (
  user_id INTEGER UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
  owner_slot INTEGER UNIQUE CHECK (owner_slot IS NULL OR owner_slot = 1),
  personal_best INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(personal_best) = 'integer' AND personal_best BETWEEN 0 AND 2147483647),
  CHECK ((user_id IS NOT NULL AND owner_slot IS NULL) OR
         (user_id IS NULL AND owner_slot IS NOT NULL AND owner_slot = 1))
);
