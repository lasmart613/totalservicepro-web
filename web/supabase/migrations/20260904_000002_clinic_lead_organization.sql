-- Guest landing leads also create a new clinic/owner organizations row.
-- Insert-only from the API. Never use this to rewrite live customer orgs.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS lead_source text;

COMMENT ON COLUMN public.organizations.lead_source IS
  'How this org row was created. landing_find_a_rep = guest clinic form on the logged-out home. Not a live TSP account.';

ALTER TABLE public.clinic_service_leads
  ADD COLUMN IF NOT EXISTS organization_id bigint REFERENCES public.organizations(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.clinic_service_leads.organization_id IS
  'Organizations row created for this guest lead. New insert only; never an update of a live customer or service-company org.';
