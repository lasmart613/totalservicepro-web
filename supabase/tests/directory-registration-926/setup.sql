DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
-- Prod organizations columns (read-only copy of information_schema on 2026-10-18).
CREATE TABLE public.organizations (
  id bigserial PRIMARY KEY, name text NOT NULL, type text NOT NULL,
  address text, city text, state text, zip text, phone text, email text, website text, notes text,
  is_active boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  ticket_prefix character(3), logo_url text, description text, years_in_business integer,
  supported_brands text[] DEFAULT '{}', service_territories text[] DEFAULT '{}', customer_rating numeric,
  biz_type text, specialties text[] DEFAULT '{}', created_by uuid, services_offered text, num_techs integer,
  tax_id text, num_laser_systems integer, laser_models text, facility_type text, preferred_services text,
  is_premium boolean DEFAULT false, bio text, slogan text, alt_phone text, num_locations integer,
  contact_name text, manual_slots integer, subscription_tier text DEFAULT 'free',
  list_in_directory boolean NOT NULL DEFAULT false, plan text, premium_until timestamptz, premium_grant text,
  directory_contacts jsonb, storefront_enabled boolean NOT NULL DEFAULT false, storefront_slug text,
  storefront_bio text, brand_primary_color text, brand_accent_color text, currency_code text DEFAULT 'USD',
  number_format text, timezone text, stripe_account_id text,
  stripe_charges_enabled boolean NOT NULL DEFAULT false, stripe_payouts_enabled boolean NOT NULL DEFAULT false,
  stripe_details_submitted boolean NOT NULL DEFAULT false, trial_granted_at timestamptz, creator_shop_org_id bigint,
  CONSTRAINT organizations_type_check CHECK (type = ANY (ARRAY['service_company','vendor','parts_supplier','customer','laser_clinic','laser_rental','laser_reseller']))
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organizations FROM PUBLIC;
GRANT SELECT ON public.organizations TO anon, authenticated;
GRANT ALL ON public.organizations TO service_role;
-- Prod trigger body (organizations_guard_privilege, verbatim INSERT branch subset is enough: uid is null here).
CREATE OR REPLACE FUNCTION public.organizations_guard_privilege() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN IF auth.uid() IS NULL THEN RETURN NEW; END IF; RAISE EXCEPTION 'client write'; END; $$;
CREATE TRIGGER organizations_guard_privilege BEFORE INSERT OR UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.organizations_guard_privilege();
INSERT INTO public.organizations (name, type, email, website, phone, is_active, list_in_directory) VALUES
 ('Acme Laser Service, Inc.', 'service_company', 'ops@acmelaser.com', NULL, '(805) 555-0100', true, true),
 ('Beta Medical Parts', 'parts_supplier', 'sales@gmail.com', 'https://www.betaparts.com/contact', NULL, true, true),
 ('Gamma Rentals', 'laser_rental', NULL, NULL, '+1 602-555-0199', true, false);
