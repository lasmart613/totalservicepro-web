-- 000935: marketplace_listings column lockdown (QA sec-1019, MEDIUM follow-up to #329).
--
-- CLIENT WRITES: after 000935 any client (anon/authenticated) INSERT or UPDATE
-- chained with .select() and NO column list (= RETURNING *) is refused with
-- 42501, because it returns the private columns. Always name the columns,
-- e.g. .select('id') or .select(LISTING_PUBLIC_SELECT).
--
-- Before (prod, read-only check 2026-10-19):
--   * anon had table-level SELECT (+ MAINTAIN) and authenticated had
--     SELECT/INSERT/UPDATE/DELETE (+ MAINTAIN) on public.marketplace_listings.
--     With RLS "Anyone can view active listings" that meant EVERY column of every
--     active row: serial_number, notes, and details.stripe_product_id /
--     stripe_price_id / stripe_price_cents (9 of 30 part rows).
--   * "Sellers select own listings" (authenticated) also let any signed-in user
--     read every draft listing.
--
-- After (column privileges in the style of 000932; no data changes):
--   * Private columns: serial_number, notes, details. anon and authenticated
--     keep SELECT on every other column (granted per column), so `select('*')`
--     from a client is refused and every client read names its columns.
--   * details_public: new STORED generated column =
--       public.marketplace_public_details(details)
--     which drops, recursively, any key containing "stripe" (case-insensitive)
--     and the seller contact keys (seller_email, seller_phone, contact_email,
--     contact_phone): the same rule as lib/share-listing-public.ts
--     sanitizeShareListingDetails. It is readable by anon and authenticated.
--     Why a generated column, and not a view or moving the keys:
--       - a view needs its own grants, security_invoker and RLS reasoning, and
--         every PostgREST client and embed would change table name;
--       - moving stripe_* out of details means a data migration plus changes to
--         the Stripe sync and checkout code, and any older writer would put the
--         keys back;
--       - a generated column stays correct on every INSERT/UPDATE from any
--         writer, keeps the same table, RLS and embeds, and the rollback is a
--         single DROP COLUMN. Clients read it as `details:details_public`.
--   * Seller-only private fields: public.marketplace_listing_private(uuid) ->
--     jsonb {serial_number, notes, details} | NULL. SECURITY DEFINER, empty
--     search_path. Returns data only to the listing's seller_id / created_by or
--     a member of its organization_id (is_active_org_member). EXECUTE:
--     authenticated, service_role. Server routes keep using the service role.
--   * "Sellers select own listings" (authenticated SELECT) is narrowed:
--       public statuses (active, open, published, sold) OR own rows (seller_id /
--       created_by) OR rows of an org the caller belongs to. Drafts and removed
--       rows of other orgs are no longer readable.
--   * MAINTAIN on marketplace_listings is revoked from anon and authenticated.
--     (The default ACL in schema public still grants MAINTAIN on new tables:
--     follow-up, see PR.)
--   * INSERT/UPDATE/DELETE grants and the other policies are untouched.
--
-- NOTE for future migrations: SELECT on marketplace_listings is now per column.
-- A new public column needs GRANT SELECT (col) ON public.marketplace_listings TO anon, authenticated.
--
-- APPLY ON LIVE SUPABASE only after Larry's yes. Rollback:
-- 20261019_000935_marketplace_listings_private_columns_rollback.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Drift guards
DO $$
DECLARE
  v_missing text;
  v_qual text;
BEGIN
  IF to_regclass('public.marketplace_listings') IS NULL THEN
    RAISE EXCEPTION '000935 drift: public.marketplace_listings is missing';
  END IF;
  SELECT string_agg(c, ', ') INTO v_missing
  FROM unnest(ARRAY['id', 'seller_id', 'created_by', 'organization_id', 'status', 'serial_number', 'notes', 'details']) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.marketplace_listings'::regclass AND attname = c AND attnum > 0 AND NOT attisdropped);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '000935 drift: marketplace_listings is missing column(s): %', v_missing;
  END IF;
  IF to_regprocedure('public.is_active_org_member(bigint)') IS NULL THEN
    RAISE EXCEPTION '000935 drift: public.is_active_org_member(bigint) is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('marketplace_public_details', 'marketplace_listing_private')
      AND coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), '') NOT LIKE '000935:%'
  ) THEN
    RAISE EXCEPTION '000935 drift: a marketplace_public_details / marketplace_listing_private not created by 000935 already exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.marketplace_listings'::regclass AND a.attname = 'details_public' AND NOT a.attisdropped
      AND coalesce(pg_catalog.col_description(a.attrelid, a.attnum), '') NOT LIKE '000935:%'
  ) THEN
    RAISE EXCEPTION '000935 drift: marketplace_listings.details_public exists and was not created by 000935';
  END IF;
  SELECT pg_catalog.pg_get_expr(p.polqual, p.polrelid) INTO v_qual
  FROM pg_catalog.pg_policy p
  WHERE p.polrelid = 'public.marketplace_listings'::regclass AND p.polname = 'Sellers select own listings';
  IF v_qual IS NULL THEN
    RAISE EXCEPTION '000935 drift: policy "Sellers select own listings" is missing';
  END IF;
  IF v_qual NOT LIKE '%''draft''::text%' AND v_qual NOT LIKE '%is_active_org_member%' THEN
    RAISE EXCEPTION '000935 drift: policy "Sellers select own listings" has an unexpected definition: %', v_qual;
  END IF;
