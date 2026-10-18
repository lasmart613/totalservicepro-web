-- 000926: public "register your company free" directory sign-up.
--
-- Used by the standalone Medical Repair Network site
-- (https://medicalrepairnetwork.com) through the Supabase Edge Function
-- register-directory-org. The browser never talks to the database: the
-- function validates input, checks the honeypot, minimum fill time and
-- (optionally) Turnstile, then calls these RPCs with the service role.
--
--   directory_registration_step1(name, kind, email, state, zip, ip_hash, ticket_nonce)
--     Single-use form ticket, then DB-backed rate limits: a GLOBAL cap
--     (30 accepted sign-ups per hour, 100 per day, across everyone, so spoofed
--     IPs don't help), per IP hash (5 / 10 min, 20 / day; skipped when the
--     function has no trustworthy IP) and per normalized email key (3 / day;
--     NFKC, lowercase, +tag stripped, gmail dots removed). Then dedupe, then
--     insert a pending organizations row: is_active = false,
--     list_in_directory = false. The signed-in directory and the guest
--     preview both skip it.
--     A dedupe match creates NO org but answers exactly like a new sign-up
--     ('created' + registration id), so step 1 never reveals whether a
--     company is already in TSP. Its step-2 details go on the registration
--     row for review.
--
--   directory_registration_step2(registration_id, fields)
--     Real sign-up: fills in the rest of the profile on its own pending org
--     (single use, under 2 hours, org still inactive/unlisted/non-premium,
--     allow-listed columns only). Match: saves the fields on the
--     registration only. Unknown id (the function's honeypot decoy): the
--     same 'received' answer, nothing written.
--
-- Text is NFKC-normalized and bidi/control characters (U+202A-202E,
-- U+2066-2069, U+200E/F, C0 controls) are stripped before storing.
--
-- No auth users or memberships are created. Listing is an admin review (below).
--
-- Tables: RLS on, no policies, all privileges revoked from PUBLIC, anon,
-- authenticated and service_role. Functions: SECURITY DEFINER, empty
-- search_path, EXECUTE for service_role only. extract()/coalesce()/normalize() are SQL
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
  company_name text,
  details jsonb,
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
CREATE INDEX IF NOT EXISTS directory_registrations_created_idx ON public.directory_registrations (created_at);

CREATE TABLE IF NOT EXISTS public.directory_registration_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key_kind text NOT NULL,
  key_value text NOT NULL,
  taken_at timestamptz NOT NULL,
  CONSTRAINT directory_registration_attempts_kind_check CHECK (key_kind IN ('ip', 'email', 'global')),
  CONSTRAINT directory_registration_attempts_len CHECK (char_length(key_value) BETWEEN 1 AND 320)
);

-- Single-use form tickets (nonce from the HMAC-signed ticket). Pruned after 3 hours.
CREATE TABLE IF NOT EXISTS public.directory_form_tickets (
  nonce uuid PRIMARY KEY,
  used_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS directory_form_tickets_used_idx ON public.directory_form_tickets (used_at);
ALTER TABLE public.directory_form_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.directory_form_tickets FROM PUBLIC, anon, authenticated, service_role;

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

-- Storage cleanup: NFKC, bidi overrides/isolates, LRM/RLM and C0/DEL controls removed.
CREATE OR REPLACE FUNCTION public.directory_clean_text(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.btrim(pg_catalog.regexp_replace(
    normalize(coalesce(p, ''), NFKC),
    '[\u0001-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]', '', 'g'))
$$;

-- Name key: cleaned, lowercase, & -> and, punctuation and spaces (ASCII and
-- common Unicode blocks) to one space, legal suffixes dropped. Letters and
-- digits in any script are kept, accents included.
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
        pg_catalog.replace(pg_catalog.lower(public.directory_clean_text(p)), '&', ' and '),
        '[\u0020-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e\u00a0-\u00bf\u00d7\u00f7\u2000-\u206f\u2e00-\u2e7f\u3000-\u303f\ufe30-\ufe4f]+', ' ', 'g'),
      '(^| )(the|inc|incorporated|llc|ltd|limited|co|corp|corporation|company|pllc|pc|lp|llp)(?= |$)', ' ', 'g'),
    ' +', ' ', 'g'))
$$;

