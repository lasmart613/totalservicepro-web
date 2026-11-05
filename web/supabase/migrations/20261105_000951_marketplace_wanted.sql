-- 000951: Marketplace Wanted board.
--
-- Buyers post the laser or other biomedical equipment they are looking for.
-- Posting and viewing are free. This table has no fee column and
-- no paid-placement flag. Do not add a charge later without a new migration
-- that the product owner asked for. Soft beta: these rows are not ads.
--
-- Contact is a message thread (marketplace_wanted_messages) or the posting
-- organization's existing profile. Email and phone are not copied onto the
-- post, so a public read cannot harvest them.
--
-- Writes require auth.uid() = created_by and an active membership
-- (is_active_org_member) on organization_id. Org owners and admins may update
-- a teammate's post. Closed rows are visible only to the author and that org.
-- Open and filled rows are readable by anon and authenticated.
--
-- Repo only. Do not apply this file to production from the pull request.
-- No customer rows are inserted. QA, when someone applies it on a non-production
-- database: sign in as a member of org 2655, 2639, 2656, or 2651.
-- Never use orgs 1005, 5509, 2616, or 4.
--
-- Rollback: 20261105_000951_marketplace_wanted_rollback.sql

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regprocedure('public.is_active_org_member(bigint)') IS NULL THEN
    RAISE EXCEPTION '000951 drift: public.is_active_org_member(bigint) is missing';
  END IF;
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION '000951 drift: public.organizations is missing';
  END IF;
  IF to_regclass('public.marketplace_wanted') IS NOT NULL
     AND coalesce(pg_catalog.obj_description('public.marketplace_wanted'::regclass, 'pg_class'), '') NOT LIKE '000951:%' THEN
    RAISE EXCEPTION '000951 drift: public.marketplace_wanted exists and was not created by 000951';
  END IF;
  IF to_regclass('public.marketplace_wanted_messages') IS NOT NULL
     AND coalesce(pg_catalog.obj_description('public.marketplace_wanted_messages'::regclass, 'pg_class'), '') NOT LIKE '000951:%' THEN
    RAISE EXCEPTION '000951 drift: public.marketplace_wanted_messages exists and was not created by 000951';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('marketplace_wanted_guard', 'marketplace_wanted_can_manage')
      AND coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), '') NOT LIKE '000951:%'
  ) THEN
    RAISE EXCEPTION '000951 drift: a marketplace_wanted function not created by 000951 already exists';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.marketplace_wanted (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL,
  manufacturer text,
  model text,
  modality text NOT NULL DEFAULT 'laser',
  preferred_condition text NOT NULL DEFAULT 'any',
  city text,
  state text,
  country text,
  service_area text,
  budget_min numeric(12, 2),
  budget_max numeric(12, 2),
  currency text NOT NULL DEFAULT 'USD',
  contact_via text NOT NULL DEFAULT 'message',
  poster_name text,
  contact_name text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  filled_at timestamptz,
  closed_at timestamptz,
  CONSTRAINT marketplace_wanted_title_len CHECK (char_length(btrim(title)) BETWEEN 3 AND 160),
  CONSTRAINT marketplace_wanted_description_len CHECK (char_length(btrim(description)) BETWEEN 1 AND 4000),
  CONSTRAINT marketplace_wanted_modality_chk CHECK (
    modality IN (
      'laser', 'lithotriptor', 'c_arm', 'anesthesia', 'beds', 'defibrillator',
      'endoscope', 'infusion_pump', 'patient_monitor', 'sterile_processing',
      'ultrasound', 'ventilator'
    )
  ),
  CONSTRAINT marketplace_wanted_condition_chk CHECK (
    preferred_condition IN ('any', 'new', 'refurbished', 'used', 'for_parts')
  ),
  CONSTRAINT marketplace_wanted_status_chk CHECK (status IN ('open', 'filled', 'closed')),
  CONSTRAINT marketplace_wanted_contact_chk CHECK (contact_via IN ('message', 'org')),
  CONSTRAINT marketplace_wanted_currency_chk CHECK (currency ~ '^[A-Z]{3,8}$'),
  CONSTRAINT marketplace_wanted_budget_min_chk CHECK (budget_min IS NULL OR budget_min >= 0),
  CONSTRAINT marketplace_wanted_budget_max_chk CHECK (budget_max IS NULL OR budget_max >= 0),
  CONSTRAINT marketplace_wanted_budget_order_chk CHECK (
    budget_min IS NULL OR budget_max IS NULL OR budget_max >= budget_min
  ),
  CONSTRAINT marketplace_wanted_short_len CHECK (
    (manufacturer IS NULL OR char_length(manufacturer) <= 120)
    AND (model IS NULL OR char_length(model) <= 120)
    AND (city IS NULL OR char_length(city) <= 120)
    AND (state IS NULL OR char_length(state) <= 120)
    AND (country IS NULL OR char_length(country) <= 120)
    AND (poster_name IS NULL OR char_length(poster_name) <= 200)
    AND (contact_name IS NULL OR char_length(contact_name) <= 200)
    AND (service_area IS NULL OR char_length(service_area) <= 500)
  )
);

