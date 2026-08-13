-- Allow anonymous / logged-out visitors to open shared RFQ and listing links
-- (view only — bidding still requires auth). Used by Share buttons → repairplanet.net.

-- Open service requests (RFQs) visible for invite/share links
DROP POLICY IF EXISTS "Public can view open service requests" ON public.service_requests;
CREATE POLICY "Public can view open service requests"
  ON public.service_requests
  FOR SELECT
  USING (
    lower(coalesce(status, 'open')) IN ('open', 'bidding')
    AND (category IS NULL OR lower(category) = 'service')
  );

-- Active marketplace listings (equipment / parts / consumables) for share links
DROP POLICY IF EXISTS "Public can view active marketplace listings" ON public.marketplace_listings;
CREATE POLICY "Public can view active marketplace listings"
  ON public.marketplace_listings
  FOR SELECT
  USING (
    lower(coalesce(status, 'active')) IN ('active', 'open', 'published')
  );

NOTIFY pgrst, 'reload schema';
