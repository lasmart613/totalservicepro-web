-- Rollback for 20261016_000918_manual_search_index_catchup.sql.
-- Disable the Netlify scheduled function first (or deploy the app without
-- web/netlify/functions/manual-index-catchup.mts). With the functions gone it
-- only logs an error and writes nothing, so the order is not critical.
-- manual_search_index itself is untouched.

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.record_manual_search_index_failure(bigint, text);
DROP FUNCTION IF EXISTS public.record_manual_search_index_attempt(bigint, text);
DROP FUNCTION IF EXISTS public.manuals_missing_search_index(integer, bigint);
DROP FUNCTION IF EXISTS public.manuals_missing_search_index(integer);
DROP TABLE IF EXISTS public.manual_search_index_failures;

NOTIFY pgrst, 'reload schema';
