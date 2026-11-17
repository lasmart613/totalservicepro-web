-- Rollback 000959. Drops the customer-search indexes only.
-- Does not drop pg_trgm: the extension may already have been installed
-- for other indexes. Does not change rows.
-- Repo only. Do not run against production from the pull request.

SET LOCAL lock_timeout = '5s';

DROP INDEX IF EXISTS public.organizations_contact_name_trgm_idx;
DROP INDEX IF EXISTS public.organizations_email_trgm_idx;
DROP INDEX IF EXISTS public.organizations_phone_trgm_idx;
DROP INDEX IF EXISTS public.organizations_state_trgm_idx;
DROP INDEX IF EXISTS public.organizations_city_trgm_idx;
DROP INDEX IF EXISTS public.organizations_name_trgm_idx;
DROP INDEX IF EXISTS public.organization_customers_service_created_idx;
