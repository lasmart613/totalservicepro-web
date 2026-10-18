-- 000926: public "register your company free" directory sign-up.
--
-- Used by the standalone Medical Repair Network site
-- (https://medicalrepairnetwork.com) through the Supabase Edge Function
-- register-directory-org. The browser never talks to the database: the
-- function validates input, checks the honeypot, minimum fill time and
-- (optionally) Turnstile, then calls these RPCs with the service role.
--
--   directory_registration_step1(name, kind, email, state, zip, ip_hash)
--     DB-backed rate limit (per IP hash and per email), dedupe, then insert
--     a pending organizations row: is_active = false, list_in_directory =
--     false. The signed-in directory (list_in_directory = true) and the guest
--     preview (/api/directory, is_active <> false) both skip it. Returns a
--     random registration id that the function wraps in a signed 60-minute
--     token for step 2. A dedupe match creates no org and returns only
--     status 'review'; nothing about the matched org leaves the DB.
--
--   directory_registration_step2(registration_id, organization_id, fields)
--     Fills in the rest of the profile. Only for a registration still at
--     step 1, under 2 hours old, bound to that exact org, whose org is still
--     pending/unlisted/non-premium. Single use. Allow-listed columns only;
--     type, listing, premium, stripe and ownership columns are never touched.
--     A second dedupe pass (website host / phone) marks the registration
--     possible_duplicate for review, again without leaking anything.
--
-- No auth users or memberships are created. Listing is a manual review.
--
-- Tables: RLS on, no policies, all privileges revoked from PUBLIC, anon,
-- authenticated and service_role. Functions: SECURITY DEFINER, empty
-- search_path, EXECUTE for service_role only. extract()/coalesce() are SQL
-- syntax and stay unqualified on purpose.
--
-- APPLY ON LIVE SUPABASE only after Larry's yes. Idempotent; safe to re-run.

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.directory_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint REFERENCES public.organizations(id) ON DELETE SET NULL,
  matched_organization_id bigint REFERENCES public.organizations(id) ON DELETE SET NULL,
  org_type text NOT NULL,
  status text NOT NULL,
  step smallint NOT NULL DEFAULT 1,
  name_norm text NOT NULL,
  email_norm text NOT NULL,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT directory_registrations_status_check
    CHECK (status IN ('pending', 'possible_duplicate', 'approved', 'rejected')),
  CONSTRAINT directory_registrations_type_check
    CHECK (org_type IN ('service_company', 'parts_supplier', 'laser_rental', 'laser_clinic')),
  CONSTRAINT directory_registrations_step_check CHECK (step IN (1, 2)),
  CONSTRAINT directory_registrations_email_len CHECK (char_length(email_norm) <= 320)
);

COMMENT ON TABLE public.directory_registrations IS
  '000926: public directory sign-ups waiting for review. Service-role RPCs only. Approval (list_in_directory / is_active) is manual.';

CREATE INDEX IF NOT EXISTS directory_registrations_org_idx ON public.directory_registrations (organization_id);
CREATE INDEX IF NOT EXISTS directory_registrations_status_idx ON public.directory_registrations (status, created_at);
CREATE INDEX IF NOT EXISTS directory_registrations_dupe_idx ON public.directory_registrations (name_norm, email_norm);

CREATE TABLE IF NOT EXISTS public.directory_registration_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key_kind text NOT NULL,
  key_value text NOT NULL,
  taken_at timestamptz NOT NULL,
  CONSTRAINT directory_registration_attempts_kind_check CHECK (key_kind IN ('ip', 'email')),
  CONSTRAINT directory_registration_attempts_len CHECK (char_length(key_value) BETWEEN 1 AND 320)
);

CREATE INDEX IF NOT EXISTS directory_registration_attempts_key_idx
  ON public.directory_registration_attempts (key_kind, key_value, taken_at);
CREATE INDEX IF NOT EXISTS directory_registration_attempts_taken_idx
  ON public.directory_registration_attempts (taken_at);

ALTER TABLE public.directory_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.directory_registration_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.directory_registrations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.directory_registration_attempts FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE seq text;
BEGIN
  seq := pg_catalog.pg_get_serial_sequence('public.directory_registration_attempts', 'id');
  IF seq IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', seq);
  END IF;
END $$;

