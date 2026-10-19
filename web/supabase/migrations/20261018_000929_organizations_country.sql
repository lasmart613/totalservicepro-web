-- 000929: organizations.country + signed-in "Find clinics" prospect finder.
--
-- NOTE: numbered 000929 because #320 (000927) and #321 (000928) are about to
-- merge. Bump the number if anything else lands first.
--
-- 1) organizations.country text: full English country name ('United States',
--    'Egypt', ...). NULL or a trimmed, non-empty string. Indexed. Clients may
--    INSERT/UPDATE it (column grant, same as the other profile columns).
-- 2) organizations.prospect_pool text: server-side source marker for the
--    shared pool of imported clinics ('intl-clinics-1018'). Set only by the
--    one-off backfill (service role). No client INSERT/UPDATE grant.
-- 3) public.prospect_customer_links: audit + cap ledger for "Add to my
--    customers". RLS on, no policies, all client privileges revoked.
-- 4) RPCs (SECURITY DEFINER, search_path '', anon denied, EXECUTE for
--    authenticated only):
--      find_clinic_prospects()            jsonb
--      add_prospect_customer(bigint)      jsonb
--    Helpers (not callable by clients):
--      org_is_paid_entitled(bigint)       1:1 port of lib/org-plan.ts orgIsPaid
--      prospect_state_key(text)           'California' / 'ca' -> 'CA'
--
-- Visibility model: a caller sees clinics only through find_clinic_prospects.
-- It requires an authenticated active member of a service_company org
-- (get_my_org_id + is_active_org_member). The pool is
--   laser_clinic orgs linked to the caller's org (organization_customers)
--   UNION organizations WHERE prospect_pool = 'intl-clinics-1018'.
-- No organizations RLS policy is added or widened.
--
-- Tiering (server-side, never "send and hide"):
--   Free:    at most 20 local clinics with details (same city, then same
--            state, then same country as the caller org); everything else only
--            as counts by country and city. No names/contacts/ids/equipment.
--   Premium: org_is_paid_entitled() (named paid plan or is_premium incl.
--            complimentary, expired complimentary = Free) gets every row.
--
-- add_prospect_customer only inserts an organization_customers link for the
-- caller's own org. It never touches service_reports, equipment, grants or
-- any history table, so linking never unlocks service history
-- (can_view_service_report_for_history keys on report org / creator /
-- current equipment owner, not on organization_customers for the shop).
-- Owners/admins of a Premium service_company only; idempotent; 50 new links
-- per org per rolling 24 h; every new link is logged in
-- prospect_customer_links.
--
-- extract()/coalesce() are SQL syntax and stay unqualified on purpose.
-- APPLY ON LIVE SUPABASE only after Larry's yes. Rollback:
-- 20261018_000929_organizations_country_rollback.sql

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Drift guards: nothing this migration creates may already exist with
-- another shape. A re-run on an already-migrated DB is allowed only when the
-- objects match.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  SELECT data_type INTO t FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'country';
  IF t IS NOT NULL AND t <> 'text' THEN
    RAISE EXCEPTION 'drift: organizations.country exists as %', t;
  END IF;
  SELECT data_type INTO t FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'prospect_pool';
  IF t IS NOT NULL AND t <> 'text' THEN
    RAISE EXCEPTION 'drift: organizations.prospect_pool exists as %', t;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('find_clinic_prospects', 'add_prospect_customer', 'org_is_paid_entitled', 'prospect_state_key')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_description d
          WHERE d.objoid = p.oid AND d.description LIKE '000929:%'
       )
  ) THEN
    RAISE EXCEPTION 'drift: a 000929 function name already exists and was not created by 000929';
  END IF;
  IF to_regprocedure('public.get_my_org_id()') IS NULL
     OR to_regprocedure('public.is_active_org_member(bigint)') IS NULL THEN
    RAISE EXCEPTION 'missing helper get_my_org_id() / is_active_org_member(bigint)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Columns, checks, indexes, grants
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS prospect_pool text;

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_country_trimmed_check;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_country_trimmed_check
  CHECK (country IS NULL OR (country = btrim(country) AND country <> ''));
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_prospect_pool_check;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_prospect_pool_check
  CHECK (prospect_pool IS NULL OR prospect_pool IN ('intl-clinics-1018'));

