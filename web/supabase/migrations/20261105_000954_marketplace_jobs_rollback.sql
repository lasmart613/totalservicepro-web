-- Rollback 000954. Drops the job board table and its helpers.
-- Does not change marketplace listings, Stripe, Connect, or Premium billing.
-- Do not apply this in the same run as the forward migration.

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS public.marketplace_jobs;
DROP FUNCTION IF EXISTS public.marketplace_job_contact(uuid);
DROP FUNCTION IF EXISTS public.marketplace_jobs_guard();

COMMIT;

NOTIFY pgrst, 'reload schema';
