SET LOCAL lock_timeout = '5s';

-- Rollback for 000922 (service history teaser + access requests).
-- Drops only objects 000922 created. Grants created by approvals stay: they
-- are real owner consent and are revoked with revoke_service_history.
-- Notification rows written by the server routes stay (type 'general').
-- The private schema is left in place (it exists on prod for other objects).

DROP FUNCTION IF EXISTS public.service_history_request_notice(bigint);
DROP FUNCTION IF EXISTS public.respond_to_service_history_request(bigint, text, text);
DROP FUNCTION IF EXISTS public.list_owner_service_history_grants(bigint, bigint);
DROP FUNCTION IF EXISTS public.list_incoming_service_history_requests(bigint, text, bigint, integer, integer);
DROP FUNCTION IF EXISTS public.list_my_service_history_requests(bigint);
DROP FUNCTION IF EXISTS public.request_service_history_access(bigint, bigint, text);
DROP FUNCTION IF EXISTS public.get_locked_service_history_teaser(bigint, bigint);
DROP FUNCTION IF EXISTS public.service_history_can_request(bigint, bigint);
DROP FUNCTION IF EXISTS public.service_history_teaser_rows(bigint, bigint, bigint);
DROP FUNCTION IF EXISTS public.service_history_title(text);
DROP FUNCTION IF EXISTS public.service_history_teaser_eligible(bigint, bigint, bigint);
DROP FUNCTION IF EXISTS public.take_service_history_slot(text, text, integer, interval);
DROP TABLE IF EXISTS public.service_history_requests;
DROP TABLE IF EXISTS public.service_history_slots;
DROP TABLE IF EXISTS private.service_history_ref_keys;

NOTIFY pgrst, 'reload schema';
