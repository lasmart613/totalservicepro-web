-- Optional data repair. Not a migration and not applied by the app.
-- CEO decides. Do not run unless the find query shows no collisions.
-- Read-only check on 2026-10-09: no two profiles and no two login accounts
-- share an email case-insensitively. This lowercases profile emails only.
-- Login accounts stay as they are. GoTrue owns those addresses.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE coalesce(btrim(email), '') <> ''
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'case-insensitive user_profiles.email collision; not updating';
  END IF;
END $$;

UPDATE public.user_profiles
SET email = lower(btrim(email))
WHERE email IS NOT NULL
  AND btrim(email) <> ''
  AND email IS DISTINCT FROM lower(btrim(email));