COMMENT ON TABLE public.marketplace_wanted IS
  '000951: Wanted board. Buyers post equipment they are looking for. Posting and viewing are free: no fee column and no payment provider columns. Not an advertisement.';
COMMENT ON COLUMN public.marketplace_wanted.contact_via IS
  '000951: message = in-app thread on marketplace_wanted_messages. org = reach the posting organization. Email and phone are not stored on this row.';
COMMENT ON COLUMN public.marketplace_wanted.budget_min IS
  '000951: Optional amount the buyer hopes to pay. Not a charge for the listing.';
COMMENT ON COLUMN public.marketplace_wanted.modality IS
  '000951: Same equipment rooms as manuals (laser, lithotriptor, c_arm, and the other rooms). Laser is the default.';

CREATE TABLE IF NOT EXISTS public.marketplace_wanted_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wanted_id uuid NOT NULL REFERENCES public.marketplace_wanted(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_wanted_messages_body_len CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000)
);

COMMENT ON TABLE public.marketplace_wanted_messages IS
  '000951: Messages on a Wanted post. Readable by the sender and by members of the posting organization. Not public.';

CREATE INDEX IF NOT EXISTS marketplace_wanted_status_created_idx
  ON public.marketplace_wanted (status, created_at DESC);
CREATE INDEX IF NOT EXISTS marketplace_wanted_org_idx
  ON public.marketplace_wanted (organization_id);
CREATE INDEX IF NOT EXISTS marketplace_wanted_created_by_idx
  ON public.marketplace_wanted (created_by);
CREATE INDEX IF NOT EXISTS marketplace_wanted_modality_idx
  ON public.marketplace_wanted (modality);
CREATE INDEX IF NOT EXISTS marketplace_wanted_messages_wanted_idx
  ON public.marketplace_wanted_messages (wanted_id, created_at);

CREATE OR REPLACE FUNCTION public.marketplace_wanted_can_manage(p_org bigint, p_created_by uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
    AND (
      p_created_by = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.organization_memberships m
        WHERE m.user_id = auth.uid()
          AND m.organization_id = p_org
          AND lower(pg_catalog.btrim(coalesce(m.role, ''))) IN ('owner', 'admin', 'company_admin')
      )
    );
$$;

COMMENT ON FUNCTION public.marketplace_wanted_can_manage(bigint, uuid) IS
  '000951: true when the caller wrote the Wanted post or is an owner/admin of its organization.';

