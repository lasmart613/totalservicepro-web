SET LOCAL lock_timeout = '5s';

-- Rollback for 20261018_000928_subscriptions_past_due_clock.sql.
-- Drops exactly what 000928 added: the trigger, its function, the partial
-- index and the past_due_since / past_due_checked_at columns. No other
-- object, grant or policy is touched (000928 changed none). Safe to re-run.
-- Ship the app rollback (revert of the PR) with or before this file: the
-- past_due sweep reads past_due_since and treats a missing column as
-- "no clock" (it downgrades nothing), so the order is not critical.

DROP TRIGGER IF EXISTS subscriptions_past_due_clock ON public.subscriptions;
DROP FUNCTION IF EXISTS public.subscriptions_past_due_clock();
DROP INDEX IF EXISTS public.subscriptions_past_due_since_idx;
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS past_due_checked_at;
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS past_due_since;