-- Email as typed, folded: NFKC + lowercase. NULL unless plain ASCII with one
-- @ (so Cyrillic/Greek look-alikes, mixed scripts, <>" and spaces are refused).
CREATE OR REPLACE FUNCTION public.directory_email_clean(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN e ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$'
         AND char_length(e) BETWEEN 6 AND 254
    THEN e END
  FROM (SELECT pg_catalog.lower(pg_catalog.btrim(normalize(coalesce(p, ''), NFKC))) AS e) x
$$;

-- Rate-limit key for an email: +tag dropped; gmail/googlemail dots dropped.
CREATE OR REPLACE FUNCTION public.directory_email_key(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE WHEN e IS NULL THEN NULL
    WHEN pg_catalog.split_part(e, '@', 2) IN ('gmail.com', 'googlemail.com')
      THEN pg_catalog.replace(pg_catalog.split_part(pg_catalog.split_part(e, '@', 1), '+', 1), '.', '') || '@gmail.com'
    ELSE pg_catalog.split_part(pg_catalog.split_part(e, '@', 1), '+', 1) || '@' || pg_catalog.split_part(e, '@', 2)
  END
  FROM (SELECT public.directory_email_clean(p) AS e) x
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
  p_ip_hash text,
  p_ticket_nonce uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name text := public.directory_clean_text(p_name);
  v_email text := public.directory_email_clean(p_email);
  v_key text := public.directory_email_key(p_email);
  v_ip text := nullif(pg_catalog.btrim(coalesce(p_ip_hash, '')), '');
  v_state text := nullif(pg_catalog.upper(pg_catalog.btrim(coalesce(p_state, ''))), '');
  v_zip text := nullif(pg_catalog.btrim(coalesce(p_zip, '')), '');
  v_type text;
  v_name_norm text;
  v_host text;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_match bigint;
  v_org bigint;
  v_reg uuid;
  v_n integer;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);

  v_type := CASE pg_catalog.lower(pg_catalog.btrim(coalesce(p_kind, '')))
    WHEN 'service' THEN 'service_company'
    WHEN 'supplier' THEN 'parts_supplier'
    WHEN 'rental' THEN 'laser_rental'
    WHEN 'clinic' THEN 'laser_clinic'
  END;
  v_name_norm := public.directory_norm_name(v_name);

  -- Invalid input is refused before any rate-limit slot is used.
  IF v_type IS NULL
     OR p_ticket_nonce IS NULL
     OR char_length(v_name) NOT BETWEEN 2 AND 160
     OR coalesce(v_name_norm, '') = ''
     OR v_email IS NULL
     OR (v_ip IS NOT NULL AND char_length(v_ip) > 128)
     OR (v_state IS NOT NULL AND v_state !~ '^[A-Z]{2}$')
     OR (v_zip IS NOT NULL AND v_zip !~ '^[0-9]{5}(-[0-9]{4})?$') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  -- Single-use form ticket.
  DELETE FROM public.directory_form_tickets t
  WHERE t.nonce IN (SELECT x.nonce FROM public.directory_form_tickets x
                    WHERE x.used_at <= v_now - interval '3 hours' FOR UPDATE SKIP LOCKED);
  INSERT INTO public.directory_form_tickets (nonce, used_at) VALUES (p_ticket_nonce, v_now)
  ON CONFLICT (nonce) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'ticket_used');
  END IF;

  -- Rate limit. Expired rows first (skip rows another call is deleting).
  DELETE FROM public.directory_registration_attempts a
  WHERE a.id IN (
    SELECT x.id FROM public.directory_registration_attempts x
    WHERE x.taken_at <= v_now - interval '1 day'
    ORDER BY x.id
    FOR UPDATE SKIP LOCKED
  );

  -- Fixed order (global, ip, email) so two calls can't deadlock.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tsp.dirreg.global', 0));
  IF v_ip IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tsp.dirreg.ip:' || v_ip, 0));
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tsp.dirreg.email:' || v_key, 0));

  -- Global cap: holds even if every request has a different (spoofed) IP.
  IF (SELECT count(*) FROM public.directory_registration_attempts
      WHERE key_kind = 'global' AND taken_at > v_now - interval '1 hour') >= 30
     OR (SELECT count(*) FROM public.directory_registration_attempts
      WHERE key_kind = 'global' AND taken_at > v_now - interval '1 day') >= 100 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  IF (v_ip IS NOT NULL AND (
        (SELECT count(*) FROM public.directory_registration_attempts
         WHERE key_kind = 'ip' AND key_value = v_ip AND taken_at > v_now - interval '10 minutes') >= 5
     OR (SELECT count(*) FROM public.directory_registration_attempts
         WHERE key_kind = 'ip' AND key_value = v_ip AND taken_at > v_now - interval '1 day') >= 20))
     OR (SELECT count(*) FROM public.directory_registration_attempts
         WHERE key_kind = 'email' AND key_value = v_key AND taken_at > v_now - interval '1 day') >= 3 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  IF v_ip IS NOT NULL THEN
    INSERT INTO public.directory_registration_attempts (key_kind, key_value, taken_at) VALUES ('ip', v_ip, v_now);
  END IF;
  INSERT INTO public.directory_registration_attempts (key_kind, key_value, taken_at)
  VALUES ('email', v_key, v_now), ('global', 'all', v_now);

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
    -- No org. Same answer as a new sign-up; step 2 goes onto this row.
    INSERT INTO public.directory_registrations
      (organization_id, matched_organization_id, org_type, status, step, name_norm, email_norm, ip_hash, company_name, details, created_at)
    VALUES (NULL, v_match, v_type, 'possible_duplicate', 1, v_name_norm, v_email, v_ip, v_name,
            pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('state', v_state, 'zip', v_zip)), v_now)
    RETURNING id INTO v_reg;
    RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'created', 'registration_id', v_reg);
  END IF;

  INSERT INTO public.organizations (name, type, email, state, zip, is_active, list_in_directory, is_premium, notes)
  VALUES (v_name, v_type, v_email, v_state, v_zip, false, false, false,
          'Self-registered via the Medical Repair Network directory sign-up (pending review).')
  RETURNING id INTO v_org;

  INSERT INTO public.directory_registrations
    (organization_id, org_type, status, step, name_norm, email_norm, ip_hash, company_name, created_at)
  VALUES (v_org, v_type, 'pending', 1, v_name_norm, v_email, v_ip, v_name, v_now)
  RETURNING id INTO v_reg;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'created', 'registration_id', v_reg);
