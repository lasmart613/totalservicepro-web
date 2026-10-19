-- 000931: safe public directory read for logged-out visitors.
--
-- GET /api/directory used the service role and returned every laser_clinic /
-- customer org (id, type, region, contact-presence flags, total count),
-- including unlisted orgs and the private clinic imports. This RPC replaces
-- that path so the route can use the anon key.
--
--   public.public_directory_page(p_types text[], p_offset integer, p_limit integer)
--     -> jsonb {"rows": [{"id", "type", "state"}...], "total": n}
--
-- Rows returned: list_in_directory = true AND is_active IS DISTINCT FROM false,
-- AND NOT an import (notes tagged "Import: <set>", e.g. intl-clinics-1018,
-- amer-clinics-1018, egypt-clinics-1018), AND NOT a prospect_pool org (000929)
-- AND NOT a lead_source org (000930). The last two are read through
-- to_jsonb(row) so this works before or after those migrations land.
-- Only id, type and state leave the function (state is turned into a coarse
-- region by the route). No names, contacts, notes or presence flags.
-- total counts only the rows that pass the same filter.
-- p_limit is clamped to 1..48, p_offset to 0..10000.
--
-- SECURITY DEFINER, empty search_path, STABLE. EXECUTE: anon, authenticated,
-- service_role only (revoked from PUBLIC). extract()/coalesce() are SQL syntax
-- and stay unqualified on purpose. Idempotent; safe to re-run.

SET LOCAL lock_timeout = '5s';

-- Drift guards
DO $$
DECLARE
  v_missing text;
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION '000931 drift: public.organizations is missing';
  END IF;
  SELECT string_agg(c, ', ') INTO v_missing
  FROM unnest(ARRAY['id', 'type', 'state', 'notes', 'is_active', 'list_in_directory']) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.organizations'::regclass AND attname = c AND NOT attisdropped
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '000931 drift: organizations is missing column(s): %', v_missing;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'public_directory_page'
      AND coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), '') NOT LIKE '000931:%'
  ) THEN
    RAISE EXCEPTION '000931 drift: a public.public_directory_page not created by 000931 already exists';
  END IF;
END $$;

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
  WITH listed AS (
    SELECT o.id, o.type, o.state
    FROM public.organizations o
    WHERE o.list_in_directory IS TRUE
      AND o.is_active IS DISTINCT FROM false
      AND (v_types IS NULL OR o.type = ANY (v_types))
      AND coalesce(o.notes, '') !~* '(^|[^a-z])import:'
      AND coalesce(pg_catalog.to_jsonb(o) ->> 'prospect_pool', 'false') NOT IN ('true', 't')
      AND coalesce(pg_catalog.to_jsonb(o) ->> 'lead_source', '') = ''
  )
  SELECT
    (SELECT count(*) FROM listed),
    coalesce((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', p.id, 'type', p.type, 'state', p.state) ORDER BY p.id)
      FROM (SELECT * FROM listed ORDER BY id OFFSET v_offset LIMIT v_limit) p
    ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN pg_catalog.jsonb_build_object('rows', v_rows, 'total', v_total);
END;
$$;

COMMENT ON FUNCTION public.public_directory_page(text[], integer, integer) IS
  '000931: logged-out directory page. Listed, active, non-import, non-prospect, non-lead orgs only; id/type/state; listed-only total.';

REVOKE ALL ON FUNCTION public.public_directory_page(text[], integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_directory_page(text[], integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_directory_page(text[], integer, integer) TO anon, authenticated, service_role;
