-- Rollback 000956. Drops the per-user complimentary signup grant record.
-- Organizations keep whatever premium fields they already have.

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS public.complimentary_signup_grants;

COMMIT;
NOTIFY pgrst, 'reload schema';
