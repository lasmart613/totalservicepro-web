-- Clinic Approve on a sent estimate creates one unscheduled service ticket
-- owned by the estimating shop. Not a marketplace RFQ (no open/bidding row).

ALTER TABLE public.service_tickets
  ADD COLUMN IF NOT EXISTS estimate_id bigint;

ALTER TABLE public.service_estimates
  ADD COLUMN IF NOT EXISTS approved_ticket_id bigint,
  ADD COLUMN IF NOT EXISTS approved_ticket_number text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'service_tickets_estimate_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.service_tickets
        ADD CONSTRAINT service_tickets_estimate_id_fkey
        FOREIGN KEY (estimate_id) REFERENCES public.service_estimates(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'service_tickets.estimate_id FK note: %', SQLERRM;
    END;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS service_tickets_estimate_id_uidx
  ON public.service_tickets (estimate_id)
  WHERE estimate_id IS NOT NULL;

-- Clinic users can read estimates addressed to their org (approve page).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'service_estimates' AND c.relrowsecurity
  ) THEN
    DROP POLICY IF EXISTS "Customers can view their estimates" ON public.service_estimates;
    CREATE POLICY "Customers can view their estimates"
      ON public.service_estimates
      FOR SELECT TO authenticated
      USING (
        customer_organization_id IN (
          SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
