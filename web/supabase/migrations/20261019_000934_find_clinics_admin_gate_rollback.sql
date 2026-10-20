-- Rollback for 000934: restores find_clinic_prospects exactly as 000933 left it
-- (same body, STABLE, same comment and grants), then drops the two 000934 tables.
-- Safe to re-run.
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_desc text := coalesce(obj_description(to_regprocedure('public.find_clinic_prospects(text,text,integer,integer)'), 'pg_proc'), '');
BEGIN
  IF to_regprocedure('public.find_clinic_prospects(text,text,integer,integer)') IS NULL THEN
    RAISE EXCEPTION '000934 rollback drift: find_clinic_prospects is missing';
  END IF;
  IF v_desc NOT LIKE '000934:%' AND v_desc NOT LIKE '000933:%' THEN
    RAISE EXCEPTION '000934 rollback drift: find_clinic_prospects is neither 000933 nor 000934; refusing';
  END IF;
END $$;

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
  v_ckey text;
  v_state text;
  v_city text;
  v_has_location boolean;
  v_country_pool int;
  v_paid boolean;
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := least(greatest(coalesce(p_offset, 0), 0), 50000);
  v_fcountry text := public.prospect_country_code(p_country);
  v_fcity text := public.prospect_city_key(p_city);
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
         public.prospect_country_code(o.country),
         public.prospect_region_key(o.state, o.country), public.prospect_city_key(o.city),
         (nullif(btrim(coalesce(o.country, '')), '') IS NOT NULL
          OR nullif(btrim(coalesce(o.state, '')), '') IS NOT NULL
          OR nullif(btrim(coalesce(o.city, '')), '') IS NOT NULL)
    INTO v_type, v_country, v_ckey, v_state, v_city, v_has_location
    FROM public.organizations o WHERE o.id = v_org;
  IF v_type IS DISTINCT FROM 'service_company' THEN
    RETURN jsonb_build_object('error', 'not_service_org');
  END IF;
  v_paid := public.org_is_paid_entitled(v_org);

  IF NOT v_paid THEN
    WITH pool AS MATERIALIZED (
      SELECT * FROM public.prospect_pool_rows_local(v_org, v_ckey, v_state, v_city)
    ),
    chosen AS (
      SELECT p.id, p.linked, p.rank FROM pool p WHERE p.rank IS NOT NULL
       ORDER BY p.rank, p.id LIMIT 20
    ),
    rest AS (
      SELECT p.* FROM pool p WHERE NOT EXISTS (SELECT 1 FROM chosen c WHERE c.id = p.id)
    ),
    area AS (
      SELECT mode() WITHIN GROUP (ORDER BY r.country) AS country,
             mode() WITHIN GROUP (ORDER BY r.city) AS city, count(*)::int AS n
        FROM rest r GROUP BY r.country_key, r.city_key
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
        FROM (SELECT mode() WITHIN GROUP (ORDER BY r.country) AS country, count(*)::int AS n FROM rest r GROUP BY r.country_key) x),
      'area_counts', (SELECT coalesce(jsonb_agg(jsonb_build_object('country', y.country, 'city', y.city, 'count', y.n)
          ORDER BY y.n DESC, y.country NULLS LAST, y.city NULLS LAST), '[]'::jsonb)
        FROM (SELECT * FROM area a ORDER BY a.n DESC, a.country NULLS LAST, a.city NULLS LAST LIMIT 300) y),
      'locked', (SELECT jsonb_build_object(
          'area', count(*) FILTER (WHERE r.rank IN (0, 1))::int,
          'total', count(*)::int) FROM rest r),
      'free_limit', 20,
      'page', jsonb_build_object('limit', 20, 'offset', 0, 'filtered_total', (SELECT count(*)::int FROM chosen), 'has_more', false),
      'country_pool', CASE WHEN v_ckey IS NULL THEN NULL
                           ELSE (SELECT count(*)::int FROM pool p WHERE p.country_key = v_ckey) END
    ) INTO v_out;
  ELSE
    WITH pool AS MATERIALIZED (
      SELECT * FROM public.prospect_pool_rows_local(v_org, v_ckey, v_state, v_city)
    ),
    filtered AS (
      SELECT p.* FROM pool p
       WHERE (v_fcountry IS NULL OR p.country_key = v_fcountry)
         AND (v_fcity IS NULL OR p.city_key = v_fcity)
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
        FROM (SELECT mode() WITHIN GROUP (ORDER BY p.country) AS country, count(*)::int AS n FROM pool p GROUP BY p.country_key) x),
      'city_counts', (SELECT coalesce(jsonb_agg(jsonb_build_object('city', y.city, 'count', y.n)
          ORDER BY y.n DESC, y.city), '[]'::jsonb)
        FROM (SELECT mode() WITHIN GROUP (ORDER BY p.city) AS city, count(*)::int AS n FROM pool p
               WHERE p.city_key IS NOT NULL AND (v_fcountry IS NULL OR p.country_key = v_fcountry)
               GROUP BY p.city_key ORDER BY count(*) DESC, p.city_key LIMIT 300) y),
      'area_counts', '[]'::jsonb,
      'locked', NULL,
      'free_limit', 20,
      'page', jsonb_build_object('limit', v_limit, 'offset', v_offset,
                                 'filtered_total', (SELECT n FROM ftotal),
                                 'has_more', v_offset + v_limit < (SELECT n FROM ftotal)),
      'country_pool', CASE WHEN v_ckey IS NULL THEN NULL
                           ELSE (SELECT count(*)::int FROM pool p WHERE p.country_key = v_ckey) END
    ) INTO v_out;
  END IF;

  RETURN (v_out - 'country_pool') || jsonb_build_object('viewer', jsonb_build_object(
    'country', v_country, 'state', v_state, 'city', v_city,
    'has_location', coalesce(v_has_location, false),
    'country_pool', v_out -> 'country_pool'));
END;
$$;
COMMENT ON FUNCTION public.find_clinic_prospects(text, text, int, int) IS
  '000933: Find clinics for service_company members. Server-side filter/page (max 100)/aggregates; normalized state/city keys. Free = 20 local rows + counts; Premium = paged rows.';

REVOKE ALL ON FUNCTION public.find_clinic_prospects(text, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_clinic_prospects(text, text, int, int) TO authenticated;

DROP TABLE IF EXISTS public.prospect_query_log;
DROP TABLE IF EXISTS public.prospect_org_locality;

COMMIT;
