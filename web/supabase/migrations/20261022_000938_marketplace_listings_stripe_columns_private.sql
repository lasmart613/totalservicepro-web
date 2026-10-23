-- 000938: keep Stripe ids on marketplace_listings server-only (CEO security LOW).
--
-- Finding: "stripe_product_id and stripe_price_id are client-readable on
-- marketplace_listings".
--
-- Live state (SELECT-only check, 2026-10-22):
--   * information_schema.columns: marketplace_listings has NO column whose
--     name contains "stripe". The Stripe ids live inside details
--     (details.stripe_product_id / stripe_price_id / stripe_price_cents; 10 rows).
--   * Since 000935, details is not SELECTable by anon or authenticated
--     (column privileges), and details_public strips every key containing
--     "stripe": 0 rows of details_public contain "stripe".
--   So on live this migration changes nothing (no-op), and is a guard: if a
--   stripe* column is ever added (or exists on another environment), it is
--   made server-only exactly like serial_number / notes / details in 000935.
--
-- What it does:
--   1. Drift guards: 000935 must be applied (details_public generated column,
--      no anon/authenticated SELECT on details, no table-level SELECT for
--      anon/authenticated) and details_public must contain no "stripe" text.
--   2. For every column of public.marketplace_listings whose name contains
--      "stripe" (case-insensitive): REVOKE SELECT (col) FROM PUBLIC, anon,
--      authenticated; GRANT SELECT (col) TO service_role (explicit). The roles
--      that had SELECT before are recorded in the column comment
--      ('000938:<roles>') so the rollback restores them exactly.
--      INSERT/UPDATE grants are untouched (sellers' writes go through server routes).
--
-- APPLY ON LIVE SUPABASE only after Larry's yes. Rollback:
-- 20261022_000938_marketplace_listings_stripe_columns_private_rollback.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_col record;
  v_roles text;
  v_n int;
BEGIN
  IF to_regclass('public.marketplace_listings') IS NULL THEN
    RAISE EXCEPTION '000938 drift: public.marketplace_listings is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.marketplace_listings'::regclass AND a.attname = 'details_public'
      AND NOT a.attisdropped AND a.attgenerated = 's'
      AND coalesce(pg_catalog.col_description(a.attrelid, a.attnum), '') LIKE '000935:%'
  ) THEN
    RAISE EXCEPTION '000938 drift: 000935 is not applied (details_public generated column missing)';
  END IF;
  IF pg_catalog.has_table_privilege('anon', 'public.marketplace_listings', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.marketplace_listings', 'SELECT') THEN
    RAISE EXCEPTION '000938 drift: anon/authenticated have table-level SELECT on marketplace_listings (000935 state lost)';
  END IF;
  IF pg_catalog.has_column_privilege('anon', 'public.marketplace_listings', 'details', 'SELECT')
     OR pg_catalog.has_column_privilege('authenticated', 'public.marketplace_listings', 'details', 'SELECT') THEN
    RAISE EXCEPTION '000938 drift: details is SELECTable by anon/authenticated (000935 state lost)';
  END IF;
  SELECT count(*) INTO v_n FROM public.marketplace_listings
  WHERE pg_catalog.strpos(pg_catalog.lower(details_public::text), 'stripe') > 0;
  IF v_n > 0 THEN
    RAISE EXCEPTION '000938 drift: % row(s) of details_public contain "stripe"', v_n;
  END IF;

  v_n := 0;
  FOR v_col IN
    SELECT a.attname, a.attnum, pg_catalog.col_description(a.attrelid, a.attnum) AS cmt
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.marketplace_listings'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND pg_catalog.strpos(pg_catalog.lower(a.attname), 'stripe') > 0
    ORDER BY a.attnum
  LOOP
    IF v_col.cmt IS NOT NULL AND v_col.cmt NOT LIKE '000938:%' THEN
      RAISE EXCEPTION '000938 drift: marketplace_listings.% already has a comment (rollback could not restore it)', v_col.attname;
    END IF;
    IF v_col.cmt LIKE '000938:%' THEN
      CONTINUE; -- already applied (idempotent)
    END IF;
    SELECT coalesce(string_agg(r, ',' ORDER BY r), '') INTO v_roles
    FROM unnest(ARRAY['anon', 'authenticated']) AS r
    WHERE pg_catalog.has_column_privilege(r, 'public.marketplace_listings', v_col.attname, 'SELECT');
    EXECUTE pg_catalog.format('REVOKE SELECT (%I) ON public.marketplace_listings FROM PUBLIC, anon, authenticated', v_col.attname);
    EXECUTE pg_catalog.format('GRANT SELECT (%I) ON public.marketplace_listings TO service_role', v_col.attname);
    EXECUTE pg_catalog.format('COMMENT ON COLUMN public.marketplace_listings.%I IS %L', v_col.attname, '000938:' || v_roles);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE '000938: % stripe* column(s) made server-only', v_n;
END $$;

COMMIT;
