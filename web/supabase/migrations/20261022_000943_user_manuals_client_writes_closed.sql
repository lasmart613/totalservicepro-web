-- 000943: close direct client writes to public.user_manuals.
--
-- Hole (QA on PR #343, confirmed read-only on prod 2026-10-22): authenticated
-- users could INSERT, or UPDATE to, any manual_id under their own user_id
-- (policies user_manuals_insert_own, "Users manage own library",
-- "Users can manage their own library"; table grants INSERT/UPDATE). No slot
-- cap applies there, and get-manual-url / the web library treat user_manuals
-- rows as owned, so one REST insert opened any published manual for free.
--
-- Fix:
--   * drop user_manuals_insert_own and both duplicate ALL policies;
--   * keep user_manuals_select_own and user_manuals_delete_own;
--   * REVOKE INSERT, UPDATE from authenticated and anon.
-- Writes now go only through the service role (POST /api/manuals/library,
-- get-manual-url action:'add', /api/god tables), which enforce the cap.
-- The Android manual_library.html add uses get-manual-url action:'add' (same PR).
-- service_role / postgres grants are unchanged. Existing rows are untouched.
--
-- Bookkeeping (on apply): INSERT INTO supabase_migrations.schema_migrations
--   (version, name) VALUES ('<UTC yyyymmddhhmmss at apply>',
--   '20261022_000943_user_manuals_client_writes_closed');
-- Wrapped in BEGIN/COMMIT. Idempotent. Rollback: *_rollback.sql (exact prior state).

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_extra text;
BEGIN
  IF to_regclass('public.user_manuals') IS NULL THEN
    RAISE EXCEPTION '000943 drift: public.user_manuals is missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_manuals'::regclass) THEN
    RAISE EXCEPTION '000943 drift: RLS is not enabled on public.user_manuals';
  END IF;
  -- The two policies we keep must exist with the expected shape.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_manuals'
                 AND policyname = 'user_manuals_select_own' AND cmd = 'SELECT'
                 AND roles = '{authenticated}' AND permissive = 'PERMISSIVE'
                 AND qual = '(auth.uid() = user_id)') THEN
    RAISE EXCEPTION '000943 drift: user_manuals_select_own missing or changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_manuals'
                 AND policyname = 'user_manuals_delete_own' AND cmd = 'DELETE'
                 AND roles = '{authenticated}' AND permissive = 'PERMISSIVE'
                 AND qual = '(auth.uid() = user_id)') THEN
    RAISE EXCEPTION '000943 drift: user_manuals_delete_own missing or changed';
  END IF;
  -- No policies other than the five known ones (re-run: only the two kept).
  SELECT string_agg(policyname, ', ') INTO v_extra FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'user_manuals'
    AND policyname NOT IN ('user_manuals_select_own', 'user_manuals_delete_own',
                           'user_manuals_insert_own', 'Users manage own library',
                           'Users can manage their own library');
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION '000943 drift: unexpected user_manuals policies: %', v_extra;
  END IF;
END $$;

DROP POLICY IF EXISTS user_manuals_insert_own ON public.user_manuals;
DROP POLICY IF EXISTS "Users manage own library" ON public.user_manuals;
DROP POLICY IF EXISTS "Users can manage their own library" ON public.user_manuals;

REVOKE INSERT, UPDATE ON TABLE public.user_manuals FROM authenticated, anon;

COMMENT ON TABLE public.user_manuals IS '000943 personal manual library: clients SELECT/DELETE own rows only; writes via service role (cap enforced)';

COMMIT;
