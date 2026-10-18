-- FIXTURE COPY (test only, never apply): 000923 exactly as on origin
-- fix/clinic-claim-invite-binding @ 168d4f6a, web/supabase/migrations/20261017_000923_clinic_claim_invite_binding.sql.
-- The 000922 proof applies it before 000922 (ordering, QA #314 L-B).
-- 000923: clinic owner invites and claims are bound to the database.
--
-- ORDERING: needs 000919 (organizations.creator_shop_org_id), 000920 and
-- 000921 applied (they are, prod 2026-10-17). Independent of 000922 (teaser
-- history requests, unapplied): no object is shared, either order works.
--
-- The hole (nightly review, main 56c47308): a shop employee takes the owner
-- seat on a clinic the shop created and nobody has claimed:
--   1. they point the clinic's reach email at a mailbox they control (any
--      linked-shop member may write a primary contacts row; the creator may
--      also edit organizations.email / directory_contacts while unclaimed),
--   2. POST /api/customers/invite (canAddCustomers is true for every
--      non-supplier role on a service company) signs a claim token for it,
--   3. they sign up at that mailbox with a fresh account and
--   4. POST /api/customers/claim, which checked only user_profiles, writes
--      role owner and an owner membership with the service role.
-- A retargeted claim could also leave a second owner membership, because
-- the owner check read user_profiles only.
--
-- Why 000919 did not stop it: trg_guard_stamped_org_membership refuses only
-- the clinic's creator and CURRENT members of the stamp shop. The chain uses
-- a brand-new account (neither). Also, stamps start empty (no backfill), so
-- the 38 shop-created clinics in prod have no stamp at all, and the guard
-- looks at the stamp shop only, not every linked shop, and never at people
-- who left.
--
-- The rule (database; the app mirrors it):
--  1) Invites: issue_clinic_owner_invite(shop, clinic, email). Caller must be
--     owner, company_admin or admin (membership role) of a service company
--     linked to the clinic; the clinic must have no owner (membership or
--     profile role owner/customer); the email must be on the clinic now. The
--     invite is a row (clinic_owner_invites); the claim token carries its id.
--     5 invites per clinic per 24h (PT429). A new invite supersedes the open
--     one.
--  2) Email of record (clinic_claim_emails): the first invite records the
--     email it went to. Later invites may only go to that email. Changing it
--     is a support action (service role), after confirming with the clinic out
--     of band. So editing the clinic's email later never moves the claim.
--  3) Staff edits before the first invite: client changes to a clinic's reach
--     email fields (organizations.email, organizations.directory_contacts,
--     contacts.email / is_primary / rows) on an unowned customer-side org are
--     logged in clinic_reach_email_changes. If someone who is NOT an admin of
--     a linked shop changed them since the last invite, the invite is refused
--     (code confirm_required) unless the admin passes
--     p_confirmed_out_of_band => true (the app asks them to confirm the
--     address with the clinic first); that is recorded on the invite.
--  4) Claims: claim_clinic_owner_invite(invite, user) (service role only),
--     one transaction, clinic row + invite row locked, plus a per-clinic
--     advisory lock shared with the membership guard. Refused unless: the
--     invite is open, its email is the email of record, the user's confirmed
--     auth email is that email, the clinic has no owner, the user's profile is
--     not linked to another org, and the user is not the clinic's creator,
--     not the inviter, and not a member (now, or within 30 days) of the stamp
--     shop or of any linked shop. Then it consumes the invite and writes the
--     profile and the owner home membership.
--  5) Guard on organization_memberships (every caller, service role too): an
--     owner/customer membership on a customer-side org is refused if another
--     user already holds one (23505), and, on a clinic that is linked to a
--     shop or stamped, unless that user holds a consumed invite for it
--     (42501). An existing owner re-saving their own row is unaffected.
--     Self-signup (unlinked, unstamped clinic) is unaffected.
--  6) organization_membership_departures logs removed memberships (forward
--     only, no history before this migration) for the 30-day rule.
--
-- Residual risk (documented in the PR): a shop admin who deliberately puts a
-- mailbox they control on the clinic and invites it can still seat an
-- account; only out-of-band verification of the clinic (phone, domain,
-- document) closes that. Every invite records invited_by and the email.
--
-- Precheck (prod, read-only, 2026-10-17): 1778 customer-side orgs, 38
-- shop-created, 0 stamped; 13 owner memberships on customer-side orgs, all
-- single (0 clinics with two owner-slot memberships, 0 with two owner
-- profiles, 0 'customer' role memberships); 2 owners on shop-created clinics
-- (2668, 2669: QA fixtures under shop 2639). The guard only checks new
-- writes, so no existing row is touched.
--
-- APPLY after review, BEFORE the app deploy. One transaction. Safe to re-run.
-- Rollback: 20261017_000923_clinic_claim_invite_binding_rollback.sql

