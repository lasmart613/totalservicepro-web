-- 000930: clinic_service_leads + organizations.lead_source (find-a-rep leads).
--
-- Replaces the never-applied 20260904_000000..000003 files (they stay in the
-- repo for history and become no-ops after this). Live 2026-10-18: the table,
-- organizations.lead_source and every *lead* object are absent; no name
-- collisions. 20260908_000000 (applied) only COMMENTs the table in the repo
-- copy; 20261006_000500 (applied) revoked client grants only IF the table
-- existed, so it did nothing here and is re-done below.
--
-- Write/read path: POST /api/clinic-service-leads (Next.js route, service
-- role via getSupabaseAdmin) inserts the row and updates delivered_to_inbox /
-- confirmation_sent. God CRM and God tables read it with the service role.
-- No browser client touches the table, so: RLS on, ZERO policies, and ALL
-- privileges revoked from anon / authenticated (the public default ACL would
-- otherwise grant anon SELECT+MAINTAIN and authenticated arwdm). service_role
-- bypasses RLS and keeps its grants.
--
-- confirmation_key: one confirmation email per (email, description, UTC day).
-- The route sets it on insert; a unique-violation means a confirmation was
-- already claimed, so the route stores the row without the key and skips the
-- confirmation. A failed send clears the key so a retry may confirm.
--
-- No functions are created (no SECURITY DEFINER surface). Independent of
-- 000927 / 000928 / 000929 (no shared objects); any order is fine.
-- Idempotent. Rollback: 20261018_000930_clinic_service_leads_rollback.sql

BEGIN;
SET LOCAL lock_timeout = '5s';

-- Drift guard: if a same-named table already exists it must be ours.
DO $$
DECLARE
  missing text;
BEGIN
  IF to_regclass('public.clinic_service_leads') IS NOT NULL THEN
    SELECT string_agg(c, ', ') INTO missing
    FROM unnest(ARRAY['id','created_at','clinic_name','location','contact_name',
                      'email','description','confirmation_sent']) AS c
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'clinic_service_leads' AND column_name = c
    );
    IF missing IS NOT NULL THEN
      RAISE EXCEPTION '000930 drift: public.clinic_service_leads exists without %', missing;
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizations'
      AND column_name = 'lead_source' AND data_type <> 'text'
  ) THEN
    RAISE EXCEPTION '000930 drift: organizations.lead_source exists and is not text';
  END IF;
END $$;

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS lead_source text;
COMMENT ON COLUMN public.organizations.lead_source IS
  'How this org row was created. landing_find_a_rep = guest clinic form on the logged-out home (service-role insert). Not client-writable.';
REVOKE INSERT (lead_source), UPDATE (lead_source) ON public.organizations FROM anon, authenticated;

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
  model text,
  description text NOT NULL,
  urgency text,
  source text NOT NULL DEFAULT 'landing',
  user_agent text,
  confirmation_sent boolean NOT NULL DEFAULT false,
  delivered_to_inbox boolean NOT NULL DEFAULT false,
  organization_id bigint REFERENCES public.organizations(id) ON DELETE SET NULL,
  service_request_id uuid REFERENCES public.service_requests(id) ON DELETE SET NULL,
  confirmation_key text
);
-- Columns added by 000001..000003 if an older copy of the table exists.
ALTER TABLE public.clinic_service_leads
  ADD COLUMN IF NOT EXISTS equipment_type text,
  ADD COLUMN IF NOT EXISTS equipment_type_other text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS organization_id bigint REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_request_id uuid REFERENCES public.service_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmation_key text;

CREATE INDEX IF NOT EXISTS clinic_service_leads_created_at_idx ON public.clinic_service_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS clinic_service_leads_organization_id_idx ON public.clinic_service_leads (organization_id);
CREATE INDEX IF NOT EXISTS clinic_service_leads_service_request_id_idx ON public.clinic_service_leads (service_request_id);
CREATE UNIQUE INDEX IF NOT EXISTS clinic_service_leads_confirmation_key_key
  ON public.clinic_service_leads (confirmation_key) WHERE confirmation_key IS NOT NULL;

COMMENT ON TABLE public.clinic_service_leads IS
  'Guest clinic / facility service leads from the logged-out RepairPlanet find-a-rep form. Written and read only by the service role (API route, God CRM). RLS on, no policies. Not marketplace RFQs.';
COMMENT ON COLUMN public.clinic_service_leads.equipment_type IS
  'Same rooms as manuals. Other free-text path retired; equipment_type_other unused.';
COMMENT ON COLUMN public.clinic_service_leads.organization_id IS
  'Organizations row created for this guest lead. New insert only; never an update of a live customer or service-company org.';
COMMENT ON COLUMN public.clinic_service_leads.service_request_id IS
  'service_requests row created for this guest landing submit. Insert-only; never an update of a live customer request.';
COMMENT ON COLUMN public.clinic_service_leads.confirmation_key IS
  'md5(lower(email)|description)|UTC day. Unique when set: at most one confirmation email per request per day.';

ALTER TABLE public.clinic_service_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.clinic_service_leads FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.clinic_service_leads TO service_role;

-- Drift guard: no policy may exist on the table (service role only).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clinic_service_leads') THEN
    RAISE EXCEPTION '000930 drift: unexpected policy on public.clinic_service_leads';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