COMMENT ON COLUMN public.organizations.country IS
  'Full English country name (e.g. United States, Egypt, United Arab Emirates). NULL = unknown.';
COMMENT ON COLUMN public.organizations.prospect_pool IS
  'Shared imported-clinic pool marker for find_clinic_prospects(). Service role only.';

CREATE INDEX IF NOT EXISTS organizations_country_idx ON public.organizations (country);
CREATE INDEX IF NOT EXISTS organizations_prospect_pool_idx ON public.organizations (prospect_pool)
  WHERE prospect_pool IS NOT NULL;

GRANT INSERT (country), UPDATE (country) ON TABLE public.organizations TO authenticated;

-- ---------------------------------------------------------------------------
-- Audit / cap ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prospect_customer_links (
  id bigserial PRIMARY KEY,
  service_organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prospect_customer_links_org_time_idx
  ON public.prospect_customer_links (service_organization_id, created_at);
ALTER TABLE public.prospect_customer_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.prospect_customer_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.prospect_customer_links_id_seq FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.prospect_customer_links IS
  'Audit of Find clinics "Add to my customers" links (000929). Written only by add_prospect_customer().';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.org_is_paid_entitled(p_org bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- 1:1 port of orgIsPaid() in web/lib/org-plan.ts:
  --   expired complimentary (premium_until <= now) -> only a named paid plan
  --   else is_premium = true OR plan/subscription_tier exactly premium|team|enterprise
  SELECT coalesce((
    SELECT CASE
      WHEN o.premium_until IS NOT NULL AND o.premium_until <= pg_catalog.now()
        THEN lower(btrim(coalesce(o.subscription_tier, ''))) IN ('premium', 'team', 'enterprise')
          OR lower(btrim(coalesce(o.plan, ''))) IN ('premium', 'team', 'enterprise')
      ELSE o.is_premium IS TRUE
          OR lower(btrim(coalesce(o.subscription_tier, ''))) IN ('premium', 'team', 'enterprise')
          OR lower(btrim(coalesce(o.plan, ''))) IN ('premium', 'team', 'enterprise')
    END
    FROM public.organizations o WHERE o.id = p_org
  ), false);
$$;
COMMENT ON FUNCTION public.org_is_paid_entitled(bigint) IS
  '000929: SQL port of lib/org-plan.ts orgIsPaid (complimentary Premium counts until premium_until).';

CREATE OR REPLACE FUNCTION public.prospect_state_key(p_state text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN nullif(btrim(coalesce(p_state, '')), '') IS NULL THEN NULL
    ELSE coalesce(
      (SELECT m.code FROM (VALUES
        ('alabama','AL'),('alaska','AK'),('arizona','AZ'),('arkansas','AR'),('california','CA'),
        ('colorado','CO'),('connecticut','CT'),('delaware','DE'),('district of columbia','DC'),
        ('florida','FL'),('georgia','GA'),('hawaii','HI'),('idaho','ID'),('illinois','IL'),
        ('indiana','IN'),('iowa','IA'),('kansas','KS'),('kentucky','KY'),('louisiana','LA'),
        ('maine','ME'),('maryland','MD'),('massachusetts','MA'),('michigan','MI'),('minnesota','MN'),
        ('mississippi','MS'),('missouri','MO'),('montana','MT'),('nebraska','NE'),('nevada','NV'),
        ('new hampshire','NH'),('new jersey','NJ'),('new mexico','NM'),('new york','NY'),
        ('north carolina','NC'),('north dakota','ND'),('ohio','OH'),('oklahoma','OK'),('oregon','OR'),
        ('pennsylvania','PA'),('rhode island','RI'),('south carolina','SC'),('south dakota','SD'),
        ('tennessee','TN'),('texas','TX'),('utah','UT'),('vermont','VT'),('virginia','VA'),
        ('washington','WA'),('west virginia','WV'),('wisconsin','WI'),('wyoming','WY')
      ) AS m(name, code) WHERE m.name = lower(btrim(p_state))),
      upper(btrim(p_state))
    )
  END;
$$;
COMMENT ON FUNCTION public.prospect_state_key(text) IS
  '000929: normalizes a state for locality matching (US names -> 2-letter code, else upper-case).';

-- ---------------------------------------------------------------------------
-- find_clinic_prospects()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_clinic_prospects()
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
  v_clinics jsonb;
  v_aggs jsonb;
  v_total int;
  v_locked jsonb;
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

  WITH pool AS (
    SELECT o.id,
           EXISTS (SELECT 1 FROM public.organization_customers oc
                    WHERE oc.service_organization_id = v_org AND oc.customer_organization_id = o.id) AS linked,
           CASE
             WHEN v_city IS NOT NULL AND lower(btrim(coalesce(o.city, ''))) = v_city
                  AND (v_state IS NULL OR public.prospect_state_key(o.state) IS NOT DISTINCT FROM v_state)
                  AND (v_country IS NULL OR o.country IS NOT DISTINCT FROM v_country) THEN 0
             WHEN v_state IS NOT NULL AND public.prospect_state_key(o.state) = v_state
                  AND (v_country IS NULL OR o.country IS NOT DISTINCT FROM v_country) THEN 1
             WHEN v_country IS NOT NULL AND o.country = v_country THEN 2
             ELSE NULL
           END AS rank,
           o.country,
           nullif(btrim(coalesce(o.city, '')), '') AS city
      FROM public.organizations o
     WHERE o.id <> v_org
       AND o.is_active IS DISTINCT FROM false
       AND (
         o.prospect_pool = 'intl-clinics-1018'
         OR (lower(coalesce(o.type, '')) = 'laser_clinic' AND EXISTS (
               SELECT 1 FROM public.organization_customers oc
                WHERE oc.service_organization_id = v_org AND oc.customer_organization_id = o.id))
       )
  ),
  chosen AS (
    -- Premium: every row. Free: at most 20 local rows, nearest bucket first.
    SELECT p.*, row_number() OVER (ORDER BY coalesce(p.rank, 9), p.id) AS pos
      FROM pool p
     WHERE v_paid OR p.id IN (
       SELECT q.id FROM pool q WHERE q.rank IS NOT NULL ORDER BY q.rank, q.id LIMIT 20)
  ),
  rest AS (
    SELECT p.country, p.city, count(*)::int AS n
      FROM pool p WHERE NOT v_paid AND p.id NOT IN (SELECT c.id FROM chosen c)
     GROUP BY p.country, p.city
  )
  SELECT
    (SELECT count(*)::int FROM pool),
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
              'id', o.id, 'name', o.name, 'type', o.type, 'address', o.address, 'city', o.city,
              'state', o.state, 'zip', o.zip, 'country', o.country, 'phone', o.phone,
              'email', o.email, 'website', o.website, 'contact_name', o.contact_name,
              'laser_models', o.laser_models, 'facility_type', o.facility_type,
              'is_customer', c.linked, 'local', c.rank IS NOT NULL)
              ORDER BY c.pos), '[]'::jsonb)
       FROM chosen c JOIN public.organizations o ON o.id = c.id),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('country', r.country, 'city', r.city, 'count', r.n)
              ORDER BY r.country NULLS LAST, r.n DESC, r.city NULLS LAST), '[]'::jsonb)
       FROM rest r),
    -- Upgrade CTA counts (free only): gated rows in the caller's area (same
    -- country and same city/state, rank 0-1) and everywhere, minus shown rows.
    (SELECT CASE WHEN v_paid THEN NULL ELSE jsonb_build_object(
              'area', count(*) FILTER (WHERE p.rank IN (0, 1))::int,
              'total', count(*)::int) END
       FROM pool p WHERE p.id NOT IN (SELECT c.id FROM chosen c))
  INTO v_total, v_clinics, v_aggs, v_locked;

  RETURN jsonb_build_object(
    'tier', CASE WHEN v_paid THEN 'premium' ELSE 'free' END,
    'viewer', jsonb_build_object('country', v_country, 'state', v_state, 'city', v_city),
    'total', v_total,
    'clinics', v_clinics,
    'aggregates', v_aggs,
    'locked', v_locked,
    'free_limit', 20
  );