REVOKE ALL ON FUNCTION public.marketplace_wanted_can_manage(bigint, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketplace_wanted_can_manage(bigint, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.marketplace_wanted_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS NULL THEN
      NEW.status := 'open';
    END IF;
    IF auth.uid() IS NOT NULL THEN
      IF NEW.created_by IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'created_by must be the signed-in user';
      END IF;
      IF NEW.organization_id IS NULL OR NOT public.is_active_org_member(NEW.organization_id) THEN
        RAISE EXCEPTION 'wanted posts require an active organization membership';
      END IF;
      IF NEW.status IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'new wanted posts start open';
      END IF;
    END IF;
    NEW.filled_at := NULL;
    NEW.closed_at := NULL;
    NEW.updated_at := pg_catalog.now();
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'wanted post ownership cannot change';
  END IF;

  NEW.updated_at := pg_catalog.now();
  IF NEW.status = 'filled' AND OLD.status IS DISTINCT FROM 'filled' THEN
    NEW.filled_at := pg_catalog.now();
  ELSIF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    NEW.closed_at := pg_catalog.now();
  ELSIF NEW.status = 'open' AND OLD.status IS DISTINCT FROM 'open' THEN
    NEW.filled_at := NULL;
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.marketplace_wanted_guard() IS
  '000951: keeps Wanted ownership fixed, requires a membership on insert, and stamps filled/closed times. Does not charge.';

REVOKE ALL ON FUNCTION public.marketplace_wanted_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS marketplace_wanted_guard_trg ON public.marketplace_wanted;
CREATE TRIGGER marketplace_wanted_guard_trg
  BEFORE INSERT OR UPDATE ON public.marketplace_wanted
  FOR EACH ROW
  EXECUTE FUNCTION public.marketplace_wanted_guard();

CREATE OR REPLACE FUNCTION public.marketplace_wanted_message_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.sender_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'sender_id must be the signed-in user';
  END IF;
  NEW.body := pg_catalog.btrim(NEW.body);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.marketplace_wanted_message_guard() IS
  '000951: a Wanted message is sent as the signed-in user.';

REVOKE ALL ON FUNCTION public.marketplace_wanted_message_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS marketplace_wanted_message_guard_trg ON public.marketplace_wanted_messages;
CREATE TRIGGER marketplace_wanted_message_guard_trg
  BEFORE INSERT ON public.marketplace_wanted_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.marketplace_wanted_message_guard();

ALTER TABLE public.marketplace_wanted ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_wanted_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketplace_wanted_public_select ON public.marketplace_wanted;
CREATE POLICY marketplace_wanted_public_select
  ON public.marketplace_wanted
  FOR SELECT
  TO anon, authenticated
  USING (status IN ('open', 'filled'));

DROP POLICY IF EXISTS marketplace_wanted_member_select ON public.marketplace_wanted;
CREATE POLICY marketplace_wanted_member_select
  ON public.marketplace_wanted
  FOR SELECT
  TO authenticated
  USING (
    created_by = auth.uid()
    OR (organization_id IS NOT NULL AND public.is_active_org_member(organization_id))
  );

DROP POLICY IF EXISTS marketplace_wanted_insert ON public.marketplace_wanted;
CREATE POLICY marketplace_wanted_insert
  ON public.marketplace_wanted
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND status = 'open'
    AND organization_id IS NOT NULL
    AND public.is_active_org_member(organization_id)
  );

DROP POLICY IF EXISTS marketplace_wanted_update ON public.marketplace_wanted;
CREATE POLICY marketplace_wanted_update
  ON public.marketplace_wanted
  FOR UPDATE
  TO authenticated
  USING (public.marketplace_wanted_can_manage(organization_id, created_by))
  WITH CHECK (
    status IN ('open', 'filled', 'closed')
    AND public.marketplace_wanted_can_manage(organization_id, created_by)
  );

DROP POLICY IF EXISTS marketplace_wanted_messages_select ON public.marketplace_wanted_messages;
CREATE POLICY marketplace_wanted_messages_select
  ON public.marketplace_wanted_messages
  FOR SELECT
  TO authenticated
  USING (
    sender_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.marketplace_wanted w
      WHERE w.id = marketplace_wanted_messages.wanted_id
        AND (
          w.created_by = auth.uid()
          OR public.is_active_org_member(w.organization_id)
        )
    )
  );

DROP POLICY IF EXISTS marketplace_wanted_messages_insert ON public.marketplace_wanted_messages;
CREATE POLICY marketplace_wanted_messages_insert
  ON public.marketplace_wanted_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND char_length(btrim(body)) BETWEEN 1 AND 2000
    AND EXISTS (
      SELECT 1
      FROM public.marketplace_wanted w
      WHERE w.id = wanted_id
        AND w.status IN ('open', 'filled')
    )
  );

REVOKE ALL ON TABLE public.marketplace_wanted FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.marketplace_wanted TO anon, authenticated;
GRANT INSERT, UPDATE ON TABLE public.marketplace_wanted TO authenticated;

REVOKE ALL ON TABLE public.marketplace_wanted_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.marketplace_wanted_messages TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.marketplace_wanted TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.marketplace_wanted_messages TO service_role;
  END IF;
END $$;

-- PG17 MAINTAIN is not needed by browser roles.
REVOKE MAINTAIN ON TABLE public.marketplace_wanted FROM anon, authenticated;
REVOKE MAINTAIN ON TABLE public.marketplace_wanted_messages FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
