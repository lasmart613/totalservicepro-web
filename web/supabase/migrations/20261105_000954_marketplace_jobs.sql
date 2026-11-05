-- 000954: marketplace job board.
--
-- Full-time, part-time, contract, and subcontract posts. Employers (hiring)
-- and people looking for work can both post. A subcontract post can be one
-- discrete call-out (for example a laser repair in another state).
--
-- Soft beta: posts are free. This table has no Stripe, price, or promotion
-- columns. Do not add a paywall here.
--
-- organization_id is required for hiring (the employer org) and optional for
-- looking, so an individual can post without an org. When organization_id is
-- set, the writer must be an active member (is_active_org_member), the same
-- membership rule as other marketplace writes.
--
-- contact_email and contact_phone are private columns. Anon and authenticated
-- cannot SELECT them. Signed-in viewers read them through
-- marketplace_job_contact(uuid): any signed-in user while the post is open,
-- and the creator or an org member after it is filled or closed.
--
-- APPLY ON LIVE SUPABASE only after review. This file is not applied by the
-- app deploy. Rollback: 20261105_000954_marketplace_jobs_rollback.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regprocedure('public.is_active_org_member(bigint)') IS NULL THEN
    RAISE EXCEPTION '000954 drift: public.is_active_org_member(bigint) is missing';
  END IF;
  IF to_regclass('public.marketplace_jobs') IS NOT NULL
     AND coalesce(pg_catalog.obj_description('public.marketplace_jobs'::regclass), '') NOT LIKE '000954:%' THEN
    RAISE EXCEPTION '000954 drift: public.marketplace_jobs exists and was not created by 000954';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('marketplace_jobs_guard', 'marketplace_job_contact')
      AND coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), '') NOT LIKE '000954:%'
  ) THEN
    RAISE EXCEPTION '000954 drift: a marketplace job function not created by 000954 already exists';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.marketplace_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  organization_id bigint REFERENCES public.organizations(id) ON DELETE SET NULL,
  side text NOT NULL,
  job_type text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  city text,
  state text,
  location text,
  remote boolean NOT NULL DEFAULT false,
  service_area text,
  compensation text,
  equipment text,
  modality text,
  contact_name text,
  contact_email text,
  contact_phone text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT marketplace_jobs_side_check CHECK (side IN ('hiring', 'looking')),
  CONSTRAINT marketplace_jobs_type_check CHECK (job_type IN ('full_time', 'part_time', 'contract', 'subcontract')),
  CONSTRAINT marketplace_jobs_status_check CHECK (status IN ('open', 'filled', 'closed')),
  CONSTRAINT marketplace_jobs_title_check CHECK (char_length(btrim(title)) BETWEEN 3 AND 160),
  CONSTRAINT marketplace_jobs_description_check CHECK (char_length(btrim(description)) BETWEEN 1 AND 8000),
  CONSTRAINT marketplace_jobs_city_check CHECK (city IS NULL OR char_length(city) <= 80),
  CONSTRAINT marketplace_jobs_state_check CHECK (state IS NULL OR char_length(state) <= 40),
  CONSTRAINT marketplace_jobs_location_check CHECK (location IS NULL OR char_length(location) <= 200),
  CONSTRAINT marketplace_jobs_service_area_check CHECK (service_area IS NULL OR char_length(service_area) <= 300),
  CONSTRAINT marketplace_jobs_compensation_check CHECK (compensation IS NULL OR char_length(compensation) <= 200),
  CONSTRAINT marketplace_jobs_equipment_check CHECK (equipment IS NULL OR char_length(equipment) <= 200),
  CONSTRAINT marketplace_jobs_modality_check CHECK (modality IS NULL OR char_length(modality) <= 120),
  CONSTRAINT marketplace_jobs_contact_name_check CHECK (contact_name IS NULL OR char_length(contact_name) <= 120),
  CONSTRAINT marketplace_jobs_contact_email_check CHECK (contact_email IS NULL OR char_length(contact_email) <= 200),
  CONSTRAINT marketplace_jobs_contact_phone_check CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 40),
  CONSTRAINT marketplace_jobs_hiring_org_check CHECK (side <> 'hiring' OR organization_id IS NOT NULL)
);

COMMENT ON TABLE public.marketplace_jobs IS
  '000954: free marketplace job board. hiring requires an org member; looking may be an individual. contact_email and contact_phone are private.';

COMMENT ON COLUMN public.marketplace_jobs.contact_email IS
  '000954: private. Read via marketplace_job_contact, not a client SELECT.';
COMMENT ON COLUMN public.marketplace_jobs.contact_phone IS
  '000954: private. Read via marketplace_job_contact, not a client SELECT.';
COMMENT ON COLUMN public.marketplace_jobs.compensation IS
  '000954: optional free-text pay, rate, or range. Not billed and not a Stripe amount.';
COMMENT ON COLUMN public.marketplace_jobs.equipment IS
  '000954: optional equipment for a subcontract call-out.';