END;
$$;
COMMENT ON FUNCTION public.find_clinic_prospects() IS
  '000929: Find clinics prospect list for service_company members. Free = 20 local rows + counts only; Premium = all rows.';

-- ---------------------------------------------------------------------------
-- add_prospect_customer(clinic_id)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_prospect_customer(p_clinic_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org bigint;
  v_role text;
  v_recent int;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  v_org := public.get_my_org_id();
  IF v_org IS NULL OR NOT public.is_active_org_member(v_org) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_org');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations o
                  WHERE o.id = v_org AND lower(btrim(coalesce(o.type, ''))) = 'service_company') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_service_org');
  END IF;
  SELECT lower(btrim(coalesce(m.role, ''))) INTO v_role
    FROM public.organization_memberships m
   WHERE m.user_id = v_uid AND m.organization_id = v_org
   ORDER BY CASE lower(btrim(coalesce(m.role, ''))) WHEN 'owner' THEN 0 WHEN 'company_admin' THEN 1 WHEN 'admin' THEN 2 ELSE 9 END
   LIMIT 1;
  IF v_role IS NULL OR v_role NOT IN ('owner', 'company_admin', 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_admin');
  END IF;
  IF NOT public.org_is_paid_entitled(v_org) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'premium_required');
  END IF;
  IF p_clinic_id IS NULL OR p_clinic_id = v_org OR NOT EXISTS (
       SELECT 1 FROM public.organizations o
        WHERE o.id = p_clinic_id AND o.is_active IS DISTINCT FROM false
          AND o.prospect_pool = 'intl-clinics-1018') THEN
    -- only the shared pool can be added; own linked clinics are already linked
    IF EXISTS (SELECT 1 FROM public.organization_customers oc
                WHERE oc.service_organization_id = v_org AND oc.customer_organization_id = p_clinic_id) THEN
      RETURN jsonb_build_object('ok', true, 'status', 'already_linked');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('add_prospect_customer:' || v_org::text));

  IF EXISTS (SELECT 1 FROM public.organization_customers oc
              WHERE oc.service_organization_id = v_org AND oc.customer_organization_id = p_clinic_id) THEN
    RETURN jsonb_build_object('ok', true, 'status', 'already_linked');
  END IF;

  SELECT count(*) INTO v_recent FROM public.prospect_customer_links l
   WHERE l.service_organization_id = v_org AND l.created_at > pg_catalog.now() - interval '24 hours';
  IF v_recent >= 50 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'daily_cap', 'cap', 50);
  END IF;

  INSERT INTO public.organization_customers (service_organization_id, customer_organization_id, created_by, notes)
  VALUES (v_org, p_clinic_id, v_uid, 'Added from Find clinics')
  ON CONFLICT (service_organization_id, customer_organization_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'status', 'already_linked');
  END IF;

  INSERT INTO public.prospect_customer_links (service_organization_id, customer_organization_id, user_id)
  VALUES (v_org, p_clinic_id, v_uid);

  RETURN jsonb_build_object('ok', true, 'status', 'linked');
END;
$$;
COMMENT ON FUNCTION public.add_prospect_customer(bigint) IS
  '000929: Premium service_company owner/admin links a pool clinic as a customer. Idempotent, 50/day, audited. No history access.';

REVOKE ALL ON FUNCTION public.org_is_paid_entitled(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_state_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.find_clinic_prospects() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_prospect_customer(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_clinic_prospects() TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_prospect_customer(bigint) TO authenticated;
