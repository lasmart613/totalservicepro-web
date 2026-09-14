-- Allow Reject on emailed estimate CTAs and publish live shop-dashboard updates.
-- customer_action stays beside status so draft/sent/invoiced/expired filters stay intact.

ALTER TABLE public.service_estimates
  ADD COLUMN IF NOT EXISTS customer_action_token text,
  ADD COLUMN IF NOT EXISTS customer_action text,
  ADD COLUMN IF NOT EXISTS customer_action_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_action_note text;

ALTER TABLE public.service_estimates
  DROP CONSTRAINT IF EXISTS service_estimates_customer_action_check;

ALTER TABLE public.service_estimates
  ADD CONSTRAINT service_estimates_customer_action_check
  CHECK (
    customer_action IS NULL
    OR customer_action IN ('approved', 'rejected', 'changes_requested')
  );

CREATE UNIQUE INDEX IF NOT EXISTS service_estimates_customer_action_token_uidx
  ON public.service_estimates (customer_action_token)
  WHERE customer_action_token IS NOT NULL AND btrim(customer_action_token) <> '';

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.service_estimates;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
