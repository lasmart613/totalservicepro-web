-- 000917: atomic shop-created customer orgs, and no founder claim on them.
--
-- Before: app/company addCustomer inserted the customer org from the browser,
-- then inserted the organization_customers link in a second request. Between
-- the two (or forever, if the link failed) the org had no link and no members,
-- so for 24h org_unclaimed_new() was true and its creator (a shop user) could
-- self-insert a founder 'owner' membership (membership_insert_allowed) or call
-- POST /api/org/founder and take over the clinic.
--
-- 1) public.create_shop_customer_org(...): SECURITY DEFINER. The caller must
--    hold a CURRENT company_admin, owner or service_manager membership row in
--    the service org (type service_company/service). Inserts the customer org
--    (type 'customer', created_by = caller) and the organization_customers link
--    in one transaction: a failed link raises and rolls back the org.
-- 2) public.org_founder_claim_allowed(p_org): org_unclaimed_new() AND NOT a
--    customer-side org (customer, laser_clinic, laser_rental, laser_reseller)
--    whose created_by is a member of any service company. org_unclaimed_new()
--    already refuses an org with an organization_customers link.
-- 3) membership_insert_allowed(): founder branch uses org_founder_claim_allowed
--    instead of org_unclaimed_new. Everything else is the live definition.
--    The founder route (/api/org/founder) gets the same check in code.
--
-- Fit with 000916: org_unclaimed_new() and org_creator_access() are NOT
-- changed. org_creator_access (c) still lets a shop user's own fresh insert
-- read/update the new org before the link exists (other customer-create paths:
-- service reports, customer form, invite). Only the founder claim is narrowed.
-- Precheck (live 2026-10-15): 0 customer-side orgs without a link were created
-- by a shop user; 0 creators hold an owner membership on a shop-created or
-- linked customer org. Nothing existing changes state.
--
-- APPLY after review, before or with the app deploy (the app falls back to
-- nothing: /company "Add customer" calls the RPC, so deploy the migration
-- first). One transaction. Safe to re-run.
-- Rollback: 20261015_000917_customer_org_atomic_founder_block_rollback.sql

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.org_founder_claim_allowed(p_org bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = p_org
      AND public.org_unclaimed_new(o.id, o.created_at)
      AND NOT (
        lower(btrim(coalesce(o.type, ''))) IN ('customer', 'laser_clinic', 'laser_rental', 'laser_reseller')
        AND o.created_by IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.organization_memberships m
          JOIN public.organizations s ON s.id = m.organization_id
          WHERE m.user_id = o.created_by
            AND lower(btrim(coalesce(s.type, ''))) IN ('service_company', 'service')
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.org_founder_claim_allowed(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_founder_claim_allowed(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.membership_insert_allowed(p_user_id uuid, p_organization_id bigint, p_role text, p_is_home boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_user_id IS NOT DISTINCT FROM auth.uid()
    AND (
      (
        -- Founder of a brand-new org only: a creator can't join a customer
        -- org that a shop already serves, that already has members, or that a
        -- shop user created (000917).
        EXISTS (
          SELECT 1 FROM public.organizations o
          WHERE o.id = p_organization_id
            AND o.created_by = auth.uid()
            AND public.org_founder_claim_allowed(o.id)
        )
        AND lower(btrim(coalesce(p_role, ''))) IN (
          public.founder_role_for_org(p_organization_id),
          'fse', 'engineer', 'technician'
        )
        AND lower(btrim(coalesce(p_role, ''))) <> 'admin'
      )
      OR (
        COALESCE(p_is_home, false) = false
        AND lower(btrim(coalesce(p_role, ''))) <> 'admin'
        AND EXISTS (
          SELECT 1 FROM public.engineer_invitations i
          WHERE i.organization_id = p_organization_id
            AND public.auth_login_email() IS NOT NULL
            AND lower(btrim(i.email)) = public.auth_login_email()
            AND public.invitation_is_open(i.accepted, i.expires_at, i.created_at)
            AND lower(btrim(coalesce(p_role, ''))) = public.profile_role_from_membership(
              coalesce(NULLIF(TRIM(i.role), ''), 'fse')
            )
        )
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.create_shop_customer_org(
  p_service_org bigint,
  p_name text,
  p_address text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_laser_models text DEFAULT NULL,
  p_facility_type text DEFAULT 'Clinic'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  uid uuid := auth.uid();
  new_id bigint;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_service_org IS NULL OR nullif(btrim(coalesce(p_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'service organization and customer name are required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    JOIN public.organizations s ON s.id = m.organization_id
    WHERE m.user_id = uid
      AND m.organization_id = p_service_org
      AND lower(btrim(coalesce(m.role, ''))) IN ('company_admin', 'owner', 'service_manager')
      AND lower(btrim(coalesce(s.type, ''))) IN ('service_company', 'service')
  ) THEN
    RAISE EXCEPTION 'only a current manager of this service company can add customers' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.organizations (name, type, created_by, address, city, state, phone, laser_models, facility_type)
  VALUES (
    btrim(p_name), 'customer', uid,
    nullif(btrim(coalesce(p_address, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_state, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_laser_models, '')), ''),
    coalesce(nullif(btrim(coalesce(p_facility_type, '')), ''), 'Clinic')
  )
  RETURNING id INTO new_id;

  -- Same transaction: if this raises, the org above is rolled back too.
  INSERT INTO public.organization_customers (service_organization_id, customer_organization_id, created_by)
  VALUES (p_service_org, new_id, uid);

  RETURN new_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_shop_customer_org(bigint, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_shop_customer_org(bigint, text, text, text, text, text, text, text) TO authenticated, service_role;
