-- Destructive rollback: permanently removes all synchronized Snake scores.
DROP TABLE IF EXISTS snake_personal_best;
-- Permit Wrangler to reapply 0009 if subsequently desired.
DELETE FROM d1_migrations WHERE name = '0009_snake_personal_best.sql';
