-- Rollback for 20261018_000929_organizations_country.sql. Exact inverse.
-- Run the one-off rollback (oneoff/20261018_country_backfill_rollback.sql)
-- first if you want the backup rows restored before the column goes away.
-- WARNING: drops organizations.country / prospect_pool and the
-- prospect_customer_links audit table (organization_customers links made by
-- add_prospect_customer stay; they are ordinary customer links).
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.add_prospect_customer(bigint);
DROP FUNCTION IF EXISTS public.find_clinic_prospects();
DROP FUNCTION IF EXISTS public.prospect_state_key(text);
DROP FUNCTION IF EXISTS public.org_is_paid_entitled(bigint);
DROP TABLE IF EXISTS public.prospect_customer_links;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'country') THEN
    EXECUTE 'REVOKE INSERT (country), UPDATE (country) ON TABLE public.organizations FROM authenticated';
  END IF;
END $$;

DROP INDEX IF EXISTS public.organizations_prospect_pool_idx;
DROP INDEX IF EXISTS public.organizations_country_idx;
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_prospect_pool_check;
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_country_trimmed_check;
ALTER TABLE public.organizations DROP COLUMN IF EXISTS prospect_pool;
ALTER TABLE public.organizations DROP COLUMN IF EXISTS country;
