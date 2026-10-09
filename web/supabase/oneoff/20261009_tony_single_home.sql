-- One-off data repair. Not a migration and not applied by the app.
-- Clears the extra home on Galactic Empire for the only user with two
-- is_home rows. Luxor (membership 13, org 4) stays home, matching the
-- profile organization pointer. Does not change roles, profile rows, or org 2528.
-- Run this before 20261009_000904_one_home_membership.sql. The partial unique
-- index will not build while membership 17 is still home.

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  n integer;
BEGIN
  UPDATE public.organization_memberships
  SET is_home = false,
      updated_at = now()
  WHERE id = 17
    AND user_id = '3841fd9c-4931-4993-91f7-a7b785e4341e'
    AND organization_id = 2528
    AND is_home IS TRUE;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected to clear exactly one home row (membership 17), changed %', n;
  END IF;
END $$;
