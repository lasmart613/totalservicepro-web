-- Rollback for 000943. Exact: restores the three dropped policies (same names,
-- PERMISSIVE, TO authenticated, same expressions), re-grants INSERT, UPDATE to
-- authenticated (anon had neither before 000943), and resets the table comment
-- (none before). Re-runnable. Note: this re-opens the client-write hole.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.user_manuals') IS NULL THEN
    RAISE EXCEPTION '000943 rollback: public.user_manuals is missing';
  END IF;
END $$;

DROP POLICY IF EXISTS user_manuals_insert_own ON public.user_manuals;
CREATE POLICY user_manuals_insert_own ON public.user_manuals
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own library" ON public.user_manuals;
CREATE POLICY "Users manage own library" ON public.user_manuals
  AS PERMISSIVE FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage their own library" ON public.user_manuals;
CREATE POLICY "Users can manage their own library" ON public.user_manuals
  AS PERMISSIVE FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

GRANT INSERT, UPDATE ON TABLE public.user_manuals TO authenticated;

COMMENT ON TABLE public.user_manuals IS NULL;

COMMIT;
