-- 000934: Find clinics hardening (CEO nightly review of main 94635b5b, MEDIUM).
--
-- A-1  find_clinic_prospects() returned clinic phone/email/address/contact to
--      ANY member of a service_company org, technicians (fse) included. It now
--      requires the caller's organization_memberships.role to be owner,
--      company_admin or admin. This is the same rule and the same ordering that
--      add_prospect_customer() (000929) already enforces, so that function is
--      unchanged. Others get {"error":"not_admin"}. Prod roles today: company_admin,
--      owner, fse, parts_supplier.
-- A-2  The Free 20-local window was ranked from organizations.city/state/country,
--      which org admins can edit, so a Free org could walk the pool city by
--      city. Locality now comes from public.prospect_org_locality: a server-only
--      snapshot taken on the first call that finds any location and never
--      updated by the RPC (INSERT ... ON CONFLICT DO NOTHING). Orgs without a
--      location are not snapshotted until they set one. Support resets a real
--      move by deleting the row (service role). No trigger on organizations
--      and no change to its policies: the simplest design that a client edit
--      cannot reset.
-- A-3  Premium paging had no limit (100 rows per call, offset up to 50000).
--      Now every call is logged in public.prospect_query_log. More than 30
--      calls per user in a rolling minute returns {"error":"rate_limited"}, and
--      a Premium offset above 5000 returns {"error":"offset_too_large"}. A
--      per-user advisory xact lock serialises the count + insert. Log rows
--      older than 1 day are pruned for the caller on each call. The function is
--      now VOLATILE because it writes.
--
-- What changes: two new tables (RLS on, no grants to anon/authenticated) and
-- find_clinic_prospects(text, text, int, int) replaced in place, with the same
-- signature, grants and payload. Untouched: add_prospect_customer, the 000933
-- helpers, and organizations.
-- Security: SECURITY DEFINER, search_path ''; EXECUTE stays authenticated only.
-- APPLY ON LIVE SUPABASE only after Larry's yes. Rollback:
-- 20261019_000934_find_clinics_admin_gate_rollback.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_missing text;
  v_desc text;
