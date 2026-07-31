-- Fix infinite recursion between service_requests <-> bids RLS policies.
-- Cause: service_requests SELECT looked into bids; bids SELECT looked into service_requests.
-- Fix: SECURITY DEFINER helpers that bypass RLS for the cross-table checks.

CREATE OR REPLACE FUNCTION public.user_is_winning_bidder(req_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bids b
    WHERE b.request_id = req_id
      AND b.status = 'accepted'
      AND (b.bidder_id = auth.uid() OR b.bidder_user_id = auth.uid())
  )
  OR EXISTS (
    SELECT 1
    FROM public.service_requests sr
    JOIN public.bids b ON b.id = sr.awarded_bid_id
    WHERE sr.id = req_id
      AND (b.bidder_id = auth.uid() OR b.bidder_user_id = auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.user_owns_service_request(req_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.service_requests sr
    WHERE sr.id = req_id
      AND (
        sr.created_by = auth.uid()
        OR sr.posted_by = auth.uid()
        OR sr.organization_id IN (
          SELECT up.organization_id
          FROM public.user_profiles up
          WHERE up.id = auth.uid()
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.user_org_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.user_profiles WHERE id = auth.uid() LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.user_is_winning_bidder(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_owns_service_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_org_id() TO authenticated;

-- ── service_requests SELECT (no subquery into bids RLS) ────────────────────
DROP POLICY IF EXISTS "Authenticated can view open service_requests" ON public.service_requests;
DROP POLICY IF EXISTS "Anyone authenticated can view open service needs (for bidding)" ON public.service_requests;
DROP POLICY IF EXISTS "Service pros can view open requests" ON public.service_requests;

CREATE POLICY "Authenticated can view open service_requests"
  ON public.service_requests
  FOR SELECT
  TO authenticated
  USING (
    status IN ('open', 'bidding')
    OR created_by = auth.uid()
    OR posted_by = auth.uid()
    OR organization_id = public.user_org_id()
    OR public.user_is_winning_bidder(id)
  );

-- Keep owner manage policy (does not touch bids)
DROP POLICY IF EXISTS "Owners manage own service_requests" ON public.service_requests;
CREATE POLICY "Owners manage own service_requests"
  ON public.service_requests
  FOR ALL
  TO authenticated
  USING (
    organization_id = public.user_org_id()
    OR created_by = auth.uid()
    OR posted_by = auth.uid()
  )
  WITH CHECK (
    organization_id = public.user_org_id()
    OR created_by = auth.uid()
    OR posted_by = auth.uid()
  );

-- ── bids: owners view without re-entering service_requests RLS ─────────────
DROP POLICY IF EXISTS "Owners view bids on service_requests" ON public.bids;
DROP POLICY IF EXISTS "Request owners view bids" ON public.bids;
DROP POLICY IF EXISTS "Owners view bids on their requests" ON public.bids;

CREATE POLICY "Owners view bids on service_requests"
  ON public.bids
  FOR SELECT
  TO authenticated
  USING (
    public.user_owns_service_request(request_id)
  );

-- Ensure bidders can still read their own bids (including accepted)
DROP POLICY IF EXISTS "Bidders manage own bids" ON public.bids;
CREATE POLICY "Bidders manage own bids"
  ON public.bids
  FOR ALL
  TO authenticated
  USING (bidder_id = auth.uid() OR bidder_user_id = auth.uid())
  WITH CHECK (bidder_id = auth.uid() OR bidder_user_id = auth.uid());

-- Bidders / owners may update bid status on accept (owner accepts, system rejects others)
DROP POLICY IF EXISTS "Users can update their own pending bids" ON public.bids;
DROP POLICY IF EXISTS "Owners can update bids on their requests" ON public.bids;

CREATE POLICY "Users can update their own pending bids"
  ON public.bids
  FOR UPDATE
  TO authenticated
  USING (
    (bidder_id = auth.uid() OR bidder_user_id = auth.uid())
    OR public.user_owns_service_request(request_id)
  )
  WITH CHECK (
    (bidder_id = auth.uid() OR bidder_user_id = auth.uid())
    OR public.user_owns_service_request(request_id)
  );

SELECT 'ok' AS status;
