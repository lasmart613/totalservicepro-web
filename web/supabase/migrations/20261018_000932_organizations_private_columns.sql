-- 000932: organizations private columns (QA F-3).
--
-- Before: anon and authenticated had table-level SELECT on public.organizations.
-- RLS lets any signed-in user read listed (113) and storefront (1) orgs, plus
-- CRM-linked customers and their own orgs, and with table-level SELECT that
-- meant EVERY column of those rows: tax_id, notes, Stripe Connect ids/flags,
-- lead/prospect markers, trial and creator-shop internals.
--
-- After (Option A, column privileges; RLS rows unchanged):
--   * anon and authenticated keep SELECT on every column EXCEPT the private set:
--       tax_id, notes, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, lead_source, prospect_pool, trial_granted_at, creator_shop_org_id
--   * Own-org reads of tax_id / notes go through
--       public.org_private_fields(p_org_id bigint) -> jsonb {tax_id, notes} | NULL
--     SECURITY DEFINER, empty search_path. Returns data only when the caller is
--     a member of the org (auth_member_of_org) or passes org_creator_access (the
--     same rule as the UPDATE policy, so who can write notes can read them).
--     EXECUTE: authenticated, service_role. Not anon, not PUBLIC.
--   * Stripe / lead / prospect / trial / creator-shop columns are server-only
--     (service role, unchanged). God admin flows use the service role.
--   * INSERT/UPDATE column grants are untouched (orgs still save notes/tax_id).
--   * MAINTAIN on organizations is revoked from anon and authenticated.
--   * public_directory_page (000931) is re-created with a prospect_pool fix:
--     prod prospect_pool is TEXT ('amer-clinics-1018' etc.), so 000931's
--     "NOT IN ('true','t')" never excluded it. Now: excluded unless empty/false.
--
-- NOTE for future migrations: SELECT on organizations is now per column. A new
-- public column needs GRANT SELECT (col) ON public.organizations TO anon, authenticated.
--
-- Wrapped in BEGIN/COMMIT (under a wrapping tool BEGIN only warns). Idempotent.
-- extract()/coalesce() are SQL syntax and stay unqualified on purpose.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Drift guards
DO $$
DECLARE
  v_missing text;
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION '000932 drift: public.organizations is missing';
  END IF;
  SELECT string_agg(c, ', ') INTO v_missing
  FROM unnest(ARRAY['tax_id', 'notes', 'stripe_account_id', 'stripe_charges_enabled', 'stripe_payouts_enabled', 'stripe_details_submitted', 'lead_source', 'prospect_pool', 'trial_granted_at', 'creator_shop_org_id', 'id', 'created_by', 'created_at', 'list_in_directory', 'is_active', 'notes', 'type', 'state']) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.organizations'::regclass AND attname = c AND attnum > 0 AND NOT attisdropped
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '000932 drift: organizations is missing column(s): %', v_missing;
  END IF;
  IF to_regprocedure('public.auth_member_of_org(bigint)') IS NULL
     OR to_regprocedure('public.org_creator_access(bigint, uuid, timestamp with time zone)') IS NULL THEN
    RAISE EXCEPTION '000932 drift: auth_member_of_org / org_creator_access missing';
  END IF;
  IF to_regprocedure('public.public_directory_page(text[], integer, integer)') IS NULL THEN
    RAISE EXCEPTION '000932 drift: 000931 public_directory_page missing (apply 000931 first)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'org_private_fields'
      AND coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), '') NOT LIKE '000932:%'
  ) THEN
    RAISE EXCEPTION '000932 drift: a public.org_private_fields not created by 000932 already exists';
  END IF;
END $$;

-- MAINTAIN (VACUUM/ANALYZE/REINDEX/REFRESH/CLUSTER/LOCK, PG17) is not needed by
-- anon/authenticated. Prod granted it via the default ACL; the rollback restores it.
REVOKE MAINTAIN ON public.organizations FROM anon, authenticated;