SET LOCAL lock_timeout = '5s';

-- Tables. RLS on, no policies: clients reach them only through the functions.
CREATE TABLE IF NOT EXISTS public.clinic_owner_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  service_organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1),
  invited_by uuid NOT NULL,
  confirmed_out_of_band boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by uuid,
  revoked_at timestamptz,
  revoked_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS clinic_owner_invites_one_open
  ON public.clinic_owner_invites (customer_organization_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS clinic_owner_invites_org_created
  ON public.clinic_owner_invites (customer_organization_id, created_at);
CREATE INDEX IF NOT EXISTS clinic_owner_invites_consumed_by
  ON public.clinic_owner_invites (consumed_by, customer_organization_id)
  WHERE consumed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.clinic_claim_emails (
  customer_organization_id bigint PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1),
  recorded_by uuid,
  recorded_via text NOT NULL CHECK (recorded_via IN ('first_invite', 'support')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clinic_reach_email_changes (
  id bigserial PRIMARY KEY,
  customer_organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  changed_by uuid NOT NULL,
  by_shop_admin boolean NOT NULL,
  source text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinic_reach_email_changes_org
  ON public.clinic_reach_email_changes (customer_organization_id, changed_at);

CREATE TABLE IF NOT EXISTS public.organization_membership_departures (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  organization_id bigint NOT NULL,
  role text,
  left_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organization_membership_departures_user
  ON public.organization_membership_departures (user_id, organization_id, left_at);

ALTER TABLE public.clinic_owner_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_claim_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_reach_email_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_membership_departures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.clinic_owner_invites, public.clinic_claim_emails,
  public.clinic_reach_email_changes, public.organization_membership_departures
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.clinic_reach_email_changes_id_seq,
  public.organization_membership_departures_id_seq FROM PUBLIC, anon, authenticated;
-- The invite preview and claim routes read invites with the service role.
GRANT SELECT ON TABLE public.clinic_owner_invites, public.clinic_claim_emails TO service_role;

-- Helpers (internal; not executable by clients).
CREATE OR REPLACE FUNCTION public.clinic_is_customer_side(p_org bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = p_org
      AND lower(btrim(coalesce(o.type, ''))) IN ('customer', 'laser_clinic', 'laser_rental', 'laser_reseller')
  );
$function$;

-- Someone other than p_except holds the clinic's owner slot (owner or legacy
-- customer), by membership OR by profile.
CREATE OR REPLACE FUNCTION public.clinic_owner_slot_taken(p_org bigint, p_except uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.organization_id = p_org
      AND lower(btrim(coalesce(m.role, ''))) IN ('owner', 'customer')
      AND m.user_id IS DISTINCT FROM p_except
  ) OR EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.organization_id = p_org
      AND lower(btrim(coalesce(p.role, ''))) IN ('owner', 'customer')
      AND p.id IS DISTINCT FROM p_except
  );
$function$;

-- p_user is an owner/company_admin/admin of a service company linked to the clinic.
CREATE OR REPLACE FUNCTION public.clinic_linked_shop_admin(p_org bigint, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.organization_customers oc
    JOIN public.organization_memberships m ON m.organization_id = oc.service_organization_id
    JOIN public.organizations s ON s.id = oc.service_organization_id
    WHERE oc.customer_organization_id = p_org
      AND m.user_id = p_user
      AND lower(btrim(coalesce(m.role, ''))) IN ('owner', 'company_admin', 'admin')
      AND lower(btrim(coalesce(s.type, ''))) IN ('service_company', 'service')
  );
$function$;

-- p_user is, or within 30 days was, a member of the clinic's stamp shop or of
-- any shop linked to it.
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

-- The email appears on the clinic now (office email, a contacts row, or any
-- email in directory_contacts).
CREATE OR REPLACE FUNCTION public.clinic_has_email(p_org bigint, p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT nullif(lower(btrim(coalesce(p_email, ''))), '') IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = p_org AND lower(btrim(coalesce(o.email, ''))) = lower(btrim(p_email))
    ) OR EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.organization_id = p_org AND lower(btrim(coalesce(c.email, ''))) = lower(btrim(p_email))
    ) OR EXISTS (
      SELECT 1
      FROM public.organizations o,
           LATERAL pg_catalog.jsonb_path_query(coalesce(o.directory_contacts, '{}'::jsonb), 'lax $.**.email') AS e(v)
      WHERE o.id = p_org
        AND pg_catalog.jsonb_typeof(e.v) = 'string'
        AND lower(btrim(e.v #>> '{}')) = lower(btrim(p_email))
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.clinic_is_customer_side(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clinic_owner_slot_taken(bigint, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clinic_linked_shop_admin(bigint, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clinic_shop_staff_now_or_recent(bigint, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clinic_has_email(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clinic_is_customer_side(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.clinic_owner_slot_taken(bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.clinic_linked_shop_admin(bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.clinic_shop_staff_now_or_recent(bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.clinic_has_email(bigint, text) TO service_role;

-- 3) Log client changes to an unowned clinic's reach email fields.
CREATE OR REPLACE FUNCTION public.log_clinic_reach_email_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_org bigint;
  v_old_org bigint;
BEGIN
  IF uid IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'organizations' THEN
    IF NEW.email IS NOT DISTINCT FROM OLD.email
       AND NEW.directory_contacts IS NOT DISTINCT FROM OLD.directory_contacts THEN
      RETURN NULL;
    END IF;
    v_org := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_org := OLD.organization_id;
  ELSE
    v_org := NEW.organization_id;
    IF TG_OP = 'UPDATE' THEN
      v_old_org := OLD.organization_id;
    END IF;
  END IF;

  INSERT INTO public.clinic_reach_email_changes (customer_organization_id, changed_by, by_shop_admin, source)
  SELECT x.org, uid, public.clinic_linked_shop_admin(x.org, uid), TG_TABLE_NAME || ':' || lower(TG_OP)
  FROM (SELECT DISTINCT unnest(ARRAY[v_org, v_old_org]) AS org) x
  WHERE x.org IS NOT NULL
    AND public.clinic_is_customer_side(x.org)
    AND NOT public.clinic_owner_slot_taken(x.org, NULL);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.log_clinic_reach_email_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_log_clinic_reach_email_change ON public.organizations;
CREATE TRIGGER trg_log_clinic_reach_email_change
  AFTER UPDATE OF email, directory_contacts ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.log_clinic_reach_email_change();

DROP TRIGGER IF EXISTS trg_log_clinic_reach_email_change ON public.contacts;
CREATE TRIGGER trg_log_clinic_reach_email_change
  AFTER INSERT OR DELETE OR UPDATE OF email, is_primary, organization_id ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.log_clinic_reach_email_change();

-- 6) Departures (for the 30-day rule).
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

REVOKE ALL ON FUNCTION public.log_membership_departure() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_log_membership_departure ON public.organization_memberships;
CREATE TRIGGER trg_log_membership_departure
  AFTER DELETE OR UPDATE OF user_id, organization_id ON public.organization_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.log_membership_departure();

-- 5) One owner per clinic; on a shop-linked or stamped clinic, only through a
--    consumed invite. Every caller (service role, set_home_membership and the
--    user_profiles sync trigger included).
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

REVOKE ALL ON FUNCTION public.guard_clinic_owner_membership() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_clinic_owner_membership ON public.organization_memberships;
CREATE TRIGGER trg_guard_clinic_owner_membership
  BEFORE INSERT OR UPDATE OF role, user_id, organization_id ON public.organization_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_clinic_owner_membership();

-- 1) + 2) + 3) Issue an owner invite (signed-in shop admin).
CREATE OR REPLACE FUNCTION public.issue_clinic_owner_invite(
  p_service_org bigint,
  p_customer_org bigint,
  p_email text,
  p_confirmed_out_of_band boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_record text;
  v_last_invite timestamptz;
  v_staff_change boolean;
  v_count integer;
  v_id uuid;
  v_expires timestamptz;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_signed_in');
  END IF;
  IF p_service_org IS NULL OR p_customer_org IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_request');
  END IF;
  IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR char_length(v_email) > 254 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_email');
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    JOIN public.organizations s ON s.id = m.organization_id
    WHERE m.user_id = uid
      AND m.organization_id = p_service_org
      AND lower(btrim(coalesce(m.role, ''))) IN ('owner', 'company_admin', 'admin')
      AND lower(btrim(coalesce(s.type, ''))) IN ('service_company', 'service')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_shop_admin');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_customers oc
    WHERE oc.service_organization_id = p_service_org
      AND oc.customer_organization_id = p_customer_org
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_linked');
  END IF;

  PERFORM 1 FROM public.organizations o WHERE o.id = p_customer_org FOR UPDATE;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tsp.clinic_owner:' || p_customer_org::text, 0));

  IF NOT public.clinic_is_customer_side(p_customer_org) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_clinic');
  END IF;
  IF public.clinic_owner_slot_taken(p_customer_org, NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'owner_exists');
  END IF;
  IF NOT public.clinic_has_email(p_customer_org, v_email) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'email_not_on_clinic');
  END IF;

  SELECT ce.email INTO v_record
  FROM public.clinic_claim_emails ce
  WHERE ce.customer_organization_id = p_customer_org;
  IF v_record IS NOT NULL AND v_record <> v_email THEN
    RETURN jsonb_build_object('ok', false, 'code', 'email_of_record_differs');
  END IF;

  SELECT max(i.created_at) INTO v_last_invite
  FROM public.clinic_owner_invites i
  WHERE i.customer_organization_id = p_customer_org;
  SELECT EXISTS (
    SELECT 1 FROM public.clinic_reach_email_changes c
    WHERE c.customer_organization_id = p_customer_org
      AND c.by_shop_admin IS FALSE
      AND c.changed_by IS DISTINCT FROM uid
      AND (v_last_invite IS NULL OR c.changed_at > v_last_invite)
  ) INTO v_staff_change;
  IF v_staff_change AND NOT coalesce(p_confirmed_out_of_band, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'confirm_required');
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.clinic_owner_invites i
  WHERE i.customer_organization_id = p_customer_org
    AND i.created_at > now() - interval '24 hours';
  IF v_count >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rate_limited');
  END IF;

  UPDATE public.clinic_owner_invites i
  SET revoked_at = now(), revoked_reason = 'superseded'
  WHERE i.customer_organization_id = p_customer_org
    AND i.consumed_at IS NULL
    AND i.revoked_at IS NULL;

  v_expires := now() + interval '30 days';
  INSERT INTO public.clinic_owner_invites
    (customer_organization_id, service_organization_id, email, invited_by, confirmed_out_of_band, expires_at)
  VALUES (p_customer_org, p_service_org, v_email, uid, v_staff_change, v_expires)
  RETURNING id INTO v_id;

  IF v_record IS NULL THEN
    INSERT INTO public.clinic_claim_emails (customer_organization_id, email, recorded_by, recorded_via)
    VALUES (p_customer_org, v_email, uid, 'first_invite');
  END IF;

  RETURN jsonb_build_object('ok', true, 'invite_id', v_id, 'email', v_email, 'expires_at', v_expires);
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_clinic_owner_invite(bigint, bigint, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_clinic_owner_invite(bigint, bigint, text, boolean) TO authenticated, service_role;

-- 4) Claim (service role; the route has verified the user's session).
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

REVOKE ALL ON FUNCTION public.claim_clinic_owner_invite(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_clinic_owner_invite(uuid, uuid, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
