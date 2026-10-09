-- Puts membership 17 back to is_home true. Same id / user / org guards.
-- Does not change roles, profiles, or org 2528.
-- Run this only while the one-home unique index is absent. With that index
-- in place and membership 13 still home, this update fails and changes nothing.
-- Drop the index (20261009_000904 rollback) before restoring the second home.

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