END;
$$;

CREATE OR REPLACE FUNCTION public.directory_registration_step2(
  p_registration_id uuid,
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
  v_org_id bigint;
  v_match bigint;
  v_brands text[];
  v_terr text[];
  v_spec text[];
  v_clean jsonb;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);

  IF p_registration_id IS NULL OR pg_catalog.jsonb_typeof(f) <> 'object' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  SELECT x.organization_id INTO v_org_id FROM public.directory_registrations x WHERE x.id = p_registration_id;
  IF NOT FOUND THEN
    -- Only signed tokens reach here, so an unknown id is the honeypot decoy. Same answer, nothing written.
    RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'received');
  END IF;

  -- Lock order: organization row, then registration row.
  IF v_org_id IS NOT NULL THEN
    SELECT * INTO o FROM public.organizations WHERE id = v_org_id FOR UPDATE;
  END IF;
  SELECT * INTO r FROM public.directory_registrations WHERE id = p_registration_id FOR UPDATE;

  SELECT coalesce(array_agg(DISTINCT pg_catalog.left(public.directory_clean_text(v), 80))
                  FILTER (WHERE public.directory_clean_text(v) <> ''), '{}')
    INTO v_brands
  FROM (SELECT v FROM pg_catalog.jsonb_array_elements_text(
          CASE WHEN pg_catalog.jsonb_typeof(f->'brands') = 'array' THEN f->'brands' ELSE '[]'::jsonb END) v
        LIMIT 40) s;
  SELECT coalesce(array_agg(DISTINCT pg_catalog.left(public.directory_clean_text(v), 80))
                  FILTER (WHERE public.directory_clean_text(v) <> ''), '{}')
    INTO v_terr
  FROM (SELECT v FROM pg_catalog.jsonb_array_elements_text(
          CASE WHEN pg_catalog.jsonb_typeof(f->'coverage') = 'array' THEN f->'coverage' ELSE '[]'::jsonb END) v
        LIMIT 60) s;
  SELECT coalesce(array_agg(DISTINCT pg_catalog.left(public.directory_clean_text(v), 80))
                  FILTER (WHERE public.directory_clean_text(v) <> ''), '{}')
    INTO v_spec
  FROM (SELECT v FROM pg_catalog.jsonb_array_elements_text(
          CASE WHEN pg_catalog.jsonb_typeof(f->'modalities') = 'array' THEN f->'modalities' ELSE '[]'::jsonb END) v
        LIMIT 40) s;

  -- Allow-listed, cleaned fields (used as-is for a match; mapped to columns for a real org).
  v_clean := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'contact_name', nullif(pg_catalog.left(public.directory_clean_text(f->>'contact_name'), 120), ''),
    'phone', nullif(pg_catalog.left(public.directory_clean_text(f->>'phone'), 40), ''),
    'alt_phone', nullif(pg_catalog.left(public.directory_clean_text(f->>'alt_phone'), 40), ''),
    'website', nullif(pg_catalog.left(public.directory_clean_text(f->>'website'), 200), ''),
    'address', nullif(pg_catalog.left(public.directory_clean_text(f->>'address'), 200), ''),
    'city', nullif(pg_catalog.left(public.directory_clean_text(f->>'city'), 80), ''),
    'state', CASE WHEN pg_catalog.upper(pg_catalog.btrim(coalesce(f->>'state', ''))) ~ '^[A-Z]{2}$'
                  THEN pg_catalog.upper(pg_catalog.btrim(f->>'state')) END,
    'zip', CASE WHEN pg_catalog.btrim(coalesce(f->>'zip', '')) ~ '^[0-9]{5}(-[0-9]{4})?$' THEN pg_catalog.btrim(f->>'zip') END,
    'description', nullif(pg_catalog.left(public.directory_clean_text(f->>'description'), 1000), ''),
    'services_offered', nullif(pg_catalog.left(public.directory_clean_text(f->>'services_offered'), 500), ''),
    'years_in_business', CASE WHEN (f->>'years_in_business') ~ '^[0-9]{1,3}$' THEN (f->>'years_in_business')::integer END,
    'num_techs', CASE WHEN (f->>'num_techs') ~ '^[0-9]{1,4}$' THEN (f->>'num_techs')::integer END,
    'num_locations', CASE WHEN (f->>'num_locations') ~ '^[0-9]{1,4}$' THEN (f->>'num_locations')::integer END,
    'brands', CASE WHEN cardinality(v_brands) > 0 THEN pg_catalog.to_jsonb(v_brands) END,
    'coverage', CASE WHEN cardinality(v_terr) > 0 THEN pg_catalog.to_jsonb(v_terr) END,
    'modalities', CASE WHEN cardinality(v_spec) > 0 THEN pg_catalog.to_jsonb(v_spec) END));

  IF r.step <> 1 OR r.created_at <= pg_catalog.clock_timestamp() - interval '2 hours' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;

  IF r.organization_id IS NULL THEN
    -- Step-1 match: no org exists for this sign-up. Keep the details for review only.
    IF r.status <> 'possible_duplicate' THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'expired');
    END IF;
    UPDATE public.directory_registrations
    SET step = 2, completed_at = pg_catalog.clock_timestamp(), details = coalesce(details, '{}'::jsonb) || v_clean
    WHERE id = r.id;
    RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'received');
  END IF;

  IF o.id IS NULL
     OR r.status <> 'pending'
     OR coalesce(o.is_active, true) <> false
     OR o.list_in_directory <> false
     OR coalesce(o.is_premium, false) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;

  UPDATE public.organizations SET
    contact_name      = coalesce(v_clean->>'contact_name', contact_name),
    phone             = coalesce(v_clean->>'phone', phone),
    alt_phone         = coalesce(v_clean->>'alt_phone', alt_phone),
    website           = coalesce(v_clean->>'website', website),
    address           = coalesce(v_clean->>'address', address),
    city              = coalesce(v_clean->>'city', city),
    state             = coalesce(v_clean->>'state', state),
    zip               = coalesce(v_clean->>'zip', zip),
    description       = coalesce(v_clean->>'description', description),
    services_offered  = coalesce(v_clean->>'services_offered', services_offered),
    years_in_business = coalesce((v_clean->>'years_in_business')::integer, years_in_business),
    num_techs         = coalesce((v_clean->>'num_techs')::integer, num_techs),
    num_locations     = coalesce((v_clean->>'num_locations')::integer, num_locations),
    supported_brands  = CASE WHEN cardinality(v_brands) > 0 THEN v_brands ELSE supported_brands END,
    service_territories = CASE WHEN cardinality(v_terr) > 0 THEN v_terr ELSE service_territories END,
    specialties       = CASE WHEN cardinality(v_spec) > 0 THEN v_spec ELSE specialties END,
    updated_at        = pg_catalog.now()
  WHERE id = o.id;

  SELECT * INTO o FROM public.organizations WHERE id = v_org_id;
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

