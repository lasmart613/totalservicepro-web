-- Migration: Add dedicated tables for marketplace signups and bidding vision
-- This separates concerns from service_tickets/service_reports for cleaner marketplace (bids on contracts/PM/emergency)
--
-- NOTE: organization_id uses bigint (not uuid) to match the existing public.organizations.id column type in this project.
-- (See earlier evidence in set_larry_smart_to_premium.sql and the FK error "uuid and bigint".)
-- user_profiles.organization_id is also bigint. auth.users.id remains uuid for posted_by etc.

-- Extend user_profiles for signup extra fields (FSE, owner, company contact)
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS experience_years integer,
  ADD COLUMN IF NOT EXISTS certifications text,
  ADD COLUMN IF NOT EXISTS preferred_regions text,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS job_title text;

-- Extend organizations for company/owner details
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS services_offered text,  -- comma or json
  ADD COLUMN IF NOT EXISTS num_techs integer,
  ADD COLUMN IF NOT EXISTS tax_id text,
  ADD COLUMN IF NOT EXISTS num_laser_systems integer,
  ADD COLUMN IF NOT EXISTS laser_models text,  -- comma or json
  ADD COLUMN IF NOT EXISTS facility_type text,
  ADD COLUMN IF NOT EXISTS preferred_services text;

-- New table: service_requests (posted needs by owners for bidding)
-- Replaces hacky use of service_tickets for marketplace
CREATE TABLE IF NOT EXISTS public.service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint REFERENCES public.organizations(id) ON DELETE CASCADE,
  posted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  service_type text,  -- 'PM', 'Emergency Repair', 'Install', etc.
  model_type text,
  urgency text DEFAULT 'Medium',  -- Low, Medium, High, Emergency
  budget_min numeric,
  budget_max numeric,
  deadline date,
  location text,  -- city, state or full
  status text DEFAULT 'open',  -- open, bidding, awarded, closed, cancelled
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;

-- RLS: Owners can insert/select their own; FSE/companies can view open ones (for bidding)
CREATE POLICY "Owners can manage their requests" ON public.service_requests
  FOR ALL USING (organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Service pros can view open requests" ON public.service_requests
  FOR SELECT USING (
    status IN ('open', 'bidding') AND
    (SELECT role FROM public.user_profiles WHERE id = auth.uid()) IN ('fse', 'engineer', 'service_manager', 'admin')
  );

-- New table: bids (proposals from FSE/companies on requests)
CREATE TABLE IF NOT EXISTS public.bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.service_requests(id) ON DELETE CASCADE,
  bidder_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  bidder_org_id bigint REFERENCES public.organizations(id) ON DELETE CASCADE,
  amount numeric,
  proposed_date date,
  notes text,
  status text DEFAULT 'pending',  -- pending, accepted, rejected, withdrawn
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;

-- RLS for bids: bidder can manage their bids; owner can view bids on their requests; etc.
CREATE POLICY "Bidders manage their bids" ON public.bids
  FOR ALL USING (bidder_user_id = auth.uid() OR bidder_org_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()))
  WITH CHECK (bidder_user_id = auth.uid() OR bidder_org_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Owners view bids on their requests" ON public.bids
  FOR SELECT USING (
    request_id IN (SELECT id FROM public.service_requests WHERE organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()))
  );

-- Optional: contracts table for when bid accepted
CREATE TABLE IF NOT EXISTS public.service_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.service_requests(id),
  winning_bid_id uuid REFERENCES public.bids(id),
  contractor_user_id uuid REFERENCES auth.users(id),
  contractor_org_id bigint REFERENCES public.organizations(id),
  status text DEFAULT 'active',  -- active, completed, cancelled
  start_date date,
  end_date date,
  terms text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.service_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parties manage their contracts" ON public.service_contracts
  FOR ALL USING (
    contractor_user_id = auth.uid() OR 
    contractor_org_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()) OR
    request_id IN (SELECT id FROM public.service_requests WHERE organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()))
  );

-- Update timestamps trigger (common pattern)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_service_requests_updated_at BEFORE UPDATE ON public.service_requests FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_bids_updated_at BEFORE UPDATE ON public.bids FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Refresh PostgREST schema
NOTIFY pgrst, 'reload schema';
