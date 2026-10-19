-- Rollback for 20261018_000933_find_clinics_locality.sql. Exact inverse:
-- restores find_clinic_prospects (body and comment) byte-for-byte from
-- 20261018_000929_organizations_country.sql and drops the 000933 helpers.
-- Grants on find_clinic_prospects are unchanged by 000933 (CREATE OR REPLACE
-- keeps the ACL), so none are re-issued here. prospect_state_key and
-- prospect_pool_rows were never touched by 000933.
BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.find_clinic_prospects(
  p_country text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org bigint;
  v_type text;
  v_country text;
  v_state text;
  v_city text;
  v_paid boolean;
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := least(greatest(coalesce(p_offset, 0), 0), 50000);
  v_fcountry text := nullif(btrim(coalesce(p_country, '')), '');
  v_fcity text := nullif(lower(btrim(coalesce(p_city, ''))), '');
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  v_org := public.get_my_org_id();
  IF v_org IS NULL OR NOT public.is_active_org_member(v_org) THEN
    RETURN jsonb_build_object('error', 'no_org');
  END IF;
  SELECT lower(btrim(coalesce(o.type, ''))), nullif(btrim(coalesce(o.country, '')), ''),
         public.prospect_state_key(o.state), nullif(lower(btrim(coalesce(o.city, ''))), '')
    INTO v_type, v_country, v_state, v_city
    FROM public.organizations o WHERE o.id = v_org;
  IF v_type IS DISTINCT FROM 'service_company' THEN
    RETURN jsonb_build_object('error', 'not_service_org');
  END IF;
  v_paid := public.org_is_paid_entitled(v_org);

  IF NOT v_paid THEN
    WITH pool AS MATERIALIZED (
      SELECT * FROM public.prospect_pool_rows(v_org, v_country, v_state, v_city)
    ),
    chosen AS (
      SELECT p.id, p.linked, p.rank FROM pool p WHERE p.rank IS NOT NULL
       ORDER BY p.rank, p.id LIMIT 20
    ),
    rest AS (
      SELECT p.* FROM pool p WHERE NOT EXISTS (SELECT 1 FROM chosen c WHERE c.id = p.id)
    ),
    area AS (
      SELECT r.country, r.city, count(*)::int AS n FROM rest r GROUP BY r.country, r.city
    )
    SELECT jsonb_build_object(
      'tier', 'free',
      'total', (SELECT count(*)::int FROM pool),
      'clinics', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', o.id, 'name', o.name, 'type', o.type, 'address', o.address, 'city', o.city,
          'state', o.state, 'zip', o.zip, 'country', o.country, 'phone', o.phone,
          'email', o.email, 'website', o.website, 'contact_name', o.contact_name,
          'laser_models', o.laser_models, 'facility_type', o.facility_type,
          'is_customer', c.linked, 'local', true) ORDER BY c.rank, c.id), '[]'::jsonb)
        FROM chosen c JOIN public.organizations o ON o.id = c.id),
      'country_counts', (SELECT coalesce(jsonb_agg(jsonb_build_object('country', x.country, 'count', x.n)
          ORDER BY x.n DESC, x.country NULLS LAST), '[]'::jsonb)
        FROM (SELECT a.country, sum(a.n)::int AS n FROM area a GROUP BY a.country) x),
      'area_counts', (SELECT coalesce(jsonb_agg(jsonb_build_object('country', y.country, 'city', y.city, 'count', y.n)
          ORDER BY y.n DESC, y.country NULLS LAST, y.city NULLS LAST), '[]'::jsonb)
        FROM (SELECT * FROM area a ORDER BY a.n DESC, a.country NULLS LAST, a.city NULLS LAST LIMIT 300) y),
      'locked', (SELECT jsonb_build_object(
          'area', count(*) FILTER (WHERE r.rank IN (0, 1))::int,
          'total', count(*)::int) FROM rest r),
      'free_limit', 20,
      'page', jsonb_build_object('limit', 20, 'offset', 0, 'filtered_total', (SELECT count(*)::int FROM chosen), 'has_more', false)
    ) INTO v_out;
  ELSE
    WITH pool AS MATERIALIZED (
      SELECT * FROM public.prospect_pool_rows(v_org, v_country, v_state, v_city)
    ),
    filtered AS (
      SELECT p.* FROM pool p
       WHERE (v_fcountry IS NULL OR p.country = v_fcountry)
         AND (v_fcity IS NULL OR lower(p.city) = v_fcity)
    ),
    page AS (
      SELECT f.id, f.linked, f.rank, row_number() OVER (ORDER BY coalesce(f.rank, 9), f.name, f.id) AS pos
        FROM filtered f
       ORDER BY coalesce(f.rank, 9), f.name, f.id
       OFFSET v_offset LIMIT v_limit
    ),
    ftotal AS (SELECT count(*)::int AS n FROM filtered)
    SELECT jsonb_build_object(
      'tier', 'premium',
      'total', (SELECT count(*)::int FROM pool),
      'clinics', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', o.id, 'name', o.name, 'type', o.type, 'address', o.address, 'city', o.city,
          'state', o.state, 'zip', o.zip, 'country', o.country, 'phone', o.phone,
          'email', o.email, 'website', o.website, 'contact_name', o.contact_name,
          'laser_models', o.laser_models, 'facility_type', o.facility_type,
          'is_customer', pg.linked, 'local', pg.rank IS NOT NULL) ORDER BY pg.pos), '[]'::jsonb)
        FROM page pg JOIN public.organizations o ON o.id = pg.id),
      'country_counts', (SELECT coalesce(jsonb_agg(jsonb_build_object('country', x.country, 'count', x.n)
          ORDER BY x.n DESC, x.country NULLS LAST), '[]'::jsonb)
        FROM (SELECT p.country, count(*)::int AS n FROM pool p GROUP BY p.country) x),
      'city_counts', (SELECT coalesce(jsonb_agg(jsonb_build_object('city', y.city, 'count', y.n)
          ORDER BY y.n DESC, y.city), '[]'::jsonb)
        FROM (SELECT min(p.city) AS city, count(*)::int AS n FROM pool p
               WHERE p.city IS NOT NULL AND (v_fcountry IS NULL OR p.country = v_fcountry)
               GROUP BY lower(p.city) ORDER BY count(*) DESC, lower(p.city) LIMIT 300) y),
      'area_counts', '[]'::jsonb,
      'locked', NULL,
      'free_limit', 20,
      'page', jsonb_build_object('limit', v_limit, 'offset', v_offset,
                                 'filtered_total', (SELECT n FROM ftotal),
                                 'has_more', v_offset + v_limit < (SELECT n FROM ftotal))
    ) INTO v_out;
  END IF;

  RETURN v_out || jsonb_build_object('viewer', jsonb_build_object('country', v_country, 'state', v_state, 'city', v_city));
END;
$$;
COMMENT ON FUNCTION public.find_clinic_prospects(text, text, int, int) IS
  '000929: Find clinics for service_company members. Server-side filter/page (max 100)/aggregates. Free = 20 local rows + counts; Premium = paged rows.';

DROP FUNCTION IF EXISTS public.prospect_pool_rows_local(bigint, text, text, text);
DROP FUNCTION IF EXISTS public.prospect_region_key(text, text);
DROP FUNCTION IF EXISTS public.prospect_country_code(text);
DROP FUNCTION IF EXISTS public.prospect_city_key(text);
DROP FUNCTION IF EXISTS public.prospect_fold(text);

COMMIT;
