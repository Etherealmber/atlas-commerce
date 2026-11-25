-- Profile details edited in « Modifier le profil » (Settings → Mon profil):
-- time zone, working hours, job title and last update. One row per login,
-- including the owner (who has no app_users row). Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS user_profile_prefs (
  username      TEXT PRIMARY KEY,
  timezone      TEXT NOT NULL DEFAULT 'Africa/Casablanca',
  working_hours TEXT NOT NULL DEFAULT '',
  job_title     TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
