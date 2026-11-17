-- Rollback 000961. Drops search_supplier_orgs only.
-- Does not change rows. There is no index in 000961.
-- Repo only. Do not run against production from the pull request.

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.search_supplier_orgs(text, integer);
