-- Rollback for 000935. Restores the pre-000935 state exactly:
--   table-level SELECT + MAINTAIN for anon and authenticated (no column-level
--   SELECT grants), the original "Sellers select own listings" policy, and drops
--   details_public, marketplace_listing_private and marketplace_public_details.
-- No data changes (details_public is generated from details).
-- App code from the 000935 PR keeps working after rollback: withListingColumns()
-- sees "details_public does not exist" and retries with the legacy column list,
-- and marketplace_listing_private callers fall back to no private fields.
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('marketplace_public_details', 'marketplace_listing_private')
      AND coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), '') NOT LIKE '000935:%'
  ) THEN
    RAISE EXCEPTION '000935 rollback refused: a marketplace_public_details / marketplace_listing_private was not created by 000935';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.marketplace_listings'::regclass AND a.attname = 'details_public' AND NOT a.attisdropped
      AND coalesce(pg_catalog.col_description(a.attrelid, a.attnum), '') NOT LIKE '000935:%'
  ) THEN
    RAISE EXCEPTION '000935 rollback refused: marketplace_listings.details_public was not created by 000935';
  END IF;
END $$;

DROP POLICY IF EXISTS "Sellers select own listings" ON public.marketplace_listings;
CREATE POLICY "Sellers select own listings" ON public.marketplace_listings
  FOR SELECT TO authenticated
  USING (
    status = ANY (ARRAY['active'::text, 'open'::text, 'published'::text, 'sold'::text, 'draft'::text])
    OR seller_id = auth.uid()
    OR created_by = auth.uid()
  );

DROP FUNCTION IF EXISTS public.marketplace_listing_private(uuid);

ALTER TABLE public.marketplace_listings DROP COLUMN IF EXISTS details_public;
DROP FUNCTION IF EXISTS public.marketplace_public_details(jsonb, int);

-- Drop every column-level SELECT grant, then the table-level grants as before.
DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.marketplace_listings'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attacl::text ~ '(anon|authenticated)=[a-zA-Z]*r';
  IF v_cols IS NOT NULL THEN
    EXECUTE pg_catalog.format('REVOKE SELECT (%s) ON public.marketplace_listings FROM anon, authenticated', v_cols);
  END IF;
END $$;
GRANT SELECT, MAINTAIN ON public.marketplace_listings TO anon, authenticated;

COMMIT;
