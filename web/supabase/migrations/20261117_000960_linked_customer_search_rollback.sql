-- Rollback 000960. Drops the customer search functions only.
-- Does not change rows. There is no index in 000960.
-- Repo only. Do not run against production from the pull request.

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.find_linked_customer_by_name(bigint, text);
DROP FUNCTION IF EXISTS public.search_linked_customers(bigint, text, text, integer);
DROP FUNCTION IF EXISTS public.linked_customer_prefilter_text(text, text, text, text, text, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.resolve_linked_customer_contact(text, text, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.normalize_linked_directory(jsonb);
