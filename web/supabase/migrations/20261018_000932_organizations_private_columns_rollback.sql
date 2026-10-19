-- Rollback for 000932. Restores table-level SELECT on public.organizations for
-- anon and authenticated (the pre-000932 state: no column-level SELECT grants),
-- drops org_private_fields, and restores the 000931 public_directory_page body.
-- No data changes. App code from the 000932 PR keeps working after rollback
-- (explicit column lists; org_private_fields callers fall back to no private fields).
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'org_private_fields'
      AND coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), '') NOT LIKE '000932:%'
  ) THEN
    RAISE EXCEPTION '000932 rollback refused: public.org_private_fields was not created by 000932';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.org_private_fields(bigint);

-- Drop every column-level SELECT grant, then the table-level grant as before.
DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.organizations'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attacl::text ~ '(anon|authenticated)=[a-zA-Z]*r';
  IF v_cols IS NOT NULL THEN
    EXECUTE pg_catalog.format('REVOKE SELECT (%s) ON public.organizations FROM anon, authenticated', v_cols);
  END IF;
END $$;
GRANT SELECT ON public.organizations TO anon, authenticated;

-- 000931 body, verbatim.
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
      AND coalesce(pg_catalog.to_jsonb(o) ->> 'prospect_pool', 'false') NOT IN ('true', 't')
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
  '000931: logged-out directory page. Listed, active, non-import, non-prospect, non-lead orgs only; id/type/state; listed-only total.';

COMMIT;
