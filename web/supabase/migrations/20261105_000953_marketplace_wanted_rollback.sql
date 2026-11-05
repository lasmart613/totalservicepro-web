-- Rollback 000953. Drops Wanted posts and their messages.
-- Does not delete organizations, users, or marketplace listings.
-- Repo only. Do not run against production from the pull request.
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS marketplace_wanted_message_guard_trg ON public.marketplace_wanted_messages;
DROP TRIGGER IF EXISTS marketplace_wanted_guard_trg ON public.marketplace_wanted;
DROP TABLE IF EXISTS public.marketplace_wanted_messages;
DROP TABLE IF EXISTS public.marketplace_wanted;
DROP FUNCTION IF EXISTS public.marketplace_wanted_message_guard();
DROP FUNCTION IF EXISTS public.marketplace_wanted_guard();
DROP FUNCTION IF EXISTS public.marketplace_wanted_can_manage(bigint, uuid);

NOTIFY pgrst, 'reload schema';
COMMIT;
