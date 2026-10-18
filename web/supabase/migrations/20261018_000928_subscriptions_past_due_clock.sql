SET LOCAL lock_timeout = '5s';

-- 000928: past_due clock for the 14-day past_due downgrade (Larry, 2026-10-18).
--
-- Product rule: a Stripe subscription that stays past_due for 14 days is
-- downgraded to Free the same way an unpaid one already is. Stripe gives no
-- "past_due since" timestamp, so this records one in the ledger:
--
--   subscriptions.past_due_since timestamptz (nullable, additive)
--     Set to now() when a Stripe row (stripe_subscription_id 'sub_...')
--     enters status 'grace_period' (the ledger value for Stripe past_due).
--     Kept unchanged while the row stays past_due, so later past_due writes
--     (webhook replays, invoice.payment_failed retries) never restart or move
--     the clock. Cleared when the row goes back to 'active' (Stripe active or
--     trialing: recovery). A new stripe_subscription_id on the row starts
--     fresh. 'expired' / 'cancelled' leave it as history.
--   trigger subscriptions_past_due_clock (BEFORE INSERT OR UPDATE OF status,
--     past_due_since, stripe_subscription_id), function
--     public.subscriptions_past_due_clock(): SECURITY DEFINER, search_path '',
--     no EXECUTE for PUBLIC / anon / authenticated / service_role (trigger
--     functions fire without EXECUTE).
--   partial index subscriptions_past_due_since_idx for the hourly sweep.
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
-- migration's own body (md5 2a0d072a45f52660ba23f4822738c26a); anything
-- else is refused instead of overwritten.
DO $$
BEGIN
  IF to_regprocedure('public.subscriptions_past_due_clock()') IS NOT NULL THEN
    IF pg_catalog.md5(pg_catalog.pg_get_functiondef(to_regprocedure('public.subscriptions_past_due_clock()')))
       <> '2a0d072a45f52660ba23f4822738c26a' THEN
      RAISE EXCEPTION '000928: public.subscriptions_past_due_clock() exists with another body; refusing to overwrite';
    END IF;
  END IF;
END $$;

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS past_due_since timestamptz;

COMMENT ON COLUMN public.subscriptions.past_due_since IS
  'When this Stripe subscription entered past_due (ledger grace_period). Set and kept by trigger subscriptions_past_due_clock; cleared on active. 14 days after it the org is downgraded (000928).';

CREATE OR REPLACE FUNCTION public.subscriptions_past_due_clock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  same_sub boolean;
BEGIN
  IF NEW.stripe_subscription_id IS NULL OR NEW.stripe_subscription_id NOT LIKE 'sub\_%' THEN
    RETURN NEW;
  END IF;
  same_sub := TG_OP = 'UPDATE'
    AND OLD.stripe_subscription_id IS NOT DISTINCT FROM NEW.stripe_subscription_id;
  IF NEW.status = 'active' THEN
    NEW.past_due_since := NULL;
  ELSIF NEW.status = 'grace_period' THEN
    IF same_sub AND OLD.past_due_since IS NOT NULL THEN
      -- Still the same past_due episode: the clock never moves or restarts.
      NEW.past_due_since := OLD.past_due_since;
    ELSE
      -- A new past_due episode starts now; a writer cannot backdate it.
      NEW.past_due_since := now();
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NOT same_sub THEN
    NEW.past_due_since := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.subscriptions_past_due_clock() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.subscriptions_past_due_clock() FROM anon, authenticated, service_role;

DROP TRIGGER IF EXISTS subscriptions_past_due_clock ON public.subscriptions;
CREATE TRIGGER subscriptions_past_due_clock
  BEFORE INSERT OR UPDATE OF status, past_due_since, stripe_subscription_id
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
