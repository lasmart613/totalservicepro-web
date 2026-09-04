-- Link guest landing leads to the service_requests row created for them.
ALTER TABLE public.clinic_service_leads
  ADD COLUMN IF NOT EXISTS service_request_id uuid REFERENCES public.service_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS model text;

COMMENT ON COLUMN public.clinic_service_leads.service_request_id IS
  'service_requests row created for this guest landing submit. Insert-only; never an update of a live customer request.';
