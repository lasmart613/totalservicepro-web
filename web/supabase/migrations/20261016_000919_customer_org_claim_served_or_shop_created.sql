-- 000919: a customer org a shop user created, or that a shop already served,
-- is never founder-claimable, even after the shop user leaves the shop.
--
-- ORDERING: 000918 is reserved by PR #307 (manual search index catch-up). The
-- two migrations touch different objects and can be applied in either order.
--
-- The hole (after #304 / 000917): org_founder_claim_allowed refused a
-- customer-side org only while its created_by was STILL a member of a service
-- company. Three client paths inserted a type='customer' org without (or
-- without reliably) an organization_customers link:
--   NewServiceReportClient ensureCustomerOrg (no link at all),
--   NewServiceReportClient handleAddNewCustomer (link failure ignored),
--   lib/customer-form createLinkedCustomer (org kept when the link failed).
-- A shop user could create such an org, POST /api/org/leave, then within 24h
-- POST /api/org/founder (or self-insert a founder membership through
-- membership_insert_allowed) and become the clinic's owner, which also opens
-- its service reports (can_view_service_report_for_history).
--
-- 1) organizations.creator_shop_org_id (new, nullable, no backfill): a
--    service company the creator belonged to when the row was inserted. Set
--    by trigger trg_stamp_org_creator_shop on every INSERT (any type, so a
--    later type change can't shed it), whatever the client sends. Clients
--    can't change it afterwards (the trigger raises on UPDATE when
--    auth.uid() is set). The service role (auth.uid() null) may correct it.
--    Membership rows are deleted on leave and there is no membership
--    history, so this stamp is how "was a shop member when they created it"
--    survives the leave. Existing rows stay NULL (prod 2026-10-16: no
--    customer-side org is inside the 24h claim window, so none needs it).
-- 2) org_founder_claim_allowed(p_org): as 000917, and a customer-side org is
--    also refused when
--      - creator_shop_org_id IS NOT NULL (created by a shop member), or
--      - any service_reports or service_tickets row has
--        customer_organization_id = the org ('already served').
--    membership_insert_allowed and /api/org/founder (founderClaimAllowed in
--    web/lib/tenant-lockdown.ts) both go through this rule.
-- 3) create_shop_customer_org: any CURRENT member of the service company may
--    call it (000917 allowed only company_admin/owner/service_manager). Every
--    shop customer create in the web app now uses this RPC, including a
--    technician adding a clinic from a service report. That is not new
--    access: organizations_insert_customers + customer_org_link_allowed
--    already let any current member write the org and its link directly.
--    The org and its link are still one transaction.
--
-- Not changed: org_unclaimed_new, org_creator_access, membership_insert_allowed
-- (already calls org_founder_claim_allowed), organizations_guard_privilege.
--
-- Precheck (prod, read-only, 2026-10-16): 1778 customer-side orgs, 18 served;
-- 0 would newly become unclaimable (all 18 are already refused by 000917, and
-- 0 customer-side orgs are inside the 24h unclaimed window). The 12 unlinked
-- customer orgs are not written and none changes state.
--
-- APPLY after review, BEFORE the app deploy (the app's customer creates call
-- the RPC with technician callers). One transaction. Safe to re-run.
-- Rollback: 20261016_000919_customer_org_claim_served_or_shop_created_rollback.sql

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS creator_shop_org_id bigint;

COMMENT ON COLUMN public.organizations.creator_shop_org_id IS
  'A service company the creator belonged to when this org was inserted (trigger). Blocks founder claims on customer orgs. Not client-writable.';

-- No-op today (authenticated has column-level grants on safe columns only);
-- explicit so a later grant does not include it by accident.
REVOKE INSERT (creator_shop_org_id), UPDATE (creator_shop_org_id)
  ON TABLE public.organizations FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.stamp_org_creator_shop()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Runs after trg_set_org_created_by (triggers fire in name order), so
    -- created_by is already filled from auth.uid() when the client left it null.
    NEW.creator_shop_org_id := (
      SELECT min(m.organization_id)
      FROM public.organization_memberships m
      JOIN public.organizations s ON s.id = m.organization_id
      WHERE NEW.created_by IS NOT NULL
        AND m.user_id = NEW.created_by
        AND lower(btrim(coalesce(s.type, ''))) IN ('service_company', 'service')
    );
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL
     AND NEW.creator_shop_org_id IS DISTINCT FROM OLD.creator_shop_org_id THEN
    RAISE EXCEPTION 'creator_shop_org_id cannot be changed by the client' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.stamp_org_creator_shop() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stamp_org_creator_shop ON public.organizations;
CREATE TRIGGER trg_stamp_org_creator_shop
  BEFORE INSERT OR UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_org_creator_shop();

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
        AND (
          -- 000917: creator is a shop member now.
          (
            o.created_by IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.organization_memberships m
              JOIN public.organizations s ON s.id = m.organization_id
              WHERE m.user_id = o.created_by
                AND lower(btrim(coalesce(s.type, ''))) IN ('service_company', 'service')
            )
          )
          -- 000919: creator was a shop member when they created it.
          OR o.creator_shop_org_id IS NOT NULL
          -- 000919: already served by a shop.
          OR EXISTS (
            SELECT 1 FROM public.service_reports r
            WHERE r.customer_organization_id = o.id
          )
          OR EXISTS (
            SELECT 1 FROM public.service_tickets t
            WHERE t.customer_organization_id = o.id
          )
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.org_founder_claim_allowed(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_founder_claim_allowed(bigint) TO service_role;

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
      AND lower(btrim(coalesce(s.type, ''))) IN ('service_company', 'service')
  ) THEN
    RAISE EXCEPTION 'only a current member of this service company can add customers' USING ERRCODE = '42501';
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

NOTIFY pgrst, 'reload schema';