-- ===================== Review, approval and invites =====================
--
-- Reviewers are the app's platform admins (the /admin/god allowlist,
-- lib/god.ts: GOD_ADMIN_EMAILS / GOD_ADMIN_USER_IDS). The database has no
-- platform-admin role of its own, so these RPCs are service_role only and are
-- called by /api/god/directory after requireGodCaller. The reviewer's auth id
-- and login email are passed in and written to the audit table.
--
-- Approve: list the org (is_active = true, list_in_directory = true; the
-- flags every listed org has; is_premium / plan are never touched) and issue
-- one invite to the registered email:
--   * customer-side types (laser_clinic, laser_rental): a 000923 clinic owner
--     invite. The email of record goes into clinic_claim_emails (only if the
--     clinic has none), the invite into clinic_owner_invites with
--     issued_via = 'directory_review' and no service company. The claim is the
--     unchanged claim_clinic_owner_invite (000924): email of record, confirmed
--     login, one owner, not the inviter, not shop staff. One open invite per
--     clinic still holds (the 000923 partial unique index).
--   * service_company / parts_supplier: a directory_listing_invites row. The
--     claim (claim_directory_listing_invite) seats the first owner only while
--     the org has no members at all.
-- Approval never creates a membership. Ownership happens only when the
-- invited person claims with that confirmed email.
-- Reject: stays unlisted, no invite, no email.
-- Both are idempotent (repeating the same decision is a no-op that reports
-- already = true and issues nothing) and audited in
-- directory_registration_reviews (who, when, what was issued).

