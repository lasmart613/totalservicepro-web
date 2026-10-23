-- Rollback for 000938: restore SELECT on stripe* columns to exactly the roles
-- recorded in their '000938:<roles>' comment, revoke the explicit
-- service_role column grant, and clear the comment. On live (no stripe*
-- columns) this is a no-op, like the apply.
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_col record;
  v_role text;
BEGIN
  IF to_regclass('public.marketplace_listings') IS NULL THEN
    RAISE EXCEPTION '000938 rollback drift: public.marketplace_listings is missing';
  END IF;
  FOR v_col IN
    SELECT a.attname, pg_catalog.col_description(a.attrelid, a.attnum) AS cmt
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.marketplace_listings'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND coalesce(pg_catalog.col_description(a.attrelid, a.attnum), '') LIKE '000938:%'
  LOOP
    EXECUTE pg_catalog.format('REVOKE SELECT (%I) ON public.marketplace_listings FROM service_role', v_col.attname);
    FOREACH v_role IN ARRAY pg_catalog.string_to_array(pg_catalog.substr(v_col.cmt, 8), ',') LOOP
      CONTINUE WHEN v_role = '';
      IF v_role NOT IN ('anon', 'authenticated') THEN
        RAISE EXCEPTION '000938 rollback drift: unexpected role % in comment of %', v_role, v_col.attname;
      END IF;
      EXECUTE pg_catalog.format('GRANT SELECT (%I) ON public.marketplace_listings TO %I', v_col.attname, v_role);
    END LOOP;
    EXECUTE pg_catalog.format('COMMENT ON COLUMN public.marketplace_listings.%I IS NULL', v_col.attname);
  END LOOP;
END $$;

COMMIT;
