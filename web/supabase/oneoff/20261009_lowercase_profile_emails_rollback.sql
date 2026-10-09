-- Rollback for 20261009_lowercase_profile_emails.sql.
-- Not a migration and not applied by the app.
-- Restore only the pre-image captured by the find query before the update.
-- Paste those id/email pairs into the VALUES list. This file has no live addresses.

SET LOCAL lock_timeout = '5s';

-- UPDATE public.user_profiles AS p
-- SET email = v.email
-- FROM (VALUES
--   ('00000000-0000-0000-0000-000000000000'::uuid, 'Original@Example.com')
-- ) AS v(id, email)
-- WHERE p.id = v.id
--   AND lower(btrim(p.email)) = lower(btrim(v.email));
