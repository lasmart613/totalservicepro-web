-- One complimentary signup trial per organization.
--
-- POST /api/org/founder granted the 60-day complimentary_signup trial whenever
-- a creator's service_company org had is_premium, premium_until and
-- premium_grant all empty. God expiry/removal clears all three, so the trial
-- re-granted on the next /company visit, forever (org 2651, 9:06 AM PT
-- Oct 11 2026).
--
-- organizations.trial_granted_at records that the org has used its trial.
-- Expiry and removal never clear it. The founder route grants only when this
-- is null and the org is new, and sets it in the same write as the grant.
--
-- Client writes: authenticated has column-level INSERT/UPDATE grants only on
-- safe columns (20261006_000400), and this column is not one of them. The
-- guard below also refuses it for any caller with auth.uid() (defense in
-- depth if a grant is ever widened). The service role (auth.uid() is null)
-- still writes it.
--
-- Backfill (rows where trial_granted_at is null only; see
-- web/supabase/oneoff/20261011_org_trial_granted_at_find.sql for the list):
--   1. premium_grant = 'complimentary_signup' now: premium_until - 60 days
--      (1440 hours: exact, whatever the session TimeZone)
--      (when the grant was written), else created_at.
--   2. premium_grant = 'complimentary_god' now: updated_at, else created_at.
--   3. Safety: service_company orgs with a creator, created on or after the
--      complimentary migration (20260914) and before #215 (2026-10-06 04:01:07
--      UTC), that no longer have a grant: they got the trial at signup, so mark
--      it used (created_at). No live rows match today; kept for safety.
-- No God email, notification or audit table records past grants (checked
-- read-only: god_email_sends has only clinic_invite/shop_invite rows, and
-- notifications has no premium/trial rows). API logs Oct 2-11 show founder
-- grant PATCHes only for 2674 (setup) and 2651 (re-grant); both are in rule 1.
--
-- The backfill UPDATE fires trg_organizations_updated_at, so updated_at moves
-- to now() on the backfilled rows.
--
-- APPLY ON LIVE SUPABASE after review, BEFORE (or with) the app deploy that
-- reads trial_granted_at. This repo does not auto-apply SQL. The migration
-- runner applies this file as one transaction. Safe to re-run. Do not apply
-- the rollback in the same run.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS trial_granted_at timestamptz;

COMMENT ON COLUMN public.organizations.trial_granted_at IS
  'When this org used its one complimentary signup trial. Never cleared by expiry or removal. Service role only.';

-- No-op today (no table-level grant, column not in the safe list); explicit so
-- a later column grant does not include it by accident.
REVOKE INSERT (trial_granted_at), UPDATE (trial_granted_at)
  ON TABLE public.organizations FROM public, anon, authenticated;

-- Same client-write guard as 20261006_000802 (live definition), plus
-- trial_granted_at, with search_path = '' and schema-qualified names.
CREATE OR REPLACE FUNCTION public.organizations_guard_privilege()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  newj jsonb := pg_catalog.to_jsonb(NEW);
  oldj jsonb := CASE WHEN TG_OP = 'UPDATE' THEN pg_catalog.to_jsonb(OLD) ELSE NULL END;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'created_by must be the signed-in user';
    END IF;
    IF coalesce((newj->>'is_premium')::boolean, false) IS TRUE THEN
      RAISE EXCEPTION 'is_premium cannot be self-granted';
    END IF;
    IF nullif(newj->>'premium_until', '') IS NOT NULL
       OR nullif(newj->>'premium_grant', '') IS NOT NULL THEN
      RAISE EXCEPTION 'premium fields cannot be self-granted';
    END IF;
    IF nullif(newj->>'trial_granted_at', '') IS NOT NULL THEN
      RAISE EXCEPTION 'trial_granted_at cannot be set by the client';
    END IF;
    IF lower(coalesce(newj->>'subscription_tier', '')) NOT IN ('', 'free')
       OR lower(coalesce(newj->>'plan', '')) NOT IN ('', 'free') THEN
      RAISE EXCEPTION 'plan cannot be self-granted';
    END IF;
    IF nullif(newj->>'stripe_account_id', '') IS NOT NULL
       OR coalesce((newj->>'stripe_charges_enabled')::boolean, false)
       OR coalesce((newj->>'stripe_payouts_enabled')::boolean, false)
       OR coalesce((newj->>'stripe_details_submitted')::boolean, false) THEN
      RAISE EXCEPTION 'stripe connect fields cannot be set by the client';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'created_by cannot be changed';
  END IF;
  IF (newj->>'is_premium') IS DISTINCT FROM (oldj->>'is_premium')
     OR (newj->>'premium_until') IS DISTINCT FROM (oldj->>'premium_until')
     OR (newj->>'premium_grant') IS DISTINCT FROM (oldj->>'premium_grant')
     OR (newj->>'subscription_tier') IS DISTINCT FROM (oldj->>'subscription_tier')
     OR (newj->>'plan') IS DISTINCT FROM (oldj->>'plan') THEN
    RAISE EXCEPTION 'plan and premium fields cannot be changed by the client';
  END IF;
  IF (newj->>'trial_granted_at') IS DISTINCT FROM (oldj->>'trial_granted_at') THEN
    RAISE EXCEPTION 'trial_granted_at cannot be changed by the client';
  END IF;
  IF (newj->>'stripe_account_id') IS DISTINCT FROM (oldj->>'stripe_account_id')
     OR (newj->>'stripe_charges_enabled') IS DISTINCT FROM (oldj->>'stripe_charges_enabled')
     OR (newj->>'stripe_payouts_enabled') IS DISTINCT FROM (oldj->>'stripe_payouts_enabled')
     OR (newj->>'stripe_details_submitted') IS DISTINCT FROM (oldj->>'stripe_details_submitted') THEN
    RAISE EXCEPTION 'stripe connect fields cannot be changed by the client';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger already exists (20261006_000400); recreate so this file stands alone.
DROP TRIGGER IF EXISTS organizations_guard_privilege ON public.organizations;
CREATE TRIGGER organizations_guard_privilege
  BEFORE INSERT OR UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.organizations_guard_privilege();

-- Backfill. Keep in step with the _find precheck.
UPDATE public.organizations o
SET trial_granted_at = CASE
    WHEN o.premium_grant = 'complimentary_signup'
      THEN coalesce(o.premium_until - interval '1440 hours', o.created_at)
    WHEN o.premium_grant = 'complimentary_god'
      THEN coalesce(o.updated_at, o.created_at)
    ELSE o.created_at
  END
WHERE o.trial_granted_at IS NULL
  AND (
    o.premium_grant IN ('complimentary_signup', 'complimentary_god')
    OR (
      o.type = 'service_company'
      AND o.created_by IS NOT NULL
      AND o.created_at >= timestamptz '2026-09-14 00:00:00+00'
      AND o.created_at <  timestamptz '2026-10-06 04:01:07+00'
      AND o.premium_grant IS NULL
      AND o.premium_until IS NULL
      AND coalesce(o.is_premium, false) = false
    )
  );

NOTIFY pgrst, 'reload schema';