ALTER TABLE public.directory_registrations ADD COLUMN IF NOT EXISTS notice_sent_at timestamptz;
ALTER TABLE public.directory_registrations ADD COLUMN IF NOT EXISTS notice_capped boolean NOT NULL DEFAULT false;
ALTER TABLE public.directory_registrations ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.directory_registrations ADD COLUMN IF NOT EXISTS reviewed_by uuid;

CREATE TABLE IF NOT EXISTS public.directory_registration_reviews (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  registration_id uuid NOT NULL REFERENCES public.directory_registrations(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approve', 'reject')),
  reviewer_id uuid NOT NULL,
  reviewer_email text NOT NULL CHECK (char_length(reviewer_email) <= 320),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  result jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS directory_registration_reviews_reg_idx ON public.directory_registration_reviews (registration_id);

CREATE TABLE IF NOT EXISTS public.directory_listing_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1 AND char_length(email) <= 320),
  invited_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by uuid,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS directory_listing_invites_one_open
  ON public.directory_listing_invites (organization_id) WHERE consumed_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.directory_registration_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.directory_listing_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.directory_registration_reviews FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.directory_listing_invites FROM PUBLIC, anon, authenticated, service_role;
DO $$
DECLARE seq text;
BEGIN
  seq := pg_catalog.pg_get_serial_sequence('public.directory_registration_reviews', 'id');
  IF seq IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', seq);
  END IF;
END $$;

-- 000923 invites issued by a directory review have no service company.
ALTER TABLE public.clinic_owner_invites ADD COLUMN IF NOT EXISTS issued_via text NOT NULL DEFAULT 'shop';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conname = 'clinic_owner_invites_issued_via_check'
                   AND conrelid = 'public.clinic_owner_invites'::regclass) THEN
    ALTER TABLE public.clinic_owner_invites ADD CONSTRAINT clinic_owner_invites_issued_via_check
      CHECK ((issued_via = 'shop' AND service_organization_id IS NOT NULL)
          OR (issued_via = 'directory_review' AND service_organization_id IS NULL));
  END IF;
END $$;
ALTER TABLE public.clinic_owner_invites ALTER COLUMN service_organization_id DROP NOT NULL;

