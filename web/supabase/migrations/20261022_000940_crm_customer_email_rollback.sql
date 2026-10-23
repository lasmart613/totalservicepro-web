-- Rollback for 000940. Exact: drops only what 000940 created (checks the
-- '000940' COMMENT markers first). WARNING: deletes the customer email log and
-- every connected mailbox (encrypted refresh tokens). Users must reconnect.
-- Revoke the tokens at the provider first if you are retiring the feature
-- (Disconnect in the app does this per user). Re-runnable.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.user_mailbox_connections') IS NOT NULL
     AND coalesce(obj_description(to_regclass('public.user_mailbox_connections'), 'pg_class'), '') NOT LIKE '000940%' THEN
    RAISE EXCEPTION '000940 rollback: public.user_mailbox_connections was not created by 000940';
  END IF;
  IF to_regclass('public.customer_email_sends') IS NOT NULL
     AND coalesce(obj_description(to_regclass('public.customer_email_sends'), 'pg_class'), '') NOT LIKE '000940%' THEN
    RAISE EXCEPTION '000940 rollback: public.customer_email_sends was not created by 000940';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('customer_email_reserve_send', 'customer_email_finish_send')
      AND coalesce(obj_description(p.oid, 'pg_proc'), '') NOT LIKE '000940%') THEN
    RAISE EXCEPTION '000940 rollback: a customer_email_* function was not created by 000940';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.customer_email_finish_send(bigint, text, text, text);
DROP FUNCTION IF EXISTS public.customer_email_reserve_send(uuid, bigint, bigint, text, text, text, text, text, text, integer, integer);
DROP TABLE IF EXISTS public.customer_email_sends;
DROP TABLE IF EXISTS public.user_mailbox_connections;

COMMIT;
