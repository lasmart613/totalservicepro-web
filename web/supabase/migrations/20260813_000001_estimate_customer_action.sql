-- Customer estimate actions from emailed CTAs (no login).
-- Token is generated at send time; customer_action is separate from status
-- so draft/sent/invoiced/expired list filters stay intact.

ALTER TABLE public.service_estimates
  ADD COLUMN IF NOT EXISTS customer_action_token text,
  ADD COLUMN IF NOT EXISTS customer_action text,
  ADD COLUMN IF NOT EXISTS customer_action_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_action_note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'service_estimates_customer_action_check'
  ) THEN
    ALTER TABLE public.service_estimates
      ADD CONSTRAINT service_estimates_customer_action_check
      CHECK (
        customer_action IS NULL
        OR customer_action IN ('approved', 'changes_requested')
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS service_estimates_customer_action_token_uidx
  ON public.service_estimates (customer_action_token)
  WHERE customer_action_token IS NOT NULL AND btrim(customer_action_token) <> '';

NOTIFY pgrst, 'reload schema';
