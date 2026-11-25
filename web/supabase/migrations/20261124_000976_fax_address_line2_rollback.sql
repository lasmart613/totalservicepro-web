-- Roll 000976 back. Restores the saved RPC bodies byte for byte, then
-- drops the fax / address_line2 columns, checks, and helper. Safe to re-run.
-- Does not UPDATE any organization row.

SET lock_timeout = '5s';

DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.migration_000976_function_backup') IS NULL THEN
    RETURN;
  END IF;
  -- The widened shop-customer RPC is a new signature. Drop it before the
  -- saved 8-argument body is created again.
  DROP FUNCTION IF EXISTS public.create_shop_customer_org(bigint, text, text, text, text, text, text, text, text, text);
  FOR r IN
    SELECT def FROM public.migration_000976_function_backup ORDER BY proname
  LOOP
    EXECUTE r.def;
  END LOOP;
END $$;

-- create_shop_customer_org is dropped and recreated from the saved body, so
-- its grants come back as a new function. Restore the 000919 grants.
DO $$
BEGIN
  IF to_regprocedure('public.create_shop_customer_org(bigint,text,text,text,text,text,text,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.create_shop_customer_org(bigint, text, text, text, text, text, text, text) FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_shop_customer_org(bigint, text, text, text, text, text, text, text) TO authenticated, service_role';
  END IF;
END $$;

DROP TABLE IF EXISTS public.migration_000976_function_backup;

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_fax_phone_ok;
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_address_line2_len;
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_fax_phone_ok;
ALTER TABLE public.locations DROP CONSTRAINT IF EXISTS locations_fax_phone_ok;
ALTER TABLE public.locations DROP CONSTRAINT IF EXISTS locations_address_line2_len;
ALTER TABLE public.sites DROP CONSTRAINT IF EXISTS sites_address_line2_len;
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_fax_phone_ok;
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_address_line2_len;
ALTER TABLE public.service_reports DROP CONSTRAINT IF EXISTS service_reports_customer_fax_phone_ok;
ALTER TABLE public.service_reports DROP CONSTRAINT IF EXISTS service_reports_tech_company_fax_phone_ok;
ALTER TABLE public.service_reports DROP CONSTRAINT IF EXISTS service_reports_tech_fax_phone_ok;
ALTER TABLE public.service_reports DROP CONSTRAINT IF EXISTS service_reports_customer_address_line2_len;
ALTER TABLE public.service_reports DROP CONSTRAINT IF EXISTS service_reports_tech_company_address_line2_len;
ALTER TABLE public.service_tickets DROP CONSTRAINT IF EXISTS service_tickets_customer_fax_phone_ok;
ALTER TABLE public.service_tickets DROP CONSTRAINT IF EXISTS service_tickets_address_line2_len;
ALTER TABLE public.service_tickets DROP CONSTRAINT IF EXISTS service_tickets_customer_address_line2_len;
ALTER TABLE public.clinic_service_leads DROP CONSTRAINT IF EXISTS clinic_service_leads_fax_phone_ok;

ALTER TABLE public.organizations DROP COLUMN IF EXISTS fax;
ALTER TABLE public.organizations DROP COLUMN IF EXISTS address_line2;
ALTER TABLE public.contacts DROP COLUMN IF EXISTS fax;
ALTER TABLE public.locations DROP COLUMN IF EXISTS fax;
ALTER TABLE public.locations DROP COLUMN IF EXISTS address_line2;
ALTER TABLE public.sites DROP COLUMN IF EXISTS address_line2;
ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS fax;
ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS address_line2;
ALTER TABLE public.service_reports DROP COLUMN IF EXISTS customer_fax;
ALTER TABLE public.service_reports DROP COLUMN IF EXISTS tech_company_fax;
ALTER TABLE public.service_reports DROP COLUMN IF EXISTS tech_fax;
ALTER TABLE public.service_reports DROP COLUMN IF EXISTS customer_address_line2;
ALTER TABLE public.service_reports DROP COLUMN IF EXISTS tech_company_address_line2;
ALTER TABLE public.service_tickets DROP COLUMN IF EXISTS customer_fax;
ALTER TABLE public.service_tickets DROP COLUMN IF EXISTS address_line2;
ALTER TABLE public.service_tickets DROP COLUMN IF EXISTS customer_address_line2;
ALTER TABLE public.clinic_service_leads DROP COLUMN IF EXISTS fax;

DROP FUNCTION IF EXISTS public.fax_phone_ok(text);

NOTIFY pgrst, 'reload schema';