-- Name key: lowercase, & -> and, punctuation to spaces, legal suffixes dropped.
CREATE OR REPLACE FUNCTION public.directory_norm_name(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(
        pg_catalog.replace(pg_catalog.lower(coalesce(p, '')), '&', ' and '),
        '[^a-z0-9]+', ' ', 'g'),
      '(^| )(the|inc|incorporated|llc|ltd|limited|co|corp|corporation|company|pllc|pc|lp|llp)(?= |$)', ' ', 'g'),
    ' +', ' ', 'g'))
$$;

-- Host key for an email domain or a website: lowercase, no scheme/www/path/port.
CREATE OR REPLACE FUNCTION public.directory_norm_host(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT nullif(pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.btrim(coalesce(p, ''))),
      '^([a-z][a-z0-9+.-]*://)?([^@/]*@)?(www\.)?', ''),
    '[:/?#].*$', ''), '')
$$;

-- Last 10 digits of a phone number, or NULL when it has fewer than 10.
CREATE OR REPLACE FUNCTION public.directory_norm_phone(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE WHEN char_length(d) >= 10 THEN pg_catalog.right(d, 10) END
  FROM (SELECT pg_catalog.regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') AS d) x
$$;

CREATE OR REPLACE FUNCTION public.directory_is_free_mail(p_host text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(p_host, '') IN (
    'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com',
    'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me',
    'protonmail.com', 'gmx.com', 'mail.com', 'comcast.net', 'att.net', 'sbcglobal.net',
    'verizon.net', 'cox.net', 'yandex.com', 'zoho.com')
$$;

-- Existing org that looks like the same company, else NULL. Same normalized
-- name AND (same business email domain / website host, or same phone).
CREATE OR REPLACE FUNCTION public.directory_find_duplicate(
  p_name_norm text, p_host text, p_phone text, p_exclude bigint)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT o.id
  FROM public.organizations o
  WHERE o.id IS DISTINCT FROM p_exclude
    AND coalesce(p_name_norm, '') <> ''
    AND public.directory_norm_name(o.name) = p_name_norm
    AND (
      (p_host IS NOT NULL AND NOT public.directory_is_free_mail(p_host) AND (
         public.directory_norm_host(pg_catalog.split_part(coalesce(o.email, ''), '@', 2)) = p_host
         OR public.directory_norm_host(o.website) = p_host))
      OR (p_phone IS NOT NULL AND (
         public.directory_norm_phone(o.phone) = p_phone
         OR public.directory_norm_phone(o.alt_phone) = p_phone))
    )
  ORDER BY o.id
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.directory_registration_step1(
  p_name text,
  p_kind text,
  p_email text,
  p_state text,
  p_zip text,
  p_ip_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_ip text := pg_catalog.btrim(coalesce(p_ip_hash, ''));
  v_state text := nullif(pg_catalog.upper(pg_catalog.btrim(coalesce(p_state, ''))), '');
  v_zip text := nullif(pg_catalog.btrim(coalesce(p_zip, '')), '');
  v_type text;
  v_name_norm text;
  v_host text;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_match bigint;
  v_org bigint;
  v_reg uuid;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);

  v_type := CASE pg_catalog.lower(pg_catalog.btrim(coalesce(p_kind, '')))
    WHEN 'service' THEN 'service_company'
    WHEN 'supplier' THEN 'parts_supplier'
    WHEN 'rental' THEN 'laser_rental'
    WHEN 'clinic' THEN 'laser_clinic'
  END;

  IF v_type IS NULL
     OR char_length(v_name) NOT BETWEEN 2 AND 160
     OR char_length(v_email) NOT BETWEEN 6 AND 254
     OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR char_length(v_ip) NOT BETWEEN 1 AND 128
     OR (v_state IS NOT NULL AND v_state !~ '^[A-Z]{2}$')
     OR (v_zip IS NOT NULL AND v_zip !~ '^[0-9]{5}(-[0-9]{4})?$') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  -- Rate limit. Expired rows first (skip rows another call is deleting).
  DELETE FROM public.directory_registration_attempts a
  WHERE a.id IN (
    SELECT x.id FROM public.directory_registration_attempts x
    WHERE x.taken_at <= v_now - interval '1 day'
    ORDER BY x.id
    FOR UPDATE SKIP LOCKED
  );

  -- Fixed order (ip, then email) so two calls can't deadlock.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tsp.dirreg.ip:' || v_ip, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tsp.dirreg.email:' || v_email, 0));

  IF (SELECT count(*) FROM public.directory_registration_attempts
      WHERE key_kind = 'ip' AND key_value = v_ip AND taken_at > v_now - interval '10 minutes') >= 5
     OR (SELECT count(*) FROM public.directory_registration_attempts
      WHERE key_kind = 'ip' AND key_value = v_ip AND taken_at > v_now - interval '1 day') >= 20
     OR (SELECT count(*) FROM public.directory_registration_attempts
      WHERE key_kind = 'email' AND key_value = v_email AND taken_at > v_now - interval '1 day') >= 3 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  INSERT INTO public.directory_registration_attempts (key_kind, key_value, taken_at)
  VALUES ('ip', v_ip, v_now), ('email', v_email, v_now);

  v_name_norm := public.directory_norm_name(v_name);
  IF v_name_norm = '' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  v_host := public.directory_norm_host(pg_catalog.split_part(v_email, '@', 2));
  v_match := public.directory_find_duplicate(v_name_norm, v_host, NULL, NULL);

  IF v_match IS NULL THEN
    -- Same company + email already waiting from an earlier step 1: no second org.
    SELECT r.organization_id INTO v_match
    FROM public.directory_registrations r
    WHERE r.name_norm = v_name_norm AND r.email_norm = v_email AND r.organization_id IS NOT NULL
    ORDER BY r.created_at DESC
    LIMIT 1;
  END IF;

  IF v_match IS NOT NULL THEN
    INSERT INTO public.directory_registrations
      (organization_id, matched_organization_id, org_type, status, step, name_norm, email_norm, ip_hash, created_at)
    VALUES (NULL, v_match, v_type, 'possible_duplicate', 2, v_name_norm, v_email, v_ip, v_now);
    RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'review');
  END IF;

  INSERT INTO public.organizations (name, type, email, state, zip, is_active, list_in_directory, is_premium, notes)
  VALUES (v_name, v_type, v_email, v_state, v_zip, false, false, false,
          'Self-registered via the Medical Repair Network directory sign-up (pending review).')
  RETURNING id INTO v_org;

  INSERT INTO public.directory_registrations
    (organization_id, org_type, status, step, name_norm, email_norm, ip_hash, created_at)
  VALUES (v_org, v_type, 'pending', 1, v_name_norm, v_email, v_ip, v_now)
  RETURNING id INTO v_reg;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'status', 'created', 'registration_id', v_reg, 'organization_id', v_org);
END;
$$;

CREATE OR REPLACE FUNCTION public.directory_registration_step2(
  p_registration_id uuid,
  p_organization_id bigint,
  p_fields jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  r public.directory_registrations%ROWTYPE;
  o public.organizations%ROWTYPE;
  v_match bigint;
  v_brands text[];
  v_terr text[];
  v_spec text[];
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);

  IF p_registration_id IS NULL OR p_organization_id IS NULL
     OR pg_catalog.jsonb_typeof(f) <> 'object' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  -- Lock order: organization row, then registration row.
  SELECT * INTO o FROM public.organizations WHERE id = p_organization_id FOR UPDATE;
  SELECT * INTO r FROM public.directory_registrations WHERE id = p_registration_id FOR UPDATE;

  IF r.id IS NULL OR o.id IS NULL
     OR r.organization_id IS DISTINCT FROM o.id
     OR r.step <> 1
     OR r.status <> 'pending'
     OR r.created_at <= pg_catalog.clock_timestamp() - interval '2 hours'
     OR coalesce(o.is_active, true) <> false
     OR o.list_in_directory <> false
     OR coalesce(o.is_premium, false) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;

  SELECT coalesce(array_agg(DISTINCT pg_catalog.left(pg_catalog.btrim(v), 80))
                  FILTER (WHERE pg_catalog.btrim(v) <> ''), '{}')
    INTO v_brands
  FROM (SELECT v FROM pg_catalog.jsonb_array_elements_text(
          CASE WHEN pg_catalog.jsonb_typeof(f->'brands') = 'array' THEN f->'brands' ELSE '[]'::jsonb END) v
        LIMIT 40) s;
  SELECT coalesce(array_agg(DISTINCT pg_catalog.left(pg_catalog.btrim(v), 80))
                  FILTER (WHERE pg_catalog.btrim(v) <> ''), '{}')
    INTO v_terr
  FROM (SELECT v FROM pg_catalog.jsonb_array_elements_text(
          CASE WHEN pg_catalog.jsonb_typeof(f->'coverage') = 'array' THEN f->'coverage' ELSE '[]'::jsonb END) v
        LIMIT 60) s;
  SELECT coalesce(array_agg(DISTINCT pg_catalog.left(pg_catalog.btrim(v), 80))
                  FILTER (WHERE pg_catalog.btrim(v) <> ''), '{}')
    INTO v_spec
  FROM (SELECT v FROM pg_catalog.jsonb_array_elements_text(
          CASE WHEN pg_catalog.jsonb_typeof(f->'modalities') = 'array' THEN f->'modalities' ELSE '[]'::jsonb END) v
        LIMIT 40) s;

  UPDATE public.organizations SET
    contact_name      = coalesce(nullif(pg_catalog.left(pg_catalog.btrim(f->>'contact_name'), 120), ''), contact_name),
    phone             = coalesce(nullif(pg_catalog.left(pg_catalog.btrim(f->>'phone'), 40), ''), phone),
    alt_phone         = coalesce(nullif(pg_catalog.left(pg_catalog.btrim(f->>'alt_phone'), 40), ''), alt_phone),
    website           = coalesce(nullif(pg_catalog.left(pg_catalog.btrim(f->>'website'), 200), ''), website),
    address           = coalesce(nullif(pg_catalog.left(pg_catalog.btrim(f->>'address'), 200), ''), address),
    city              = coalesce(nullif(pg_catalog.left(pg_catalog.btrim(f->>'city'), 80), ''), city),
    state             = CASE WHEN pg_catalog.upper(pg_catalog.btrim(coalesce(f->>'state', ''))) ~ '^[A-Z]{2}$'
                             THEN pg_catalog.upper(pg_catalog.btrim(f->>'state')) ELSE state END,
    zip               = CASE WHEN pg_catalog.btrim(coalesce(f->>'zip', '')) ~ '^[0-9]{5}(-[0-9]{4})?$'
                             THEN pg_catalog.btrim(f->>'zip') ELSE zip END,
    description       = coalesce(nullif(pg_catalog.left(pg_catalog.btrim(f->>'description'), 1000), ''), description),
    services_offered  = coalesce(nullif(pg_catalog.left(pg_catalog.btrim(f->>'services_offered'), 500), ''), services_offered),
    years_in_business = CASE WHEN (f->>'years_in_business') ~ '^[0-9]{1,3}$' THEN (f->>'years_in_business')::integer ELSE years_in_business END,
    num_techs         = CASE WHEN (f->>'num_techs') ~ '^[0-9]{1,4}$' THEN (f->>'num_techs')::integer ELSE num_techs END,
    num_locations     = CASE WHEN (f->>'num_locations') ~ '^[0-9]{1,4}$' THEN (f->>'num_locations')::integer ELSE num_locations END,
    supported_brands  = CASE WHEN cardinality(v_brands) > 0 THEN v_brands ELSE supported_brands END,
    service_territories = CASE WHEN cardinality(v_terr) > 0 THEN v_terr ELSE service_territories END,
    specialties       = CASE WHEN cardinality(v_spec) > 0 THEN v_spec ELSE specialties END,
    updated_at        = pg_catalog.now()
  WHERE id = o.id;

  SELECT * INTO o FROM public.organizations WHERE id = p_organization_id;
  v_match := public.directory_find_duplicate(
    r.name_norm, public.directory_norm_host(o.website), public.directory_norm_phone(o.phone), o.id);

  UPDATE public.directory_registrations SET
    step = 2,
    completed_at = pg_catalog.clock_timestamp(),
    status = CASE WHEN v_match IS NULL THEN 'pending' ELSE 'possible_duplicate' END,
    matched_organization_id = v_match
  WHERE id = r.id;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'received');
END;
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.directory_norm_name(text)',
    'public.directory_norm_host(text)',
    'public.directory_norm_phone(text)',
    'public.directory_is_free_mail(text)',
    'public.directory_find_duplicate(text, text, text, bigint)',
    'public.directory_registration_step1(text, text, text, text, text, text)',
    'public.directory_registration_step2(uuid, bigint, jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;
