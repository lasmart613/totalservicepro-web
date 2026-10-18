-- Rollback for 20261017_000924_clinic_claim_hardening.sql.
-- Restores the 000923 state exactly: the four replaced functions get their
-- 000923 bodies back (verbatim), the new triggers/functions, the departures
-- email column, its constraint and index are dropped, and service_role gets
-- back the table/sequence privileges 000924 revoked (Supabase default
-- privileges for tables created by postgres: arwdDxtm; sequences: rwU).
-- Voided invites stay voided (revoked_reason 'owner_removed'); that is data,
-- not schema, and only makes a removed owner's old invite unusable.

SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_void_clinic_owner_invite_on_owner_removal ON public.organization_memberships;
DROP FUNCTION IF EXISTS public.void_clinic_owner_invite_on_owner_removal();
DROP TRIGGER IF EXISTS trg_record_departure_emails_on_account_delete ON auth.users;
DROP FUNCTION IF EXISTS public.record_departure_emails_on_account_delete();

GRANT INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON TABLE public.clinic_owner_invites,
  public.clinic_reach_email_changes, public.organization_membership_departures
  TO service_role;
GRANT USAGE, UPDATE ON SEQUENCE public.clinic_reach_email_changes_id_seq,
  public.organization_membership_departures_id_seq TO service_role;

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
  )
  SELECT EXISTS (
    SELECT 1 FROM public.organization_memberships m JOIN shops ON shops.shop_id = m.organization_id
    WHERE m.user_id = p_user
  ) OR EXISTS (
    SELECT 1 FROM public.organization_membership_departures d JOIN shops ON shops.shop_id = d.organization_id
    WHERE d.user_id = p_user
      AND d.left_at > now() - interval '30 days'
  );
$function$;

CREATE OR REPLACE FUNCTION public.log_membership_departure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE'
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    INSERT INTO public.organization_membership_departures (user_id, organization_id, role)
    VALUES (OLD.user_id, OLD.organization_id, OLD.role);
  END IF;
  RETURN NULL;
END;
$function$;

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
  ) THEN
    RAISE EXCEPTION 'the owner of a clinic a service company added is set only by accepting its owner invite'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

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

  SELECT * INTO inv FROM public.clinic_owner_invites i WHERE i.id = p_invite_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invite_invalid');
  END IF;

  SELECT * INTO v_org FROM public.organizations o WHERE o.id = inv.customer_organization_id FOR UPDATE;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tsp.clinic_owner:' || inv.customer_organization_id::text, 0));
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

DROP INDEX IF EXISTS public.organization_membership_departures_email;
ALTER TABLE public.organization_membership_departures
  DROP CONSTRAINT IF EXISTS organization_membership_departures_email_normalized;
ALTER TABLE public.organization_membership_departures
  DROP COLUMN IF EXISTS email;

NOTIFY pgrst, 'reload schema';