END $$;

-- Pure sanitizer used by the generated column (same rule as sanitizeShareListingDetails).
CREATE OR REPLACE FUNCTION public.marketplace_public_details(p jsonb, p_depth int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_out jsonb;
  v_key text;
  v_val jsonb;
BEGIN
  IF p IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_depth > 20 THEN
    RETURN 'null'::jsonb;
  END IF;
  IF pg_catalog.jsonb_typeof(p) = 'array' THEN
    SELECT coalesce(pg_catalog.jsonb_agg(public.marketplace_public_details(e.value, p_depth + 1) ORDER BY e.ord), '[]'::jsonb)
      INTO v_out
      FROM pg_catalog.jsonb_array_elements(p) WITH ORDINALITY AS e(value, ord);
    RETURN v_out;
  END IF;
  IF pg_catalog.jsonb_typeof(p) <> 'object' THEN
    RETURN p;
  END IF;
  v_out := '{}'::jsonb;
  FOR v_key, v_val IN SELECT o.key, o.value FROM pg_catalog.jsonb_each(p) AS o LOOP
    CONTINUE WHEN pg_catalog.strpos(pg_catalog.lower(v_key), 'stripe') > 0
              OR pg_catalog.lower(v_key) IN ('seller_email', 'seller_phone', 'contact_email', 'contact_phone');
    v_out := v_out || pg_catalog.jsonb_build_object(v_key, public.marketplace_public_details(v_val, p_depth + 1));
  END LOOP;
  RETURN v_out;
END;
$$;
COMMENT ON FUNCTION public.marketplace_public_details(jsonb, int) IS
  '000935: listing details without stripe* keys and seller contact keys (recursive, depth 20). Feeds marketplace_listings.details_public.';
REVOKE ALL ON FUNCTION public.marketplace_public_details(jsonb, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketplace_public_details(jsonb, int) TO authenticated, service_role;

ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS details_public jsonb
  GENERATED ALWAYS AS (public.marketplace_public_details(details)) STORED;
COMMENT ON COLUMN public.marketplace_listings.details_public IS
  '000935: details without stripe*/seller contact keys (generated). Public clients read this instead of details.';

-- MAINTAIN (PG17) is not needed by anon/authenticated. The rollback restores it.
REVOKE MAINTAIN ON public.marketplace_listings FROM anon, authenticated;

-- Column privileges: table-level SELECT off, every non-private column back on.
REVOKE SELECT ON public.marketplace_listings FROM anon, authenticated;
DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.marketplace_listings'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attname <> ALL (ARRAY['serial_number', 'notes', 'details']);
  EXECUTE pg_catalog.format('GRANT SELECT (%s) ON public.marketplace_listings TO anon, authenticated', v_cols);
  -- A private column must never carry a column SELECT grant for anon/authenticated.
  SELECT string_agg(pg_catalog.quote_ident(a.attname), ', ') INTO v_cols
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.marketplace_listings'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attname = ANY (ARRAY['serial_number', 'notes', 'details'])
    AND a.attacl::text ~ '(anon|authenticated)=[a-zA-Z]*r';
  IF v_cols IS NOT NULL THEN
    EXECUTE pg_catalog.format('REVOKE SELECT (%s) ON public.marketplace_listings FROM anon, authenticated', v_cols);
  END IF;
END $$;

-- Seller-only private fields.
CREATE OR REPLACE FUNCTION public.marketplace_listing_private(p_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object('serial_number', l.serial_number, 'notes', l.notes, 'details', l.details)
  FROM public.marketplace_listings l
  WHERE l.id = p_id
    AND auth.uid() IS NOT NULL
    AND (l.seller_id = auth.uid() OR l.created_by = auth.uid()
         OR (l.organization_id IS NOT NULL AND public.is_active_org_member(l.organization_id)));
$$;
COMMENT ON FUNCTION public.marketplace_listing_private(uuid) IS
  '000935: serial_number/notes/details for the listing seller, creator or a member of its org; NULL otherwise.';
REVOKE ALL ON FUNCTION public.marketplace_listing_private(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_listing_private(uuid) TO authenticated, service_role;

-- Narrow the signed-in SELECT policy: no more drafts of other orgs.
DROP POLICY IF EXISTS "Sellers select own listings" ON public.marketplace_listings;
CREATE POLICY "Sellers select own listings" ON public.marketplace_listings
  FOR SELECT TO authenticated
  USING (
    status = ANY (ARRAY['active'::text, 'open'::text, 'published'::text, 'sold'::text])
    OR seller_id = auth.uid()
    OR created_by = auth.uid()
    OR (organization_id IS NOT NULL AND public.is_active_org_member(organization_id))
  );

COMMIT;
