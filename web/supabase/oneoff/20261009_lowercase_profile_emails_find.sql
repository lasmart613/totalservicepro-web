-- Read-only. Not a migration and not applied by the app.
-- Pre-image for 20261009_lowercase_profile_emails.sql.
-- Live read on 2026-10-09 (project yljztfajyvjzqikxdddf): 66 user_profiles,
-- 3 stored with mixed-case email, 0 case-insensitive collisions in
-- user_profiles and 0 in auth.users (76 auth users, all already lowercase).
-- Capture this result before lowercasing profile emails. It is the rollback source.
-- Do not change rows from this file.

SELECT
  p.id,
  p.email
FROM public.user_profiles AS p
WHERE p.email IS NOT NULL
  AND btrim(p.email) <> ''
  AND p.email IS DISTINCT FROM lower(btrim(p.email))
ORDER BY p.id;

-- Collision check. Expect zero rows. The repair script aborts if this returns any.
SELECT
  lower(btrim(p.email)) AS email_key,
  count(*)::int AS n
FROM public.user_profiles AS p
WHERE coalesce(btrim(p.email), '') <> ''
GROUP BY lower(btrim(p.email))
HAVING count(*) > 1;