-- Review notice, once per registration, capped at 6 per hour across everyone.
-- Over the cap the registration is marked (notice_capped) and gets no email
-- of its own; the next notice that goes out says how many were held back.
-- Everything is always on the review page. Returns the payload or {ok:false}.
CREATE OR REPLACE FUNCTION public.directory_registration_take_notice(p_registration_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r public.directory_registrations%ROWTYPE;
  o public.organizations%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_last timestamptz;
  v_held integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tsp.dirreg.notice', 0));
  SELECT * INTO r FROM public.directory_registrations WHERE id = p_registration_id FOR UPDATE;
  IF r.id IS NULL OR r.notice_sent_at IS NOT NULL OR r.step <> 2 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false);
  END IF;
  IF (SELECT count(*) FROM public.directory_registrations
      WHERE notice_sent_at > v_now - interval '1 hour' AND NOT notice_capped) >= 6 THEN
    UPDATE public.directory_registrations SET notice_sent_at = v_now, notice_capped = true WHERE id = r.id;
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'capped');
  END IF;
  SELECT max(notice_sent_at) INTO v_last FROM public.directory_registrations WHERE notice_sent_at IS NOT NULL AND NOT notice_capped;
  SELECT count(*) INTO v_held FROM public.directory_registrations
  WHERE notice_capped AND (v_last IS NULL OR notice_sent_at > v_last);
  UPDATE public.directory_registrations SET notice_sent_at = v_now WHERE id = r.id;
  IF r.organization_id IS NOT NULL THEN
    SELECT * INTO o FROM public.organizations WHERE id = r.organization_id;
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'registration_id', r.id,
    'company', coalesce(o.name, r.company_name),
    'org_type', r.org_type,
    'contact_name', coalesce(o.contact_name, r.details->>'contact_name'),
    'email', r.email_norm,
    'city', coalesce(o.city, r.details->>'city'),
    'state', coalesce(o.state, r.details->>'state'),
    'status', r.status,
    'held_back', v_held);
END;
$$;

