-- 000976: optional fax and street line 2.
--
-- Fax sits beside each stored phone. address_line2 sits beside each street
-- line (organizations.address, locations.address, sites.address,
-- user_profiles.address_line1, and the denormalized copies on tickets and
-- reports). Both are nullable text. Empty strings are rejected; fax must
-- match the directory phone shape (7-20 digits, phone punctuation, optional
-- extension, 50 characters). Line 2 is capped at 200 characters.
--
-- organizations SELECT is per column (000932). fax and address_line2 are
-- granted like phone and address. Private columns are not touched.
-- public_service_org_profile and public_directory_page do not return phone
-- or street, so they are not widened.
--
-- RPCs that already list phone/address gain the new fields:
--   find_clinic_prospects, directory_registration_step2,
--   directory_registrations_for_review, create_shop_customer_org.
-- Prior function bodies are saved in migration_000976_function_backup so the
-- rollback can restore them byte for byte. That table is service-role only.
--
-- Do not apply on live until Larry says so. Apply this file before the app
-- deploy that writes the new columns. Rollback:
--   20261124_000976_fax_address_line2_rollback.sql
--
-- Safe to re-run. Does not UPDATE any organization row.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fax_phone_ok(p text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p IS NULL
    OR (
      p = btrim(p)
      AND p <> ''
      AND char_length(p) <= 50
      AND char_length(pg_catalog.regexp_replace(p, '[^0-9]', '', 'g')) BETWEEN 7 AND 20
      AND p ~* '^[0-9+().[:space:]-]+([[:space:]]*(x|ext\.?)[[:space:]]*[0-9]{1,6})?$'
    );
$$;

COMMENT ON FUNCTION public.fax_phone_ok(text) IS
  '000976: directory phone shape. NULL is valid. Used by fax CHECK constraints.';

REVOKE ALL ON FUNCTION public.fax_phone_ok(text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Columns. One fax per phone-bearing entity. One line 2 per street.
-- Snapshot phones (customer / tech company / tech) each get their own fax.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  spec text[][] := ARRAY[
    ARRAY['organizations', 'fax'],
    ARRAY['organizations', 'address_line2'],
    ARRAY['contacts', 'fax'],
    ARRAY['locations', 'fax'],
    ARRAY['locations', 'address_line2'],
    ARRAY['sites', 'address_line2'],
    ARRAY['user_profiles', 'fax'],
    ARRAY['user_profiles', 'address_line2'],
    ARRAY['service_reports', 'customer_fax'],
    ARRAY['service_reports', 'tech_company_fax'],
    ARRAY['service_reports', 'tech_fax'],
    ARRAY['service_reports', 'customer_address_line2'],
    ARRAY['service_reports', 'tech_company_address_line2'],
    ARRAY['service_tickets', 'customer_fax'],
    ARRAY['service_tickets', 'address_line2'],
    ARRAY['service_tickets', 'customer_address_line2'],
    ARRAY['clinic_service_leads', 'fax']
  ];
  pair text[];
  t text;
BEGIN
  FOREACH pair SLICE 1 IN ARRAY spec LOOP
    IF to_regclass('public.' || pair[1]) IS NULL THEN
      RAISE EXCEPTION '000976 drift: public.% is missing', pair[1];
    END IF;
    SELECT data_type INTO t FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = pair[1] AND column_name = pair[2];
    IF t IS NOT NULL AND t <> 'text' THEN
      RAISE EXCEPTION '000976 drift: %.% exists as %', pair[1], pair[2], t;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS fax text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS address_line2 text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS fax text;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS fax text;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS address_line2 text;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS address_line2 text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS fax text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS address_line2 text;
ALTER TABLE public.service_reports ADD COLUMN IF NOT EXISTS customer_fax text;
ALTER TABLE public.service_reports ADD COLUMN IF NOT EXISTS tech_company_fax text;
ALTER TABLE public.service_reports ADD COLUMN IF NOT EXISTS tech_fax text;
ALTER TABLE public.service_reports ADD COLUMN IF NOT EXISTS customer_address_line2 text;
ALTER TABLE public.service_reports ADD COLUMN IF NOT EXISTS tech_company_address_line2 text;
ALTER TABLE public.service_tickets ADD COLUMN IF NOT EXISTS customer_fax text;
ALTER TABLE public.service_tickets ADD COLUMN IF NOT EXISTS address_line2 text;
ALTER TABLE public.service_tickets ADD COLUMN IF NOT EXISTS customer_address_line2 text;
ALTER TABLE public.clinic_service_leads ADD COLUMN IF NOT EXISTS fax text;

COMMENT ON COLUMN public.organizations.fax IS '000976: optional fax. Same shape as phone. NULL when absent.';
COMMENT ON COLUMN public.organizations.address_line2 IS '000976: optional suite/unit/floor under organizations.address.';
COMMENT ON COLUMN public.contacts.fax IS '000976: optional fax for this contact.';
COMMENT ON COLUMN public.locations.fax IS '000976: optional fax for this location.';
COMMENT ON COLUMN public.locations.address_line2 IS '000976: optional suite/unit/floor under locations.address.';
COMMENT ON COLUMN public.sites.address_line2 IS '000976: optional suite/unit/floor under sites.address.';
COMMENT ON COLUMN public.user_profiles.fax IS '000976: optional fax beside user_profiles.phone.';
COMMENT ON COLUMN public.user_profiles.address_line2 IS '000976: optional suite/unit/floor under address_line1.';
COMMENT ON COLUMN public.service_reports.customer_fax IS '000976: snapshot of the customer fax.';
COMMENT ON COLUMN public.service_reports.tech_company_fax IS '000976: snapshot of the service company fax.';
COMMENT ON COLUMN public.service_reports.tech_fax IS '000976: snapshot of the technician fax.';
COMMENT ON COLUMN public.service_reports.customer_address_line2 IS '000976: snapshot of the customer street line 2.';
COMMENT ON COLUMN public.service_reports.tech_company_address_line2 IS '000976: snapshot of the service company street line 2.';
COMMENT ON COLUMN public.service_tickets.customer_fax IS '000976: denormalized customer fax.';
COMMENT ON COLUMN public.service_tickets.address_line2 IS '000976: suite/unit under service_tickets.address.';
COMMENT ON COLUMN public.service_tickets.customer_address_line2 IS '000976: suite/unit under customer_address.';
COMMENT ON COLUMN public.clinic_service_leads.fax IS '000976: optional fax from the find-a-rep form.';

DO $$
DECLARE
  fax_cols text[][] := ARRAY[
    ARRAY['organizations', 'fax', 'organizations_fax_phone_ok'],
    ARRAY['contacts', 'fax', 'contacts_fax_phone_ok'],
    ARRAY['locations', 'fax', 'locations_fax_phone_ok'],
    ARRAY['user_profiles', 'fax', 'user_profiles_fax_phone_ok'],
    ARRAY['service_reports', 'customer_fax', 'service_reports_customer_fax_phone_ok'],
    ARRAY['service_reports', 'tech_company_fax', 'service_reports_tech_company_fax_phone_ok'],
    ARRAY['service_reports', 'tech_fax', 'service_reports_tech_fax_phone_ok'],
    ARRAY['service_tickets', 'customer_fax', 'service_tickets_customer_fax_phone_ok'],
    ARRAY['clinic_service_leads', 'fax', 'clinic_service_leads_fax_phone_ok']
  ];
  line_cols text[][] := ARRAY[
    ARRAY['organizations', 'address_line2', 'organizations_address_line2_len'],
    ARRAY['locations', 'address_line2', 'locations_address_line2_len'],
    ARRAY['sites', 'address_line2', 'sites_address_line2_len'],
    ARRAY['user_profiles', 'address_line2', 'user_profiles_address_line2_len'],
    ARRAY['service_reports', 'customer_address_line2', 'service_reports_customer_address_line2_len'],
    ARRAY['service_reports', 'tech_company_address_line2', 'service_reports_tech_company_address_line2_len'],
    ARRAY['service_tickets', 'address_line2', 'service_tickets_address_line2_len'],
    ARRAY['service_tickets', 'customer_address_line2', 'service_tickets_customer_address_line2_len']
  ];
  pair text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY fax_cols LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', pair[1], pair[3]);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (public.fax_phone_ok(%I))',
      pair[1], pair[3], pair[2]
    );
  END LOOP;
  FOREACH pair SLICE 1 IN ARRAY line_cols LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', pair[1], pair[3]);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I IS NULL OR (%I = btrim(%I) AND %I <> '''' AND char_length(%I) <= 200))',
      pair[1], pair[3], pair[2], pair[2], pair[2], pair[2], pair[2]
    );
  END LOOP;
END $$;

-- Column privileges follow the column they sit beside. New columns do not
-- inherit organizations' column SELECT, or INSERT/UPDATE where that privilege
-- is per column (organizations, user_profiles, contacts, sites).
GRANT SELECT (fax, address_line2) ON public.organizations TO anon, authenticated;
GRANT INSERT (fax, address_line2), UPDATE (fax, address_line2) ON public.organizations TO authenticated;

GRANT INSERT (fax, address_line2), UPDATE (fax, address_line2) ON public.user_profiles TO authenticated;

GRANT UPDATE (fax) ON public.contacts TO authenticated;
GRANT UPDATE (address_line2) ON public.sites TO authenticated;

-- ---------------------------------------------------------------------------
-- Save prior RPC bodies once, then extend the explicit phone/address lists.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.migration_000976_function_backup (
  proname text PRIMARY KEY,
  identity_args text NOT NULL,
  def text NOT NULL
);

COMMENT ON TABLE public.migration_000976_function_backup IS
  '000976: pre-patch pg_get_functiondef for the rollback. No client access.';

ALTER TABLE public.migration_000976_function_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.migration_000976_function_backup FROM PUBLIC, anon, authenticated;

INSERT INTO public.migration_000976_function_backup (proname, identity_args, def)
SELECT p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid), pg_catalog.pg_get_functiondef(p.oid)
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = ANY (ARRAY[
    'find_clinic_prospects',
    'directory_registration_step2',
    'directory_registrations_for_review',
    'create_shop_customer_org'
  ])
ON CONFLICT (proname) DO NOTHING;

DO $patch$
DECLARE
  r record;
  src text;
  nxt text;
BEGIN
  FOR r IN
    SELECT p.proname, pg_catalog.pg_get_functiondef(p.oid) AS def
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'find_clinic_prospects',
        'directory_registration_step2',
        'directory_registrations_for_review',
        'create_shop_customer_org'
      ])
  LOOP
    src := r.def;
    nxt := src;

    IF r.proname = 'find_clinic_prospects' THEN
      IF position('''fax'', o.fax' IN nxt) = 0 THEN
        IF position('''phone'', o.phone,' IN nxt) = 0 OR position('''address'', o.address, ''city'', o.city,' IN nxt) = 0 THEN
          RAISE EXCEPTION '000976: find_clinic_prospects is missing the phone/address list';
        END IF;
        nxt := replace(nxt,
          '''address'', o.address, ''city'', o.city,',
          '''address'', o.address, ''address_line2'', o.address_line2, ''city'', o.city,');
        nxt := replace(nxt,
          '''phone'', o.phone,',
          '''phone'', o.phone, ''fax'', o.fax,');
      END IF;

    ELSIF r.proname = 'directory_registration_step2' THEN
      IF position('v_clean->>''fax''' IN nxt) = 0 THEN
        IF position('''phone'', nullif(pg_catalog.left(public.directory_clean_text(f->>''phone''), 40), ''''),' IN nxt) = 0
           OR position('phone             = coalesce(v_clean->>''phone'', phone),' IN nxt) = 0
           OR position('address           = coalesce(v_clean->>''address'', address),' IN nxt) = 0 THEN
          RAISE EXCEPTION '000976: directory_registration_step2 is missing the phone/address list';
        END IF;
        nxt := replace(nxt,
          '''phone'', nullif(pg_catalog.left(public.directory_clean_text(f->>''phone''), 40), ''''),' || E'\n' ||
          '    ''alt_phone'', nullif(pg_catalog.left(public.directory_clean_text(f->>''alt_phone''), 40), ''''),',
          '''phone'', nullif(pg_catalog.left(public.directory_clean_text(f->>''phone''), 40), ''''),' || E'\n' ||
          '    ''fax'', CASE WHEN public.fax_phone_ok(nullif(pg_catalog.left(public.directory_clean_text(f->>''fax''), 50), '''')) THEN pg_catalog.left(public.directory_clean_text(f->>''fax''), 50) END,' || E'\n' ||
          '    ''alt_phone'', nullif(pg_catalog.left(public.directory_clean_text(f->>''alt_phone''), 40), ''''),');
        nxt := replace(nxt,
          '''address'', nullif(pg_catalog.left(public.directory_clean_text(f->>''address''), 200), ''''),' || E'\n' ||
          '    ''city'', nullif(pg_catalog.left(public.directory_clean_text(f->>''city''), 80), ''''),',
          '''address'', nullif(pg_catalog.left(public.directory_clean_text(f->>''address''), 200), ''''),' || E'\n' ||
          '    ''address_line2'', nullif(pg_catalog.left(public.directory_clean_text(f->>''address_line2''), 200), ''''),' || E'\n' ||
          '    ''city'', nullif(pg_catalog.left(public.directory_clean_text(f->>''city''), 80), ''''),');
        nxt := replace(nxt,
          'phone             = coalesce(v_clean->>''phone'', phone),',
          'phone             = coalesce(v_clean->>''phone'', phone),' || E'\n' ||
          '    fax               = coalesce(v_clean->>''fax'', fax),');
        nxt := replace(nxt,
          'address           = coalesce(v_clean->>''address'', address),',
          'address           = coalesce(v_clean->>''address'', address),' || E'\n' ||
          '    address_line2     = coalesce(v_clean->>''address_line2'', address_line2),');
      END IF;

    ELSIF r.proname = 'directory_registrations_for_review' THEN
      IF position('AS fax' IN nxt) = 0 THEN
        IF position('coalesce(o.phone, r.details->>''phone'') AS phone,' IN nxt) = 0 THEN
          RAISE EXCEPTION '000976: directory_registrations_for_review is missing the phone column';
        END IF;
        nxt := replace(nxt,
          'coalesce(o.phone, r.details->>''phone'') AS phone,',
          'coalesce(o.phone, r.details->>''phone'') AS phone,' || E'\n' ||
          '           coalesce(o.fax, r.details->>''fax'') AS fax,');
      END IF;

    ELSIF r.proname = 'create_shop_customer_org' THEN
      IF position('p_fax text' IN nxt) = 0 THEN
        IF position('p_facility_type text DEFAULT ''Clinic''::text)' IN nxt) = 0
           OR position('INSERT INTO public.organizations (name, type, created_by, address, city, state, phone, laser_models, facility_type)' IN nxt) = 0 THEN
          RAISE EXCEPTION '000976: create_shop_customer_org is missing the address/phone insert';
        END IF;
        nxt := replace(nxt,
          'p_facility_type text DEFAULT ''Clinic''::text)',
          'p_facility_type text DEFAULT ''Clinic''::text, p_fax text DEFAULT NULL::text, p_address_line2 text DEFAULT NULL::text)');
        nxt := replace(nxt,
          'INSERT INTO public.organizations (name, type, created_by, address, city, state, phone, laser_models, facility_type)',
          'IF nullif(btrim(coalesce(p_fax, '''')), '''') IS NOT NULL AND NOT public.fax_phone_ok(btrim(p_fax)) THEN' || E'\n' ||
          '    RAISE EXCEPTION ''fax must look like a phone number'' USING ERRCODE = ''22023'';' || E'\n' ||
          '  END IF;' || E'\n' ||
          '  IF char_length(btrim(coalesce(p_address_line2, ''''))) > 200 THEN' || E'\n' ||
          '    RAISE EXCEPTION ''address line 2 is too long (200 characters)'' USING ERRCODE = ''22001'';' || E'\n' ||
          '  END IF;' || E'\n' ||
          '  INSERT INTO public.organizations (name, type, created_by, address, address_line2, city, state, phone, fax, laser_models, facility_type)');
        nxt := replace(nxt,
          'nullif(btrim(coalesce(p_address, '''')), ''''),' || E'\n' ||
          '    nullif(btrim(coalesce(p_city, '''')), ''''),',
          'nullif(btrim(coalesce(p_address, '''')), ''''),' || E'\n' ||
          '    nullif(btrim(coalesce(p_address_line2, '''')), ''''),' || E'\n' ||
          '    nullif(btrim(coalesce(p_city, '''')), ''''),');
        nxt := replace(nxt,
          'nullif(btrim(coalesce(p_phone, '''')), ''''),' || E'\n' ||
          '    nullif(btrim(coalesce(p_laser_models, '''')), ''''),',
          'nullif(btrim(coalesce(p_phone, '''')), ''''),' || E'\n' ||
          '    nullif(btrim(coalesce(p_fax, '''')), ''''),' || E'\n' ||
          '    nullif(btrim(coalesce(p_laser_models, '''')), ''''),');
      END IF;
    END IF;

    IF nxt IS DISTINCT FROM src THEN
      EXECUTE nxt;
    END IF;
  END LOOP;
END
$patch$;

DO $$
BEGIN
  IF to_regprocedure('public.create_shop_customer_org(bigint,text,text,text,text,text,text,text,text,text)') IS NOT NULL
     AND to_regprocedure('public.create_shop_customer_org(bigint,text,text,text,text,text,text,text)') IS NOT NULL THEN
    DROP FUNCTION public.create_shop_customer_org(bigint, text, text, text, text, text, text, text);
  END IF;
  IF to_regprocedure('public.create_shop_customer_org(bigint,text,text,text,text,text,text,text,text,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.create_shop_customer_org(bigint, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_shop_customer_org(bigint, text, text, text, text, text, text, text, text, text) TO authenticated, service_role';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
