-- Rollback 000957. Drops service-org ratings, their policies, and their functions.
-- Does not delete organizations, tickets, reports, invoices, or users.
-- Repo only. Do not run against production from the pull request.

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS public.service_org_reviews CASCADE;
DROP FUNCTION IF EXISTS public.service_org_review_eligible_jobs(bigint);
DROP FUNCTION IF EXISTS public.public_service_org_profile(bigint);
DROP FUNCTION IF EXISTS public.service_org_reviews_public(bigint, integer, integer);
DROP FUNCTION IF EXISTS public.service_org_rating_summaries(bigint[]);
DROP FUNCTION IF EXISTS public.service_org_review_org_is_public(bigint);
DROP FUNCTION IF EXISTS public.service_org_reviews_guard();
DROP FUNCTION IF EXISTS public.service_org_review_resolve(bigint, bigint, bigint, uuid, bigint);
DROP FUNCTION IF EXISTS public.service_org_review_can_reply(bigint);
DROP FUNCTION IF EXISTS public.service_org_review_safe_date(text);
DROP FUNCTION IF EXISTS public.service_org_review_parse_ticket(text);
DROP FUNCTION IF EXISTS public.service_org_review_edit_window();

NOTIFY pgrst, 'reload schema';
COMMIT;
