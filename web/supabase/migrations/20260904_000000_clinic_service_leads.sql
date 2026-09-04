-- Guest clinic / facility service leads from the logged-out RepairPlanet landing.
-- Not marketplace RFQs (service_requests) and not product-issue reports.
CREATE TABLE IF NOT EXISTS public.clinic_service_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  clinic_name text NOT NULL,
  location text NOT NULL,
  contact_name text NOT NULL,
  email text,
  phone text,
  equipment_type text,
  equipment_type_other text,
  manufacturer text,
  description text NOT NULL,
  urgency text,
  source text NOT NULL DEFAULT 'landing',
  user_agent text,
  confirmation_sent boolean NOT NULL DEFAULT false,
  delivered_to_inbox boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE public.clinic_service_leads IS
  'Guest clinic / facility service leads from the logged-out RepairPlanet landing. Written by the app API (service role). Not marketplace RFQs. Equipment types start at laser, lithotriptor, C-arm, other.';

ALTER TABLE public.clinic_service_leads ENABLE ROW LEVEL SECURITY;

-- No authenticated policies: inserts/reads go through the service-role API route.
