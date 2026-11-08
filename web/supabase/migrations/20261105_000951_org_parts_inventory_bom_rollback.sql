-- =====================================================================
-- PRICE READS REOPEN
-- This rollback grants anon and authenticated SELECT on
-- parts_catalog.sale_price and on part_vendors.unit_cost and currency.
-- Shared catalog clients can see those legacy prices again.
-- It still does not grant price writes, table-level UPDATE, or UPDATE on
-- created_by. It does restore part_vendors DELETE for authenticated so an
-- authorized vendor row can be removed under the existing RLS policy.
-- =====================================================================
-- Rollback for 20261105_000951_org_parts_inventory_bom.sql
-- Removes the new tables and the Mini GentleYAG seed rows this migration inserted.
-- Does not drop legacy parts_catalog.sale_price or part_vendors.unit_cost.

BEGIN;

DROP TABLE IF EXISTS public.manual_bom_sweep;
DROP TABLE IF EXISTS public.manual_nine_source;
DROP FUNCTION IF EXISTS public.manual_bom_sweep_hold();
DROP FUNCTION IF EXISTS public.manual_nine_source_guard();
DROP TABLE IF EXISTS public.device_bom;
DROP TABLE IF EXISTS public.organization_parts;
DROP TABLE IF EXISTS public.part_catalog_availability;
DROP FUNCTION IF EXISTS public.part_catalog_availability_set_pn();

DROP TRIGGER IF EXISTS parts_catalog_set_mpn ON public.parts_catalog;
DROP FUNCTION IF EXISTS public.parts_catalog_set_mpn();

DELETE FROM public.parts_catalog
 WHERE specs->>'seed' = '000951-vpyag';

ALTER TABLE public.parts_catalog DROP COLUMN IF EXISTS specs;
ALTER TABLE public.parts_catalog DROP COLUMN IF EXISTS mpn_normalized;
DROP INDEX IF EXISTS public.parts_catalog_brand_mpn_uidx;
DROP INDEX IF EXISTS public.parts_catalog_brand_mpn_idx;

DROP FUNCTION IF EXISTS public.normalize_mpn(text);

REVOKE ALL ON TABLE public.parts_catalog FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.part_vendors FROM PUBLIC, anon, authenticated;
DO $$
DECLARE
  r record;
  v_cols text;
BEGIN
  FOR r IN
    SELECT a.attname FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.parts_catalog'::regclass AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXECUTE format('REVOKE ALL (%I) ON TABLE public.parts_catalog FROM PUBLIC, anon, authenticated', r.attname);
  END LOOP;
  FOR r IN
    SELECT a.attname FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.part_vendors'::regclass AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXECUTE format('REVOKE ALL (%I) ON TABLE public.part_vendors FROM PUBLIC, anon, authenticated', r.attname);
  END LOOP;

  RAISE WARNING '000951 ROLLBACK REOPENS PRICE READS: anon and authenticated regain SELECT on parts_catalog.sale_price and part_vendors.unit_cost and currency';

  -- Deliberate: SELECT includes sale_price / unit_cost / currency again.
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.parts_catalog'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.parts_catalog TO anon, authenticated', v_cols);
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.parts_catalog'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname <> 'sale_price';
  EXECUTE format('GRANT INSERT (%s) ON TABLE public.parts_catalog TO authenticated', v_cols);
  GRANT UPDATE (is_active) ON TABLE public.parts_catalog TO authenticated;

  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.part_vendors'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.part_vendors TO anon, authenticated', v_cols);
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.part_vendors'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname <> ALL (ARRAY['id', 'unit_cost', 'currency']);
  EXECUTE format('GRANT INSERT (%s) ON TABLE public.part_vendors TO authenticated', v_cols);
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.part_vendors'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname <> ALL (ARRAY['id', 'part_id', 'created_by', 'unit_cost', 'currency']);
  EXECUTE format('GRANT UPDATE (%s) ON TABLE public.part_vendors TO authenticated', v_cols);
  GRANT DELETE ON TABLE public.part_vendors TO authenticated;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
