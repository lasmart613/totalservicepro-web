-- 000924: hardening for 000923 (clinic owner invites), from the PR #315 QA.
--
-- ORDERING: needs 000923. Independent of 000922 (teaser history requests):
-- no object is shared, either order works.
--
-- L-1 Deadlock between issue_clinic_owner_invite and claim_clinic_owner_invite.
--     issue locked the clinic row, then the advisory lock, then invite rows;
--     claim locked the invite row first, then the clinic. claim now reads the
--     invite's clinic without a lock, locks the clinic row, takes the advisory
--     lock, and only then locks the invite row (re-checking its clinic). Both
--     paths now lock clinic -> advisory -> invite.
-- L-2 The 30-day / staff rule matched the user id only, so a leaver who
--     deleted their account and signed up again at the same address passed.
--     organization_membership_departures gets the normalized email (backfilled
--     from auth.users for rows already logged), recorded on every departure,
--     including account deletion (BEFORE DELETE trigger on auth.users, because
--     the cascade deletes the login before the membership rows go).
--     A departure stores the email only when the normalized value is at most
--     320 characters, otherwise NULL: an over-long legacy profile email would
--     overflow the departures email index and block the membership removal
--     (or the account deletion). The departure row itself is always written.
--     clinic_shop_staff_now_or_recent matches on the user id OR the claimant's
--     login email (current members' login emails and departure emails).
-- L-3 service_role kept INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER (Supabase default
--     privileges) on clinic_owner_invites, clinic_reach_email_changes and
--     organization_membership_departures, so a service-role path could forge a
--     consumed invite or rewrite the logs. Those are revoked (plus USAGE/UPDATE
--     on the two log sequences); the SECURITY DEFINER functions still write.
--     service_role keeps SELECT. clinic_claim_emails is unchanged (support
--     re-binds it with the service role). A consumed invite is voided
--     (revoked_reason 'owner_removed') when that owner's membership is
--     removed, demoted or moved, and the membership guard ignores voided
--     invites, so a removed owner cannot be re-seated by a later write.
-- L-4 is app-only (the claim route trusts the database's email of record).
--
-- APPLY after review, BEFORE the app deploy. One transaction. Safe to re-run.
-- Rollback: 20261017_000924_clinic_claim_hardening_rollback.sql

SET LOCAL lock_timeout = '5s';

-- L-2: departures keep the email.
ALTER TABLE public.organization_membership_departures
  ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.organization_membership_departures
  DROP CONSTRAINT IF EXISTS organization_membership_departures_email_normalized;
ALTER TABLE public.organization_membership_departures
  ADD CONSTRAINT organization_membership_departures_email_normalized
  CHECK (email IS NULL OR (email = lower(btrim(email)) AND email <> ''));
CREATE INDEX IF NOT EXISTS organization_membership_departures_email
  ON public.organization_membership_departures (email, organization_id, left_at)
  WHERE email IS NOT NULL;

UPDATE public.organization_membership_departures d
SET email = CASE WHEN length(lower(btrim(u.email))) <= 320 THEN nullif(lower(btrim(u.email)), '') END
FROM auth.users u
WHERE u.id = d.user_id
  AND d.email IS NULL;

CREATE OR REPLACE FUNCTION public.log_membership_departure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_email text;
BEGIN
  IF TG_OP = 'DELETE'
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    -- L-2 (000924): keep the normalized email so a new account at the same
    -- address is still recognised. Login email first, then the profile, then
    -- the last email recorded for this user (account deletion: see
    -- record_departure_emails_on_account_delete). An email longer than 320
    -- characters is not kept (it would overflow the email index and block
    -- the removal); the departure is still logged.
    SELECT nullif(lower(btrim(coalesce(u.email, ''))), '') INTO v_email
    FROM auth.users u WHERE u.id = OLD.user_id;
    IF length(v_email) > 320 THEN
      v_email := NULL;
    END IF;
    IF v_email IS NULL THEN
      SELECT nullif(lower(btrim(coalesce(p.email, ''))), '') INTO v_email
      FROM public.user_profiles p WHERE p.id = OLD.user_id;
      IF length(v_email) > 320 THEN
        v_email := NULL;
      END IF;
    END IF;
    IF v_email IS NULL THEN
      SELECT d.email INTO v_email
      FROM public.organization_membership_departures d
      WHERE d.user_id = OLD.user_id AND d.email IS NOT NULL
      ORDER BY d.left_at DESC, d.id DESC
      LIMIT 1;
    END IF;
    INSERT INTO public.organization_membership_departures (user_id, organization_id, role, email)
    VALUES (OLD.user_id, OLD.organization_id, OLD.role, v_email);
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clinic_shop_staff_now_or_recent(p_org bigint, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH shops AS (
    SELECT oc.service_organization_id AS shop_id
    FROM public.organization_customers oc
    WHERE oc.customer_organization_id = p_org
    UNION
    SELECT o.creator_shop_org_id FROM public.organizations o
    WHERE o.id = p_org AND o.creator_shop_org_id IS NOT NULL
  ), me AS (
    SELECT nullif(lower(btrim(coalesce(u.email, ''))), '') AS email
    FROM auth.users u WHERE u.id = p_user
  )
  SELECT EXISTS (
    SELECT 1 FROM public.organization_memberships m JOIN shops ON shops.shop_id = m.organization_id
    WHERE m.user_id = p_user
  ) OR EXISTS (
    -- L-2 (000924): the same email on a current member's login.
    SELECT 1
    FROM public.organization_memberships m
    JOIN shops ON shops.shop_id = m.organization_id
    JOIN auth.users u ON u.id = m.user_id
    JOIN me ON me.email IS NOT NULL AND lower(btrim(coalesce(u.email, ''))) = me.email
  ) OR EXISTS (
    SELECT 1 FROM public.organization_membership_departures d JOIN shops ON shops.shop_id = d.organization_id
    WHERE d.left_at > now() - interval '30 days'
      AND (
        d.user_id = p_user
        -- L-2 (000924): or the email they left with (a new account, same address).
        OR (d.email IS NOT NULL AND d.email = (SELECT me.email FROM me))
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.record_departure_emails_on_account_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- The memberships are removed by the auth.users FK cascade after the login
  -- row is gone; log them here while the email is still readable. An email
  -- longer than 320 characters is stored as NULL (index limit).
  INSERT INTO public.organization_membership_departures (user_id, organization_id, role, email)
  SELECT m.user_id, m.organization_id, m.role,
    CASE WHEN length(lower(btrim(OLD.email))) <= 320 THEN nullif(lower(btrim(OLD.email)), '') END
  FROM public.organization_memberships m
  WHERE m.user_id = OLD.id;
  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_departure_emails_on_account_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_record_departure_emails_on_account_delete ON auth.users;
CREATE TRIGGER trg_record_departure_emails_on_account_delete
  BEFORE DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.record_departure_emails_on_account_delete();

-- L-3: writes only through the definer functions.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON TABLE public.clinic_owner_invites,
  public.clinic_reach_email_changes, public.organization_membership_departures
  FROM service_role;
REVOKE USAGE, UPDATE ON SEQUENCE public.clinic_reach_email_changes_id_seq,
  public.organization_membership_departures_id_seq FROM service_role;

-- L-3: a consumed invite is void once its owner is removed.
CREATE OR REPLACE FUNCTION public.void_clinic_owner_invite_on_owner_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF lower(btrim(coalesce(OLD.role, ''))) NOT IN ('owner', 'customer') THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
     AND lower(btrim(coalesce(NEW.role, ''))) IN ('owner', 'customer') THEN
    RETURN NULL;
  END IF;
  UPDATE public.clinic_owner_invites i
  SET revoked_at = now(), revoked_reason = 'owner_removed'
  WHERE i.customer_organization_id = OLD.organization_id
    AND i.consumed_by = OLD.user_id
    AND i.consumed_at IS NOT NULL
    AND i.revoked_at IS NULL;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.void_clinic_owner_invite_on_owner_removal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_void_clinic_owner_invite_on_owner_removal ON public.organization_memberships;
CREATE TRIGGER trg_void_clinic_owner_invite_on_owner_removal
  AFTER DELETE OR UPDATE OF role, user_id, organization_id ON public.organization_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.void_clinic_owner_invite_on_owner_removal();

CREATE OR REPLACE FUNCTION public.guard_clinic_owner_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF lower(btrim(coalesce(NEW.role, ''))) NOT IN ('owner', 'customer') THEN
    RETURN NEW;
  END IF;
  IF NOT public.clinic_is_customer_side(NEW.organization_id) THEN
    RETURN NEW;
  END IF;
  -- An owner re-saving their own row (role unchanged in kind).
  IF TG_OP = 'UPDATE'
     AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
     AND lower(btrim(coalesce(OLD.role, ''))) IN ('owner', 'customer') THEN
    RETURN NEW;
  END IF;

  -- Serializes owner writes per clinic with claim_clinic_owner_invite.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tsp.clinic_owner:' || NEW.organization_id::text, 0));

  -- INSERT ... ON CONFLICT for a row that is already this user's owner row.
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.user_id = NEW.user_id
      AND m.organization_id = NEW.organization_id
      AND lower(btrim(coalesce(m.role, ''))) IN ('owner', 'customer')
  ) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.organization_id = NEW.organization_id
      AND m.user_id IS DISTINCT FROM NEW.user_id
      AND lower(btrim(coalesce(m.role, ''))) IN ('owner', 'customer')
  ) THEN
    RAISE EXCEPTION 'this clinic already has an owner' USING ERRCODE = '23505';
  END IF;

  IF (
    EXISTS (SELECT 1 FROM public.organization_customers oc WHERE oc.customer_organization_id = NEW.organization_id)
    OR EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = NEW.organization_id AND o.creator_shop_org_id IS NOT NULL)
  ) AND NOT EXISTS (
    SELECT 1 FROM public.clinic_owner_invites i
    WHERE i.customer_organization_id = NEW.organization_id
      AND i.consumed_by = NEW.user_id
      AND i.consumed_at IS NOT NULL
      AND i.revoked_at IS NULL  -- 000924: voided when that owner was removed
  ) THEN
    RAISE EXCEPTION 'the owner of a clinic a service company added is set only by accepting its owner invite'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- L-1: lock order clinic -> advisory -> invite.
CREATE OR REPLACE FUNCTION public.claim_clinic_owner_invite(
  p_invite_id uuid,
  p_user_id uuid,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  inv public.clinic_owner_invites%ROWTYPE;
  v_org_id bigint;
  v_org public.organizations%ROWTYPE;
  v_record text;
  v_auth_email text;
  v_confirmed timestamptz;
  v_profile_org bigint;
  v_profile_exists boolean;
  v_owners integer;
BEGIN
  IF p_invite_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invite_invalid');
  END IF;

  -- L-1 (000924): same lock order as issue_clinic_owner_invite: the clinic
  -- row, then the per-clinic advisory lock, then the invite row. Read the
  -- invite's clinic without a lock first (it never changes), then re-check it
  -- under the lock.
  SELECT i.customer_organization_id INTO v_org_id
  FROM public.clinic_owner_invites i WHERE i.id = p_invite_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invite_invalid');
  END IF;

  SELECT * INTO v_org FROM public.organizations o WHERE o.id = v_org_id FOR UPDATE;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tsp.clinic_owner:' || v_org_id::text, 0));

  SELECT * INTO inv FROM public.clinic_owner_invites i WHERE i.id = p_invite_id FOR UPDATE;
  IF NOT FOUND OR inv.customer_organization_id IS DISTINCT FROM v_org_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invite_invalid');
  END IF;
  IF v_org.id IS NULL OR NOT public.clinic_is_customer_side(v_org.id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_clinic');
  END IF;

  -- Idempotent re-claim by the person who consumed it.
  IF inv.consumed_at IS NOT NULL THEN
    IF inv.consumed_by = p_user_id AND EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = p_user_id AND m.organization_id = v_org.id
        AND lower(btrim(coalesce(m.role, ''))) IN ('owner', 'customer')
    ) THEN
      RETURN jsonb_build_object('ok', true, 'organization_id', v_org.id, 'already_linked', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'invite_used');
  END IF;
  IF inv.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invite_revoked');
  END IF;
  IF inv.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invite_expired');
  END IF;

  SELECT ce.email INTO v_record
  FROM public.clinic_claim_emails ce
  WHERE ce.customer_organization_id = v_org.id;
  IF v_record IS NULL OR v_record <> inv.email THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invite_not_email_of_record');
  END IF;

  SELECT lower(btrim(u.email)), u.email_confirmed_at INTO v_auth_email, v_confirmed
  FROM auth.users u WHERE u.id = p_user_id;
  IF v_auth_email IS NULL OR v_auth_email <> inv.email THEN
    RETURN jsonb_build_object('ok', false, 'code', 'email_mismatch');
  END IF;
  IF v_confirmed IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'email_unconfirmed');
  END IF;

  IF public.clinic_owner_slot_taken(v_org.id, p_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'owner_exists');
  END IF;

  SELECT true, p.organization_id INTO v_profile_exists, v_profile_org
  FROM public.user_profiles p WHERE p.id = p_user_id FOR UPDATE;
  IF v_profile_org IS NOT NULL AND v_profile_org <> v_org.id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'other_org');
  END IF;

  IF p_user_id = v_org.created_by
     OR p_user_id = inv.invited_by
     OR public.clinic_shop_staff_now_or_recent(v_org.id, p_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'shop_staff');
  END IF;

  -- Consume first: the membership guard looks for this row.
  UPDATE public.clinic_owner_invites i
  SET consumed_at = now(), consumed_by = p_user_id
  WHERE i.id = inv.id;
  UPDATE public.clinic_owner_invites i
  SET revoked_at = now(), revoked_reason = 'claimed'
  WHERE i.customer_organization_id = v_org.id
    AND i.id <> inv.id
    AND i.consumed_at IS NULL
    AND i.revoked_at IS NULL;

  IF coalesce(v_profile_exists, false) THEN
    UPDATE public.user_profiles p
    SET organization_id = v_org.id,
        role = 'owner',
        onboarding_completed = true,
        email = v_auth_email,
        first_name = coalesce(p.first_name, nullif(btrim(coalesce(p_first_name, '')), '')),
        last_name = coalesce(p.last_name, nullif(btrim(coalesce(p_last_name, '')), ''))
    WHERE p.id = p_user_id;
  ELSE
    INSERT INTO public.user_profiles (id, email, first_name, last_name, role, organization_id, onboarding_completed)
    VALUES (p_user_id, v_auth_email, nullif(btrim(coalesce(p_first_name, '')), ''),
      nullif(btrim(coalesce(p_last_name, '')), ''), 'owner', v_org.id, true);
  END IF;

  PERFORM public.set_home_membership(p_user_id, v_org.id, 'owner', true);

  SELECT count(*)::integer INTO v_owners
  FROM public.organization_memberships m
  WHERE m.organization_id = v_org.id
    AND lower(btrim(coalesce(m.role, ''))) IN ('owner', 'customer');
  IF v_owners <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.organization_id = v_org.id AND m.user_id = p_user_id AND lower(m.role) = 'owner'
  ) THEN
    RAISE EXCEPTION 'claim left % owner memberships', v_owners USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('ok', true, 'organization_id', v_org.id, 'already_linked', false);
END;
$function$;

NOTIFY pgrst, 'reload schema';