COMMENT ON COLUMN public.marketplace_jobs.modality IS
  '000954: optional modality for a subcontract call-out.';

CREATE INDEX IF NOT EXISTS marketplace_jobs_public_board
  ON public.marketplace_jobs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS marketplace_jobs_org
  ON public.marketplace_jobs (organization_id)
  WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS marketplace_jobs_created_by
  ON public.marketplace_jobs (created_by);

CREATE OR REPLACE FUNCTION public.marketplace_jobs_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := pg_catalog.coalesce(NEW.created_at, pg_catalog.now());
    NEW.updated_at := pg_catalog.now();
    IF NEW.status IS DISTINCT FROM 'open' THEN
      RAISE EXCEPTION 'new job posts start as open';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'marketplace_jobs.created_by is immutable';
    END IF;
    NEW.updated_at := pg_catalog.now();
  END IF;
  IF NEW.side = 'hiring' AND NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'hiring job posts require an organization';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.marketplace_jobs_guard() IS
  '000954: new posts start open, created_by stays put, hiring keeps an organization.';

REVOKE ALL ON FUNCTION public.marketplace_jobs_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS marketplace_jobs_guard ON public.marketplace_jobs;
CREATE TRIGGER marketplace_jobs_guard
  BEFORE INSERT OR UPDATE ON public.marketplace_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.marketplace_jobs_guard();

CREATE OR REPLACE FUNCTION public.marketplace_job_contact(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_created uuid;
  v_org bigint;
  v_status text;
  v_name text;
  v_email text;
  v_phone text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT j.created_by, j.organization_id, j.status, j.contact_name, j.contact_email, j.contact_phone
    INTO v_created, v_org, v_status, v_name, v_email, v_phone
  FROM public.marketplace_jobs j
  WHERE j.id = p_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_status = 'open'
     OR v_created = auth.uid()
     OR (v_org IS NOT NULL AND public.is_active_org_member(v_org))
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'contact_name', v_name,
      'contact_email', v_email,
      'contact_phone', v_phone
    );
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.marketplace_job_contact(uuid) IS
  '000954: contact for an open post (any signed-in user) or for the creator / org member. NULL otherwise.';

REVOKE ALL ON FUNCTION public.marketplace_job_contact(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_job_contact(uuid) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.marketplace_job_contact(uuid) TO service_role;
  END IF;
END $$;

ALTER TABLE public.marketplace_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public reads open and filled jobs" ON public.marketplace_jobs;
DROP POLICY IF EXISTS "Members read own and org jobs" ON public.marketplace_jobs;
DROP POLICY IF EXISTS "Members insert jobs" ON public.marketplace_jobs;
DROP POLICY IF EXISTS "Members update own and org jobs" ON public.marketplace_jobs;

CREATE POLICY "Public reads open and filled jobs"
  ON public.marketplace_jobs
  FOR SELECT
  TO anon, authenticated
  USING (status IN ('open', 'filled'));

CREATE POLICY "Members read own and org jobs"
  ON public.marketplace_jobs
  FOR SELECT
  TO authenticated
  USING (
    created_by = auth.uid()
    OR (organization_id IS NOT NULL AND public.is_active_org_member(organization_id))
  );

CREATE POLICY "Members insert jobs"
  ON public.marketplace_jobs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND status = 'open'
    AND (
      (side = 'looking' AND organization_id IS NULL)
      OR (organization_id IS NOT NULL AND public.is_active_org_member(organization_id))
    )
    AND (side <> 'hiring' OR organization_id IS NOT NULL)
  );

CREATE POLICY "Members update own and org jobs"
  ON public.marketplace_jobs
  FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid()
    OR (organization_id IS NOT NULL AND public.is_active_org_member(organization_id))
  )
  WITH CHECK (
    (
      created_by = auth.uid()
      OR (organization_id IS NOT NULL AND public.is_active_org_member(organization_id))
    )
    AND status IN ('open', 'filled', 'closed')
    AND (
      (side = 'looking' AND (organization_id IS NULL OR public.is_active_org_member(organization_id)))
      OR (side = 'hiring' AND organization_id IS NOT NULL AND public.is_active_org_member(organization_id))
    )
  );

-- No DELETE grant: close the post instead of removing the row.
REVOKE ALL ON TABLE public.marketplace_jobs FROM PUBLIC, anon, authenticated;
REVOKE MAINTAIN ON TABLE public.marketplace_jobs FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id,
  created_by,
  organization_id,
  side,
  job_type,
  title,
  description,
  city,
  state,
  location,
  remote,
  service_area,
  compensation,
  equipment,
  modality,
  contact_name,
  status,
  created_at,
  updated_at
) ON public.marketplace_jobs TO anon, authenticated;

REVOKE SELECT (contact_email, contact_phone) ON public.marketplace_jobs FROM anon, authenticated;

GRANT INSERT, UPDATE ON TABLE public.marketplace_jobs TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.marketplace_jobs TO service_role;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