-- Column privileges: table-level SELECT off, every non-private column back on.
REVOKE SELECT ON public.organizations FROM anon, authenticated;
DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.organizations'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attname <> ALL (ARRAY['tax_id', 'notes', 'stripe_account_id', 'stripe_charges_enabled', 'stripe_payouts_enabled', 'stripe_details_submitted', 'lead_source', 'prospect_pool', 'trial_granted_at', 'creator_shop_org_id']);
  EXECUTE pg_catalog.format('GRANT SELECT (%s) ON public.organizations TO anon, authenticated', v_cols);
  -- A private column must never carry a column SELECT grant for anon/authenticated.
  SELECT string_agg(pg_catalog.quote_ident(a.attname), ', ') INTO v_cols
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.organizations'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attname = ANY (ARRAY['tax_id', 'notes', 'stripe_account_id', 'stripe_charges_enabled', 'stripe_payouts_enabled', 'stripe_details_submitted', 'lead_source', 'prospect_pool', 'trial_granted_at', 'creator_shop_org_id'])
    AND a.attacl::text ~ '(anon|authenticated)=[a-zA-Z]*r';
  IF v_cols IS NOT NULL THEN
    EXECUTE pg_catalog.format('REVOKE SELECT (%s) ON public.organizations FROM anon, authenticated', v_cols);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.org_private_fields(p_org_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object('tax_id', o.tax_id, 'notes', o.notes)
  FROM public.organizations o
  WHERE o.id = p_org_id
    AND auth.uid() IS NOT NULL
    AND (public.auth_member_of_org(o.id) OR public.org_creator_access(o.id, o.created_by, o.created_at));
$$;

COMMENT ON FUNCTION public.org_private_fields(bigint) IS
  '000932: tax_id/notes for members of the org or org_creator_access callers; NULL otherwise.';

REVOKE ALL ON FUNCTION public.org_private_fields(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_private_fields(bigint) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_private_fields(bigint) TO authenticated, service_role;

-- 000931 prospect_pool fix (text column in prod).
CREATE OR REPLACE FUNCTION public.public_directory_page(
  p_types text[] DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 36
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer := least(48, greatest(1, coalesce(p_limit, 36)));
  v_offset integer := least(10000, greatest(0, coalesce(p_offset, 0)));
  v_types text[] := CASE WHEN p_types IS NULL OR cardinality(p_types) = 0 THEN NULL ELSE p_types END;
  v_rows jsonb;
  v_total bigint;
BEGIN
  WITH region_map(k, region) AS (
    VALUES
      ('CT', 'Northeast'),
      ('ME', 'Northeast'),
      ('MA', 'Northeast'),
      ('NH', 'Northeast'),
      ('RI', 'Northeast'),
      ('VT', 'Northeast'),
      ('NJ', 'Northeast'),
      ('NY', 'Northeast'),
      ('PA', 'Northeast'),
      ('IL', 'Midwest'),
      ('IN', 'Midwest'),
      ('MI', 'Midwest'),
      ('OH', 'Midwest'),
      ('WI', 'Midwest'),
      ('IA', 'Midwest'),
      ('KS', 'Midwest'),
      ('MN', 'Midwest'),
      ('MO', 'Midwest'),
      ('NE', 'Midwest'),
      ('ND', 'Midwest'),
      ('SD', 'Midwest'),
      ('DE', 'South'),
      ('FL', 'South'),
      ('GA', 'South'),
      ('MD', 'South'),
      ('NC', 'South'),
      ('SC', 'South'),
      ('VA', 'South'),
      ('WV', 'South'),
      ('AL', 'South'),
      ('KY', 'South'),
      ('MS', 'South'),
      ('TN', 'South'),
      ('AR', 'South'),
      ('LA', 'South'),
      ('OK', 'South'),
      ('TX', 'South'),
      ('DC', 'South'),
      ('AZ', 'West'),
      ('CO', 'West'),
      ('ID', 'West'),
      ('MT', 'West'),
      ('NV', 'West'),
      ('NM', 'West'),
      ('UT', 'West'),
      ('WY', 'West'),
      ('AK', 'West'),
      ('CA', 'West'),
      ('HI', 'West'),
      ('OR', 'West'),
      ('WA', 'West'),
      ('AB', 'Canada'),
      ('BC', 'Canada'),
      ('MB', 'Canada'),
      ('NB', 'Canada'),
      ('NL', 'Canada'),
      ('NS', 'Canada'),
      ('NT', 'Canada'),
      ('NU', 'Canada'),
      ('ON', 'Canada'),
      ('PE', 'Canada'),
      ('QC', 'Canada'),
      ('SK', 'Canada'),
      ('YT', 'Canada'),
      ('connecticut', 'Northeast'),
      ('maine', 'Northeast'),
      ('massachusetts', 'Northeast'),
      ('new hampshire', 'Northeast'),
      ('rhode island', 'Northeast'),
      ('vermont', 'Northeast'),
      ('new jersey', 'Northeast'),
      ('new york', 'Northeast'),
      ('pennsylvania', 'Northeast'),
      ('illinois', 'Midwest'),
      ('indiana', 'Midwest'),
      ('michigan', 'Midwest'),
      ('ohio', 'Midwest'),
      ('wisconsin', 'Midwest'),
      ('iowa', 'Midwest'),
      ('kansas', 'Midwest'),
      ('minnesota', 'Midwest'),
      ('missouri', 'Midwest'),
      ('nebraska', 'Midwest'),
      ('north dakota', 'Midwest'),
      ('south dakota', 'Midwest'),
      ('delaware', 'South'),
      ('florida', 'South'),
      ('georgia', 'South'),
      ('maryland', 'South'),
      ('north carolina', 'South'),
      ('south carolina', 'South'),
      ('virginia', 'South'),
      ('west virginia', 'South'),
      ('alabama', 'South'),
      ('kentucky', 'South'),
      ('mississippi', 'South'),
      ('tennessee', 'South'),
      ('arkansas', 'South'),
      ('louisiana', 'South'),
      ('oklahoma', 'South'),
      ('texas', 'South'),
      ('district of columbia', 'South'),
      ('arizona', 'West'),
      ('colorado', 'West'),
      ('idaho', 'West'),
      ('montana', 'West'),
      ('nevada', 'West'),
      ('new mexico', 'West'),
      ('utah', 'West'),
      ('wyoming', 'West'),
      ('alaska', 'West'),
      ('california', 'West'),
      ('hawaii', 'West'),
      ('oregon', 'West'),
      ('washington', 'West'),
      ('alberta', 'Canada'),
      ('british columbia', 'Canada'),
      ('manitoba', 'Canada'),
      ('new brunswick', 'Canada'),
      ('newfoundland and labrador', 'Canada'),
      ('nova scotia', 'Canada'),
      ('ontario', 'Canada'),
      ('prince edward island', 'Canada'),
      ('quebec', 'Canada'),
      ('saskatchewan', 'Canada')
  ),
  listed AS (
    SELECT o.id, o.type,
      coalesce(
        (SELECT r.region FROM region_map r
          WHERE pg_catalog.length(pg_catalog.regexp_replace(coalesce(o.state, ''), '[^A-Za-z]', '', 'g')) = 2
            AND r.k = pg_catalog.upper(pg_catalog.regexp_replace(o.state, '[^A-Za-z]', '', 'g'))),
        (SELECT r.region FROM region_map r
          WHERE r.k = pg_catalog.btrim(pg_catalog.lower(pg_catalog.replace(coalesce(o.state, ''), '.', ''))))
      ) AS region
    FROM public.organizations o
    WHERE o.list_in_directory IS TRUE
      AND o.is_active IS DISTINCT FROM false
      AND (v_types IS NULL OR o.type = ANY (v_types))
      AND coalesce(o.notes, '') !~* '(^|[^a-z])(re)?import[[:space:]]*:'
      AND coalesce(pg_catalog.to_jsonb(o) ->> 'prospect_pool', '') IN ('', 'false', 'f')
      AND coalesce(pg_catalog.to_jsonb(o) ->> 'lead_source', '') = ''
  )
  SELECT
    (SELECT count(*) FROM listed),
    coalesce((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', p.id, 'type', p.type, 'region', p.region) ORDER BY p.id)
      FROM (SELECT * FROM listed ORDER BY id OFFSET v_offset LIMIT v_limit) p
    ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN pg_catalog.jsonb_build_object('rows', v_rows, 'total', v_total);
END;
$$;

COMMENT ON FUNCTION public.public_directory_page(text[], integer, integer) IS
  '000932: logged-out directory page (from 000931; prospect_pool text fix). Listed, active, non-import, non-prospect, non-lead orgs only; id/type/region; listed-only total.';

COMMIT;
