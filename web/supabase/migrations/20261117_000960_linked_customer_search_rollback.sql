-- Rollback 000960. Drops the customer search functions only.
-- Does not drop indexes (those are 000959) and does not change rows.
-- Repo only. Do not run against production from the pull request.

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.find_linked_customer_by_name(bigint, text);
DROP FUNCTION IF EXISTS public.search_linked_customers(bigint, text, text, integer);
DROP FUNCTION IF EXISTS public.resolve_linked_customer_contact(text, text, text, jsonb, jsonb);