CREATE OR REPLACE FUNCTION public.directory_registrations_for_review(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(pg_catalog.jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb)
  FROM (
    SELECT r.id, r.status, r.step, r.org_type, r.email_norm AS email, false AS email_verified,
           r.created_at, r.completed_at, r.reviewed_at, r.organization_id,
           coalesce(o.name, r.company_name) AS name,
           coalesce(o.contact_name, r.details->>'contact_name') AS contact_name,
           coalesce(o.phone, r.details->>'phone') AS phone,
           coalesce(o.website, r.details->>'website') AS website,
           coalesce(o.city, r.details->>'city') AS city,
           coalesce(o.state, r.details->>'state') AS state,
           coalesce(o.zip, r.details->>'zip') AS zip,
           o.supported_brands, o.specialties, o.service_territories,
           r.details,
           r.matched_organization_id, m.name AS matched_name, m.type AS matched_type,
           (r.matched_organization_id IS NOT NULL) AS possible_duplicate
    FROM public.directory_registrations r
    LEFT JOIN public.organizations o ON o.id = r.organization_id
    LEFT JOIN public.organizations m ON m.id = r.matched_organization_id
    WHERE r.status IN ('pending', 'possible_duplicate')
    ORDER BY r.created_at DESC
    LIMIT least(greatest(coalesce(p_limit, 200), 1), 500)
  ) x
$$;

CREATE OR REPLACE FUNCTION public.directory_registration_review(
  p_registration_id uuid,
  p_decision text,
  p_reviewer_id uuid,
  p_reviewer_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_decision text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_decision, '')));
  v_reviewer_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_reviewer_email, '')));
  v_org_id bigint;
  r public.directory_registrations%ROWTYPE;
  o public.organizations%ROWTYPE;
  v_target text;
  v_record text;
  v_invite uuid;
  v_skip text;
  v_kind text;
  v_result jsonb;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
  IF p_registration_id IS NULL OR p_reviewer_id IS NULL
     OR v_decision NOT IN ('approve', 'reject')
     OR char_length(v_reviewer_email) NOT BETWEEN 3 AND 320 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid');
  END IF;

  -- Lock order (same as 000923/000924 issue and claim): clinic/org row, then
  -- the per-clinic advisory lock, then invite rows. The registration row is
  -- locked after the org row, as in step 2.
  SELECT x.organization_id INTO v_org_id FROM public.directory_registrations x WHERE x.id = p_registration_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF v_org_id IS NOT NULL THEN
    SELECT * INTO o FROM public.organizations WHERE id = v_org_id FOR UPDATE;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tsp.clinic_owner:' || v_org_id::text, 0));
  END IF;
  SELECT * INTO r FROM public.directory_registrations WHERE id = p_registration_id FOR UPDATE;

  v_target := CASE v_decision WHEN 'approve' THEN 'approved' ELSE 'rejected' END;
  IF r.status = v_target THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'status', r.status, 'already', true);
  END IF;
  IF r.status NOT IN ('pending', 'possible_duplicate') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'already_decided', 'status', r.status);
  END IF;

  IF v_decision = 'reject' THEN
    UPDATE public.directory_registrations
    SET status = 'rejected', reviewed_at = pg_catalog.clock_timestamp(), reviewed_by = p_reviewer_id
    WHERE id = r.id;
    v_result := pg_catalog.jsonb_build_object('ok', true, 'status', 'rejected', 'already', false);
    INSERT INTO public.directory_registration_reviews (registration_id, decision, reviewer_id, reviewer_email, result)
    VALUES (r.id, 'reject', p_reviewer_id, v_reviewer_email, v_result);
    RETURN v_result;
  END IF;

  -- Approve.
  IF o.id IS NULL THEN
    -- Step-1 duplicate: no org was created. Nothing to list.
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'no_org');
  END IF;
  IF coalesce(o.is_premium, false) OR o.type IS DISTINCT FROM r.org_type THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'org_changed');
  END IF;

  UPDATE public.organizations
  SET is_active = true, list_in_directory = true, updated_at = pg_catalog.now()
  WHERE id = o.id;

  IF public.clinic_is_customer_side(o.id) THEN
    v_kind := 'clinic_owner';
    SELECT ce.email INTO v_record FROM public.clinic_claim_emails ce WHERE ce.customer_organization_id = o.id;
    IF public.clinic_owner_slot_taken(o.id, NULL) THEN
      v_skip := 'owner_exists';
    ELSIF v_record IS NOT NULL AND v_record <> r.email_norm THEN
      v_skip := 'email_of_record_differs';
    ELSIF EXISTS (SELECT 1 FROM public.clinic_owner_invites i
                  WHERE i.customer_organization_id = o.id AND i.consumed_at IS NULL AND i.revoked_at IS NULL
                    AND i.expires_at > pg_catalog.now()) THEN
      v_skip := 'invite_open';
    ELSE
      IF v_record IS NULL THEN
        INSERT INTO public.clinic_claim_emails (customer_organization_id, email, recorded_by, recorded_via)
        VALUES (o.id, r.email_norm, p_reviewer_id, 'first_invite');
      END IF;
      -- An expired open invite would block the one-open index; close it first.
      UPDATE public.clinic_owner_invites i SET revoked_at = pg_catalog.now(), revoked_reason = 'expired'
      WHERE i.customer_organization_id = o.id AND i.consumed_at IS NULL AND i.revoked_at IS NULL
        AND i.expires_at <= pg_catalog.now();
      INSERT INTO public.clinic_owner_invites
        (customer_organization_id, service_organization_id, email, invited_by, confirmed_out_of_band, expires_at, issued_via)
      VALUES (o.id, NULL, r.email_norm, p_reviewer_id, false, pg_catalog.now() + interval '30 days', 'directory_review')
      RETURNING id INTO v_invite;
    END IF;
  ELSE
    v_kind := 'listing';
    IF EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.organization_id = o.id) THEN
      v_skip := 'org_has_members';
    ELSIF EXISTS (SELECT 1 FROM public.directory_listing_invites i
                  WHERE i.organization_id = o.id AND i.consumed_at IS NULL AND i.revoked_at IS NULL
                    AND i.expires_at > pg_catalog.now()) THEN
      v_skip := 'invite_open';
    ELSE
      UPDATE public.directory_listing_invites i SET revoked_at = pg_catalog.now()
      WHERE i.organization_id = o.id AND i.consumed_at IS NULL AND i.revoked_at IS NULL;
      INSERT INTO public.directory_listing_invites (organization_id, email, invited_by, expires_at)
      VALUES (o.id, r.email_norm, p_reviewer_id, pg_catalog.now() + interval '30 days')
      RETURNING id INTO v_invite;
    END IF;
  END IF;

  UPDATE public.directory_registrations
  SET status = 'approved', reviewed_at = pg_catalog.clock_timestamp(), reviewed_by = p_reviewer_id
  WHERE id = r.id;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true, 'status', 'approved', 'already', false,
    'organization_id', o.id, 'organization_name', o.name, 'contact_name', o.contact_name,
    'invite_kind', v_kind, 'invite_id', v_invite, 'invite_email', CASE WHEN v_invite IS NOT NULL THEN r.email_norm END,
    'invite_skipped', v_skip);
  INSERT INTO public.directory_registration_reviews (registration_id, decision, reviewer_id, reviewer_email, result)
  VALUES (r.id, 'approve', p_reviewer_id, v_reviewer_email, v_result);
  RETURN v_result;
END;
$$;

