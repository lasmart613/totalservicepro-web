SET LOCAL lock_timeout = '5s';

-- 000921: linked shops see only their own reports; clinic owners manage links.
-- Stacks on 000920 (PR #310). Independent of 000919 (PR #309).
--
-- 1. can_view_service_report_for_history: drop the "service org linked via
--    organization_customers to report customer" branch. A linked shop used to
--    read ALL of the clinic's reports, other shops' included, unredacted, with
--    no revoke. Now a shop sees the reports it wrote (own-shop branch, which
--    is unchanged) and nothing else of the clinic's; everything else goes
--    through owner-consent grants and get_shared_service_history.
--    "Equipment it actively services" is NOT used as a signal: the only
--    candidates (a ticket or report naming the equipment) are written by the
--    shop itself and service_tickets inserts do not validate the customer or
--    equipment, so they are self-asserted, not owner consent.
--    Prod impact (read-only, 2026-10-17): 0 views lost (no linked clinic has a
--    report by any other shop). See /workspace/h2/LINKED-IMPACT.md.
-- 2. organization_customer_link_blocks + owner RPCs:
--    list_linked_service_shops(owner)         owner/admin lists linked and removed shops
--    remove_linked_service_shop(owner, shop)  deletes the link and (by default)
--                                             blocks the shop from re-linking itself
--    allow_linked_service_shop(owner, shop)   lifts a block (does not re-link)
--    customer_org_link_allowed now also refuses a blocked (owner, shop) pair.
--    Removing a link does not touch service_history_grants (separate consent).
-- 3. QA #310 info items:
--    - service_history_owner_admin: EXECUTE revoked from authenticated.
--    - service_history_grants SELECT is owner-side only (granted_by/revoked_by
--      stay with the owner). Grantees use list_my_service_history_grants(),
--      which returns no user ids.
--    - get_shared_service_history pages: p_limit (default 200, max 500),
--      p_offset, and total_count on every row, so truncation is visible.
--      Replaces the (bigint, bigint) signature.
--
-- Rollback: 20261017_000921_linked_shop_own_reports_rollback.sql (restores the
--   000920 bodies, ACLs and policy, and the live customer_org_link_allowed).
-- Proof: web/supabase/tests/20261017_linked_shop_own_reports.sql

CREATE OR REPLACE FUNCTION public.can_view_service_report_for_history(r public.service_reports)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
  SELECT
    -- Own service company reports
    (r.organization_id IS NOT NULL AND r.organization_id = public.get_my_org_id())
    OR (
      r.created_by IS NOT NULL
      AND r.created_by = auth.uid()
      AND public.is_active_org_member(r.organization_id)
    )
    -- Facility that is the report customer
    OR (
      r.customer_organization_id IS NOT NULL
      AND public.user_owns_or_created_org(r.customer_organization_id)
    )
    -- Facility that currently owns the linked equipment row (real transfers
    -- move this row, so history follows them)
    OR (
      r.equipment_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.equipment e
        WHERE e.id = r.equipment_id
          AND public.user_owns_or_created_org(e.customer_organization_id)
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.can_view_service_report_for_history(public.service_reports) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_service_report_for_history(public.service_reports) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.organization_customer_link_blocks (
  owner_org_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shop_org_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  blocked_by uuid NOT NULL,
  blocked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_org_id, shop_org_id)
);
COMMENT ON TABLE public.organization_customer_link_blocks IS
  'Clinic owner removed this shop''s organization_customers link; customer_org_link_allowed refuses re-linking until allow_linked_service_shop. Written only by the owner RPCs.';
ALTER TABLE public.organization_customer_link_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organization_customer_link_blocks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.organization_customer_link_blocks TO service_role;

CREATE OR REPLACE FUNCTION public.customer_org_link_allowed(p_service bigint, p_customer bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
  SELECT p_service IS NOT NULL
    AND p_customer IS NOT NULL
    AND p_service = public.get_my_org_id()
    AND public.is_active_org_member(p_service)
    AND EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = p_customer
        AND o.type IN ('customer', 'laser_clinic', 'laser_rental', 'laser_reseller')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_customer_link_blocks b
      WHERE b.owner_org_id = p_customer
        AND b.shop_org_id = p_service
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_customers existing
      WHERE existing.customer_organization_id = p_customer
        AND existing.service_organization_id IS DISTINCT FROM p_service
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.id = p_customer
          AND o.type = 'customer'
          AND o.created_by IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.organization_memberships m
            WHERE m.user_id = o.created_by
              AND m.organization_id = p_service
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.engineer_invitations i
        JOIN public.organization_memberships m
          ON m.user_id = i.invited_by
         AND m.organization_id = p_service
         AND lower(m.role) IN ('company_admin', 'owner', 'service_manager', 'crm')
        WHERE i.organization_id = p_customer
          AND i.accepted IS TRUE
          AND lower(coalesce(i.role, '')) = 'owner'
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.customer_org_link_allowed(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_org_link_allowed(bigint, bigint) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.service_history_owner_admin(bigint) FROM authenticated;

CREATE OR REPLACE FUNCTION public.list_linked_service_shops(p_owner_org bigint)
 RETURNS TABLE (
   shop_org_id bigint,
   shop_name text,
   linked_at timestamptz,
   first_service_date timestamptz,
   removed_at timestamptz
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.service_history_owner_admin(p_owner_org) THEN
    RAISE EXCEPTION 'only an owner or admin of this facility can list its service companies' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT oc.service_organization_id, s.name, oc.created_at, oc.first_service_date, NULL::timestamptz
    FROM public.organization_customers oc
    LEFT JOIN public.organizations s ON s.id = oc.service_organization_id
    WHERE oc.customer_organization_id = p_owner_org
    UNION ALL
    SELECT b.shop_org_id, s.name, NULL::timestamptz, NULL::timestamptz, b.blocked_at
    FROM public.organization_customer_link_blocks b
    LEFT JOIN public.organizations s ON s.id = b.shop_org_id
    WHERE b.owner_org_id = p_owner_org
    ORDER BY 2, 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_linked_service_shops(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_linked_service_shops(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_linked_service_shop(
  p_owner_org bigint,
  p_shop bigint,
  p_block boolean DEFAULT true
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  uid uuid := auth.uid();
  removed integer;
BEGIN
  IF uid IS NULL OR NOT public.service_history_owner_admin(p_owner_org) THEN
    RAISE EXCEPTION 'only an owner or admin of this facility can remove a service company' USING ERRCODE = '42501';
  END IF;
  IF p_shop IS NULL THEN
    RAISE EXCEPTION 'service company is required' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.organization_customers
   WHERE customer_organization_id = p_owner_org
     AND service_organization_id = p_shop;
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF COALESCE(p_block, true) THEN
    INSERT INTO public.organization_customer_link_blocks (owner_org_id, shop_org_id, blocked_by)
    VALUES (p_owner_org, p_shop, uid)
    ON CONFLICT (owner_org_id, shop_org_id) DO NOTHING;
  END IF;
  RETURN removed > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.remove_linked_service_shop(bigint, bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_linked_service_shop(bigint, bigint, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.allow_linked_service_shop(p_owner_org bigint, p_shop bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.service_history_owner_admin(p_owner_org) THEN
    RAISE EXCEPTION 'only an owner or admin of this facility can allow a service company' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.organization_customer_link_blocks
   WHERE owner_org_id = p_owner_org AND shop_org_id = p_shop;
  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.allow_linked_service_shop(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allow_linked_service_shop(bigint, bigint) TO authenticated;

-- Grants: owner side reads the table (with granted_by / revoked_by); the
-- grantee shop reads its grants through an RPC without user ids.
DROP POLICY IF EXISTS service_history_grants_select ON public.service_history_grants;
CREATE POLICY service_history_grants_select ON public.service_history_grants
  FOR SELECT TO authenticated
  USING (public.is_active_org_member(owner_org_id));

CREATE OR REPLACE FUNCTION public.list_my_service_history_grants()
 RETURNS TABLE (
   id bigint,
   owner_org_id bigint,
   owner_name text,
   equipment_id bigint,
   granted_at timestamptz,
   revoked_at timestamptz
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
  SELECT g.id, g.owner_org_id, o.name, g.equipment_id, g.granted_at, g.revoked_at
  FROM public.service_history_grants g
  LEFT JOIN public.organizations o ON o.id = g.owner_org_id
  WHERE g.grantee_shop_org_id = public.get_my_org_id()
    AND public.is_active_org_member(g.grantee_shop_org_id)
  ORDER BY g.granted_at DESC, g.id DESC;
$function$;

REVOKE ALL ON FUNCTION public.list_my_service_history_grants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_service_history_grants() TO authenticated;

DROP FUNCTION IF EXISTS public.get_shared_service_history(bigint, bigint);

CREATE OR REPLACE FUNCTION public.get_shared_service_history(
  p_owner_org bigint,
  p_equipment_id bigint DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0
)
 RETURNS TABLE (
   id uuid,
   report_number text,
   status text,
   service_type text,
   model_type text,
   equipment_name text,
   equipment_type text,
   serial_number text,
   equipment_id bigint,
   date_out date,
   next_pm_due date,
   created_at timestamptz,
   finalized_at timestamptz,
   service_company_name text,
   service_organization_id bigint,
   customer_organization_id bigint,
   total_count bigint
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
  WITH me AS (
    SELECT public.get_my_org_id() AS shop
  ),
  hits AS (
    SELECT r.*
    FROM me
    JOIN public.service_reports r
      ON r.customer_organization_id = p_owner_org
    WHERE p_owner_org IS NOT NULL
      AND me.shop IS NOT NULL
      AND public.is_active_org_member(me.shop)
      AND EXISTS (
        SELECT 1
        FROM public.service_history_grants g
        LEFT JOIN public.equipment ge ON ge.id = g.equipment_id
        WHERE g.owner_org_id = p_owner_org
          AND g.grantee_shop_org_id = me.shop
          AND g.revoked_at IS NULL
          AND (
            g.equipment_id IS NULL
            OR g.equipment_id = r.equipment_id
            OR (
              r.equipment_id IS NULL
              AND ge.serial_number IS NOT NULL
              AND btrim(ge.serial_number) <> ''
              AND lower(btrim(ge.serial_number)) = lower(btrim(r.serial_number))
            )
          )
      )
      AND (
        p_equipment_id IS NULL
        OR r.equipment_id = p_equipment_id
        OR (
          r.equipment_id IS NULL
          AND EXISTS (
            SELECT 1 FROM public.equipment pe
            WHERE pe.id = p_equipment_id
              AND pe.customer_organization_id = p_owner_org
              AND btrim(COALESCE(pe.serial_number, '')) <> ''
              AND lower(btrim(pe.serial_number)) = lower(btrim(r.serial_number))
          )
        )
      )
  )
  SELECT h.id, h.report_number, h.status, h.service_type, h.model_type,
         h.equipment_name, h.equipment_type, h.serial_number, h.equipment_id,
         h.date_out, h.next_pm_due, h.created_at, h.finalized_at,
         h.tech_company_name, h.organization_id, h.customer_organization_id,
         count(*) OVER () AS total_count
  FROM hits h
  ORDER BY COALESCE(h.date_out::timestamptz, h.created_at) DESC NULLS LAST, h.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$function$;

REVOKE ALL ON FUNCTION public.get_shared_service_history(bigint, bigint, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shared_service_history(bigint, bigint, integer, integer) TO authenticated;
