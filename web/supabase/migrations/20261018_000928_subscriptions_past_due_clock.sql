SET LOCAL lock_timeout = '5s';

-- 000928: past_due clock for the 14-day past_due downgrade (Larry, 2026-10-18).
--
-- Product rule: a Stripe subscription that stays past_due for 14 days is
-- downgraded to Free the same way an unpaid one already is. Stripe gives no
-- "past_due since" timestamp, so this records one in the ledger:
--
--   subscriptions.past_due_since timestamptz (nullable, additive)
--     Only the trigger writes it; any value a writer supplies is ignored.
--     Set to now() when a Stripe row (stripe_subscription_id 'sub_...')
--     enters status 'grace_period' (the ledger value for Stripe past_due)
--     with no clock. Kept unchanged while the subscription id stays the same
--     and the status is not 'active': later past_due writes (webhook replays,
--     invoice.payment_failed retries) and 'expired' / 'cancelled' never set,
--     move or clear it. Cleared when the row goes back to 'active' (Stripe
--     active or trialing: recovery). An INSERT, or a new
--     stripe_subscription_id, starts with no clock unless the status is
--     'grace_period' (then now()). Non-Stripe rows never have one.
--   subscriptions.past_due_checked_at timestamptz (nullable, additive)
--     Written only by the hourly sweep after it looks at a row. The sweep
--     skips rows checked in the last 23 hours and takes never-checked rows
--     first, so refused rows (complimentary, another live subscription,
--     deleted in Stripe, unhandled status) rotate out instead of starving
--     real candidates. The trigger clears it whenever the clock is cleared or
--     restarted.
--   trigger subscriptions_past_due_clock (BEFORE INSERT OR UPDATE OF status,
--     past_due_since, stripe_subscription_id, past_due_checked_at), function
--     public.subscriptions_past_due_clock(): SECURITY DEFINER, search_path '',
--     no EXECUTE for PUBLIC / anon / authenticated / service_role (trigger
--     functions fire without EXECUTE).
--   partial index subscriptions_past_due_since_idx for the hourly sweep.
--   The trigger also fires on UPDATE OF past_due_checked_at, so that column
--   cannot be set on a row without a clock.
--
-- Existing past_due rows: conservative start. Any Stripe row already in
-- 'grace_period' with no clock gets past_due_since = now() at apply time
-- (never retroactive), so nothing is downgraded sooner than 14 days after
-- this migration. Prod on 2026-10-18: 3 subscriptions rows, 0 Stripe rows,
-- 0 in grace_period, so the backfill touches 0 rows.
--
-- Complimentary Premium is not a Stripe subscription row and is not touched
-- here (the app refuses the downgrade for any premium_grant org as well).
-- No existing function is replaced. Guards: the new objects must not
-- already exist with another body, and subscriptions.valid_status must still
-- allow 'grace_period' and 'active'. Idempotent (safe to re-run).
-- Rollback: 20261018_000928_subscriptions_past_due_clock_rollback.sql
-- Proof: web/supabase/tests/20261018_subscriptions_past_due_clock.sql
-- Number: 000927 is expected to be taken by the parallel security PR; bump
-- this file at merge if the sequence differs.

DO $$
BEGIN
  IF to_regclass('public.subscriptions') IS NULL THEN
    RAISE EXCEPTION '000928 requires public.subscriptions';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.subscriptions'::regclass
      AND conname = 'valid_status'
      AND pg_catalog.pg_get_constraintdef(oid) LIKE '%''grace_period''%'
      AND pg_catalog.pg_get_constraintdef(oid) LIKE '%''active''%'
  ) THEN
    RAISE EXCEPTION '000928: subscriptions.valid_status no longer allows grace_period and active';
  END IF;
END $$;

-- Drift guard: the trigger function is new. On a re-run it must be this
-- migration's own body (md5 b967b777d5f8d78d088c57cb8eee3785); anything
-- else is refused instead of overwritten.
DO $$
BEGIN
  IF to_regprocedure('public.subscriptions_past_due_clock()') IS NOT NULL THEN
    IF pg_catalog.md5(pg_catalog.pg_get_functiondef(to_regprocedure('public.subscriptions_past_due_clock()')))
       <> 'b967b777d5f8d78d088c57cb8eee3785' THEN
      RAISE EXCEPTION '000928: public.subscriptions_past_due_clock() exists with another body; refusing to overwrite';
    END IF;
  END IF;
END $$;

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS past_due_since timestamptz;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS past_due_checked_at timestamptz;

COMMENT ON COLUMN public.subscriptions.past_due_since IS
  'When this Stripe subscription entered past_due (ledger grace_period). Written only by trigger subscriptions_past_due_clock; cleared on active. 14 days after it the org is downgraded (000928).';
COMMENT ON COLUMN public.subscriptions.past_due_checked_at IS
  'Last time the hourly past_due sweep looked at this row (000928). Rows checked in the last 23 hours are skipped so refused rows rotate out.';

CREATE OR REPLACE FUNCTION public.subscriptions_past_due_clock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  same_sub boolean;
  prior timestamptz;
BEGIN
  same_sub := TG_OP = 'UPDATE'
    AND OLD.stripe_subscription_id IS NOT DISTINCT FROM NEW.stripe_subscription_id;
  -- The only clock a row can carry is the one this trigger already stored
  -- for the same subscription. A supplied value is never accepted.
  prior := CASE WHEN same_sub THEN OLD.past_due_since END;
  IF NEW.stripe_subscription_id IS NULL OR NEW.stripe_subscription_id NOT LIKE 'sub\_%' THEN
    NEW.past_due_since := NULL;
  ELSIF NEW.status = 'active' THEN
    NEW.past_due_since := NULL;
  ELSIF NEW.status = 'grace_period' THEN
    -- Same subscription with a clock: the same past_due episode (or a return
    -- from expired); the clock never moves. Otherwise it starts now.
    NEW.past_due_since := CASE WHEN prior IS NOT NULL THEN prior ELSE now() END;
  ELSE
    -- expired / cancelled: keep the stored clock as history; never accept
    -- one on an INSERT or a new subscription id.
    NEW.past_due_since := prior;
  END IF;
  IF NEW.past_due_since IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.past_due_since IS DISTINCT FROM OLD.past_due_since) THEN
    NEW.past_due_checked_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.subscriptions_past_due_clock() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.subscriptions_past_due_clock() FROM anon, authenticated, service_role;

DROP TRIGGER IF EXISTS subscriptions_past_due_clock ON public.subscriptions;
CREATE TRIGGER subscriptions_past_due_clock
  BEFORE INSERT OR UPDATE OF status, past_due_since, stripe_subscription_id, past_due_checked_at
  ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.subscriptions_past_due_clock();

CREATE INDEX IF NOT EXISTS subscriptions_past_due_since_idx
  ON public.subscriptions (past_due_since)
  WHERE status = 'grace_period';

-- Conservative backfill: existing past_due rows start their 14 days now.
UPDATE public.subscriptions
SET past_due_since = now()
WHERE status = 'grace_period'
  AND past_due_since IS NULL
  AND stripe_subscription_id LIKE 'sub\_%';
