ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS awarded_bid_id uuid;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS facility_contact jsonb;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS provider_contact jsonb;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS awarded_at timestamptz;

-- Allow parties to view awarded requests (winner + owner org)
DROP POLICY IF EXISTS "Authenticated can view open service_requests" ON public.service_requests;
CREATE POLICY "Authenticated can view open service_requests" ON public.service_requests
  FOR SELECT TO authenticated
  USING (
    status IN ('open', 'bidding')
    OR created_by = auth.uid()
    OR posted_by = auth.uid()
    OR organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
    OR awarded_bid_id IN (
      SELECT id FROM public.bids
      WHERE (bidder_id = auth.uid() OR bidder_user_id = auth.uid())
    )
    OR id IN (
      SELECT request_id FROM public.bids
      WHERE status = 'accepted'
        AND (bidder_id = auth.uid() OR bidder_user_id = auth.uid())
    )
  );

SELECT 'ok' AS status;