BEGIN
  SELECT string_agg(f, ', ') INTO v_missing
    FROM unnest(ARRAY[
      'public.find_clinic_prospects(text,text,integer,integer)',
      'public.add_prospect_customer(bigint)',
      'public.org_is_paid_entitled(bigint)',
      'public.prospect_pool_rows_local(bigint,text,text,text)',
      'public.prospect_country_code(text)',
      'public.prospect_region_key(text,text)',
      'public.prospect_city_key(text)',
      'public.get_my_org_id()',
      'public.is_active_org_member(bigint)'
    ]) AS f
   WHERE to_regprocedure(f) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '000934 drift: missing function(s): % (000933 must be applied first)', v_missing;
  END IF;
  v_desc := coalesce(obj_description('public.find_clinic_prospects(text,text,integer,integer)'::regprocedure, 'pg_proc'), '');
  IF v_desc NOT LIKE '000933:%' AND v_desc NOT LIKE '000934:%' THEN
    RAISE EXCEPTION '000934 drift: find_clinic_prospects was not created by 000933/000934; refusing to replace';
  END IF;
  SELECT string_agg(c, ', ') INTO v_missing
    FROM unnest(ARRAY['user_id', 'organization_id', 'role']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.organization_memberships'::regclass AND attname = c AND NOT attisdropped);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '000934 drift: organization_memberships is missing column(s): %', v_missing;
  END IF;
  IF to_regclass('public.prospect_org_locality') IS NOT NULL
     AND coalesce(obj_description(to_regclass('public.prospect_org_locality'), 'pg_class'), '') NOT LIKE '000934:%' THEN
    RAISE EXCEPTION '000934 drift: prospect_org_locality exists and was not created by 000934';
  END IF;
  IF to_regclass('public.prospect_query_log') IS NOT NULL
     AND coalesce(obj_description(to_regclass('public.prospect_query_log'), 'pg_class'), '') NOT LIKE '000934:%' THEN
    RAISE EXCEPTION '000934 drift: prospect_query_log exists and was not created by 000934';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.prospect_org_locality (
  organization_id bigint PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  country text,
  state text,
  city text,
  captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.prospect_org_locality ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.prospect_org_locality FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.prospect_org_locality IS
  '000934: server-only locality snapshot for find_clinic_prospects (first call with a location). Delete a row to re-snapshot.';

CREATE TABLE IF NOT EXISTS public.prospect_query_log (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  organization_id bigint NOT NULL,
  p_offset int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prospect_query_log_user_time_idx
  ON public.prospect_query_log (user_id, created_at);
ALTER TABLE public.prospect_query_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.prospect_query_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.prospect_query_log_id_seq FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.prospect_query_log IS
  '000934: find_clinic_prospects call log for the 30/min/user rate limit. Pruned per user after 1 day.';

CREATE OR REPLACE FUNCTION public.find_clinic_prospects(
  p_country text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
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
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_role text;
  v_recent int;
  v_loc record;
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
  SELECT lower(btrim(coalesce(o.type, ''))) INTO v_type
    FROM public.organizations o WHERE o.id = v_org;
  IF v_type IS DISTINCT FROM 'service_company' THEN
    RETURN jsonb_build_object('error', 'not_service_org');
  END IF;

  -- 000934 A-1: owners / company admins / admins only (same rule as
  -- add_prospect_customer). Technicians (fse) and others get no rows.
  SELECT lower(btrim(coalesce(m.role, ''))) INTO v_role
    FROM public.organization_memberships m
   WHERE m.user_id = v_uid AND m.organization_id = v_org
   ORDER BY CASE lower(btrim(coalesce(m.role, ''))) WHEN 'owner' THEN 0 WHEN 'company_admin' THEN 1 WHEN 'admin' THEN 2 ELSE 9 END
   LIMIT 1;
  IF v_role IS NULL OR v_role NOT IN ('owner', 'company_admin', 'admin') THEN
    RETURN jsonb_build_object('error', 'not_admin');
  END IF;

  v_paid := public.org_is_paid_entitled(v_org);

  -- 000934 A-3: per-user rate limit (all tiers) and a Premium max offset.
  IF v_paid AND v_offset > 5000 THEN
    RETURN jsonb_build_object('error', 'offset_too_large', 'max_offset', 5000);
  END IF;
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('find_clinic_prospects:' || v_uid::text));
  SELECT count(*) INTO v_recent FROM public.prospect_query_log q
   WHERE q.user_id = v_uid AND q.created_at > pg_catalog.now() - interval '1 minute';
  IF v_recent >= 30 THEN
    RETURN jsonb_build_object('error', 'rate_limited', 'limit_per_minute', 30, 'retry_after_seconds', 60);
  END IF;
  DELETE FROM public.prospect_query_log q
   WHERE q.user_id = v_uid AND q.created_at < pg_catalog.now() - interval '1 day';
  INSERT INTO public.prospect_query_log (user_id, organization_id, p_offset)
  VALUES (v_uid, v_org, v_offset);

  -- 000934 A-2: locality comes from a server-only snapshot taken on the first
  -- call that finds a location, so editing organizations.city/state/country
  -- later does not move the Free 20-local window. Support resets it by
  -- deleting the prospect_org_locality row (service role only).
  INSERT INTO public.prospect_org_locality (organization_id, country, state, city)
  SELECT o.id, nullif(btrim(coalesce(o.country, '')), ''), nullif(btrim(coalesce(o.state, '')), ''),
         nullif(btrim(coalesce(o.city, '')), '')
    FROM public.organizations o
   WHERE o.id = v_org
     AND (nullif(btrim(coalesce(o.country, '')), '') IS NOT NULL
          OR nullif(btrim(coalesce(o.state, '')), '') IS NOT NULL
          OR nullif(btrim(coalesce(o.city, '')), '') IS NOT NULL)
  ON CONFLICT (organization_id) DO NOTHING;
  SELECT l.country, l.state, l.city INTO v_loc
    FROM public.prospect_org_locality l WHERE l.organization_id = v_org;
  v_country := v_loc.country;
  v_ckey := public.prospect_country_code(v_loc.country);
  v_state := public.prospect_region_key(v_loc.state, v_loc.country);
  v_city := public.prospect_city_key(v_loc.city);
  v_has_location := (v_loc.country IS NOT NULL OR v_loc.state IS NOT NULL OR v_loc.city IS NOT NULL);

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
  '000934: owner/admin only; locality from prospect_org_locality snapshot; 30 calls/min/user; Premium offset <= 5000. Was 000933: Find clinics for service_company members. Server-side filter/page (max 100)/aggregates; normalized state/city keys. Free = 20 local rows + counts; Premium = paged rows.';

REVOKE ALL ON FUNCTION public.find_clinic_prospects(text, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_clinic_prospects(text, text, int, int) TO authenticated;

COMMIT;