-- First owner of an approved service_company / parts_supplier listing.
CREATE OR REPLACE FUNCTION public.claim_directory_listing_invite(
  p_invite_id uuid,
  p_user_id uuid,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  inv public.directory_listing_invites%ROWTYPE;
  v_org_id bigint;
  o public.organizations%ROWTYPE;
  v_auth_email text;
  v_confirmed timestamptz;
  v_profile_exists boolean;
  v_profile_org bigint;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
  IF p_invite_id IS NULL OR p_user_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invite_invalid');
  END IF;
  SELECT i.organization_id INTO v_org_id FROM public.directory_listing_invites i WHERE i.id = p_invite_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invite_invalid');
  END IF;
  SELECT * INTO o FROM public.organizations WHERE id = v_org_id FOR UPDATE;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tsp.clinic_owner:' || v_org_id::text, 0));
  SELECT * INTO inv FROM public.directory_listing_invites i WHERE i.id = p_invite_id FOR UPDATE;

  IF inv.consumed_at IS NOT NULL THEN
    IF inv.consumed_by = p_user_id AND EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = p_user_id AND m.organization_id = o.id AND pg_catalog.lower(m.role) = 'owner') THEN
      RETURN pg_catalog.jsonb_build_object('ok', true, 'organization_id', o.id, 'already_linked', true);
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invite_used');
  END IF;
  IF inv.revoked_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invite_revoked');
  END IF;
  IF inv.expires_at <= pg_catalog.now() THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invite_expired');
  END IF;
  IF o.id IS NULL OR o.type NOT IN ('service_company', 'parts_supplier')
     OR NOT EXISTS (SELECT 1 FROM public.directory_registrations r
                    WHERE r.organization_id = o.id AND r.status = 'approved') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_listing');
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(u.email)), u.email_confirmed_at INTO v_auth_email, v_confirmed
  FROM auth.users u WHERE u.id = p_user_id;
  IF v_auth_email IS NULL OR v_auth_email <> inv.email THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'email_mismatch');
  END IF;
  IF v_confirmed IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'email_unconfirmed');
  END IF;
  IF p_user_id = inv.invited_by THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'inviter');
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.organization_id = o.id)
     OR EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.organization_id = o.id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'owner_exists');
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.user_id = p_user_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'other_org');
  END IF;
  SELECT true, p.organization_id INTO v_profile_exists, v_profile_org
  FROM public.user_profiles p WHERE p.id = p_user_id FOR UPDATE;
  IF v_profile_org IS NOT NULL AND v_profile_org <> o.id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'other_org');
  END IF;

  UPDATE public.directory_listing_invites SET consumed_at = pg_catalog.now(), consumed_by = p_user_id WHERE id = inv.id;

  IF coalesce(v_profile_exists, false) THEN
    UPDATE public.user_profiles p
    SET organization_id = o.id, role = 'owner', onboarding_completed = true, email = v_auth_email,
        first_name = coalesce(p.first_name, nullif(pg_catalog.btrim(coalesce(p_first_name, '')), '')),
        last_name = coalesce(p.last_name, nullif(pg_catalog.btrim(coalesce(p_last_name, '')), ''))
    WHERE p.id = p_user_id;
  ELSE
    INSERT INTO public.user_profiles (id, email, first_name, last_name, role, organization_id, onboarding_completed)
    VALUES (p_user_id, v_auth_email, nullif(pg_catalog.btrim(coalesce(p_first_name, '')), ''),
            nullif(pg_catalog.btrim(coalesce(p_last_name, '')), ''), 'owner', o.id, true);
  END IF;
  PERFORM public.set_home_membership(p_user_id, o.id, 'owner', true);

  IF (SELECT count(*) FROM public.organization_memberships m WHERE m.organization_id = o.id) <> 1 THEN
    RAISE EXCEPTION 'listing claim left an unexpected membership count' USING ERRCODE = 'P0001';
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'organization_id', o.id, 'already_linked', false);
END;
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.directory_clean_text(text)',
    'public.directory_norm_name(text)',
    'public.directory_email_clean(text)',
    'public.directory_email_key(text)',
    'public.directory_norm_host(text)',
    'public.directory_norm_phone(text)',
    'public.directory_is_free_mail(text)',
    'public.directory_find_duplicate(text, text, text, bigint)',
    'public.directory_registration_step1(text, text, text, text, text, text, uuid)',
    'public.directory_registration_step2(uuid, jsonb)',
    'public.directory_registration_take_notice(uuid)',
    'public.directory_registrations_for_review(integer)',
    'public.directory_registration_review(uuid, text, uuid, text)',
    'public.claim_directory_listing_invite(uuid, uuid, text, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
