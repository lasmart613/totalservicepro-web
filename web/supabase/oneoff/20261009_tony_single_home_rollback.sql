-- Puts membership 17 back to is_home true. Same id / user / org guards.
-- Does not change roles, profiles, or org 2528.
--
-- Run web/supabase/migrations/20261009_000904_one_home_membership_rollback.sql
-- FIRST, then this file. With the 000904 trigger and partial unique index
-- still installed, this update does not fail and does not leave two homes.
-- The BEFORE trigger sees is_home = true, clears membership 13 (org 4), and
-- membership 17 becomes the only home. Drop the trigger and the index before
-- restoring the second home.

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  n integer;
BEGIN
  UPDATE public.organization_memberships
  SET is_home = true,
      updated_at = now()
  WHERE id = 17
    AND user_id = '3841fd9c-4931-4993-91f7-a7b785e4341e'
    AND organization_id = 2528
    AND is_home IS NOT TRUE;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected to restore exactly one home row (membership 17), changed %', n;
  END IF;
END $$;
