SET LOCAL lock_timeout = '5s';

-- 000920: H2 fix. Service history is shared with another shop only with the
-- equipment owner's consent. A serial match alone never grants access.
--
-- 1. can_view_service_report_for_history: re-asserts the H2 stopgap body (the
--    serial-only "transfer case" branch is gone). Larry approved the stopgap and
--    it was applied to prod as a one-off
--    (web/supabase/oneoff/20261017_h2_stopgap_drop_transfer_branch.sql); this
--    puts the same body in migration history. Real transfers keep history: the
--    shop moves the SAME equipment row (ensureEquipment), and the "owns the
--    linked equipment row" branch covers that.
-- 2. service_history_grants: owner-consent records. The customer clinic org
--    (owner) grants one service shop (grantee) access to its past service
--    history, for all equipment (equipment_id NULL) or one laser. Default is
--    locked: no row, no access. Only an owner/admin of the owner org can grant
--    or revoke, through SECURITY DEFINER RPCs. Owner and grantee members can
--    read their grants. No client writes.
-- 3. get_shared_service_history: the ONLY way a grant unlocks history. It
--    returns safe columns only (what was done, when, on which laser, by which
--    company). It never returns comments/notes, checklists, measurements JSON,
--    the PDF, signatures, contact details, or ticket links. Grants do NOT widen
--    the service_reports RLS policy, so no full row (and nothing priced or
--    internal) reaches the grantee. Revocation is immediate: every call
--    re-checks revoked_at.
--
-- Independent of 000919 (PR #309): different objects. Either order.
-- Rollback: 20261017_000920_service_history_owner_consent_rollback.sql
--   (drops 2 and 3, restores the stopgapped live body of 1).
-- Proof: web/supabase/tests/20261017_service_history_owner_consent.sql

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
    )
    -- Service org linked via organization_customers to report customer
    OR (
      r.customer_organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_customers oc
        WHERE oc.customer_organization_id = r.customer_organization_id
          AND oc.service_organization_id = public.get_my_org_id()
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.can_view_service_report_for_history(public.service_reports) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_service_report_for_history(public.service_reports) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.service_history_grants (
  id bigserial PRIMARY KEY,
  owner_org_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  grantee_shop_org_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  equipment_id bigint REFERENCES public.equipment(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid,
  CONSTRAINT service_history_grants_not_self CHECK (owner_org_id <> grantee_shop_org_id),
  CONSTRAINT service_history_grants_revoke_order CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

COMMENT ON TABLE public.service_history_grants IS
  'Owner consent: owner_org_id lets grantee_shop_org_id read its past service history (safe columns, via get_shared_service_history). equipment_id NULL = all equipment. Write only via grant_service_history / revoke_service_history.';

CREATE UNIQUE INDEX IF NOT EXISTS service_history_grants_one_active
  ON public.service_history_grants (owner_org_id, grantee_shop_org_id, COALESCE(equipment_id, 0))
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS service_history_grants_grantee
  ON public.service_history_grants (grantee_shop_org_id, owner_org_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.service_history_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_history_grants_select ON public.service_history_grants;
CREATE POLICY service_history_grants_select ON public.service_history_grants
  FOR SELECT TO authenticated
  USING (
    public.is_active_org_member(owner_org_id)
    OR public.is_active_org_member(grantee_shop_org_id)
  );

REVOKE ALL ON TABLE public.service_history_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.service_history_grants TO authenticated;
GRANT ALL ON TABLE public.service_history_grants TO service_role;
REVOKE ALL ON SEQUENCE public.service_history_grants_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.service_history_grants_id_seq TO service_role;

-- True when the caller is an owner/admin member of a customer-side org.
-- Real membership only: the 24h creator access does not count.
CREATE OR REPLACE FUNCTION public.service_history_owner_admin(p_owner_org bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
  SELECT p_owner_org IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships m
      JOIN public.organizations o ON o.id = m.organization_id
      WHERE m.user_id = auth.uid()
        AND m.organization_id = p_owner_org
        AND lower(btrim(COALESCE(m.role, ''))) IN ('owner', 'company_admin', 'admin', 'manager')
        AND lower(btrim(COALESCE(o.type, ''))) IN ('customer', 'laser_clinic', 'laser_rental', 'laser_reseller')
    );
$function$;

REVOKE ALL ON FUNCTION public.service_history_owner_admin(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_history_owner_admin(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.grant_service_history(
  p_owner_org bigint,
  p_grantee_shop bigint,
  p_equipment_id bigint DEFAULT NULL
)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  uid uuid := auth.uid();
  grant_id bigint;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_owner_org IS NULL OR p_grantee_shop IS NULL THEN
    RAISE EXCEPTION 'owner and service company are required' USING ERRCODE = '22023';
  END IF;
  IF p_owner_org = p_grantee_shop THEN
    RAISE EXCEPTION 'an organization cannot grant itself' USING ERRCODE = '22023';
  END IF;
  IF NOT public.service_history_owner_admin(p_owner_org) THEN
    RAISE EXCEPTION 'only an owner or admin of this facility can share its service history' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations s
    WHERE s.id = p_grantee_shop
      AND lower(btrim(COALESCE(s.type, ''))) IN ('service_company', 'service')
  ) THEN
    RAISE EXCEPTION 'service history can only be shared with a service company' USING ERRCODE = '22023';
  END IF;
  IF p_equipment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.equipment e
    WHERE e.id = p_equipment_id AND e.customer_organization_id = p_owner_org
  ) THEN
    RAISE EXCEPTION 'that equipment does not belong to this facility' USING ERRCODE = '22023';
  END IF;

  SELECT g.id INTO grant_id
  FROM public.service_history_grants g
  WHERE g.owner_org_id = p_owner_org
    AND g.grantee_shop_org_id = p_grantee_shop
    AND COALESCE(g.equipment_id, 0) = COALESCE(p_equipment_id, 0)
    AND g.revoked_at IS NULL;
  IF grant_id IS NOT NULL THEN
    RETURN grant_id;
  END IF;

  INSERT INTO public.service_history_grants (owner_org_id, grantee_shop_org_id, equipment_id, granted_by)
  VALUES (p_owner_org, p_grantee_shop, p_equipment_id, uid)
  ON CONFLICT DO NOTHING
  RETURNING id INTO grant_id;
  IF grant_id IS NULL THEN
    SELECT g.id INTO grant_id
    FROM public.service_history_grants g
    WHERE g.owner_org_id = p_owner_org
      AND g.grantee_shop_org_id = p_grantee_shop
      AND COALESCE(g.equipment_id, 0) = COALESCE(p_equipment_id, 0)
      AND g.revoked_at IS NULL;
  END IF;
  RETURN grant_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.grant_service_history(bigint, bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_service_history(bigint, bigint, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_service_history(p_grant_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  uid uuid := auth.uid();
  owner_org bigint;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT g.owner_org_id INTO owner_org FROM public.service_history_grants g WHERE g.id = p_grant_id;
  IF owner_org IS NULL OR NOT public.service_history_owner_admin(owner_org) THEN
    RAISE EXCEPTION 'only an owner or admin of this facility can revoke this grant' USING ERRCODE = '42501';
  END IF;
  UPDATE public.service_history_grants
     SET revoked_at = now(), revoked_by = uid
   WHERE id = p_grant_id AND revoked_at IS NULL;
  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.revoke_service_history(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_service_history(bigint) TO authenticated;

-- Shared (redacted) history for the caller's active shop. Rows only for reports
-- whose customer is p_owner_org and that an active, unrevoked grant from that
-- owner to the caller's shop covers. A per-equipment grant covers reports on
-- that equipment row, plus reports with no equipment row whose serial matches
-- it (still only the owner's own reports). p_equipment_id narrows the result.
CREATE OR REPLACE FUNCTION public.get_shared_service_history(
  p_owner_org bigint,
  p_equipment_id bigint DEFAULT NULL
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
   customer_organization_id bigint
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
  WITH me AS (
    SELECT public.get_my_org_id() AS shop
  )
  SELECT r.id, r.report_number, r.status, r.service_type, r.model_type,
         r.equipment_name, r.equipment_type, r.serial_number, r.equipment_id,
         r.date_out, r.next_pm_due, r.created_at, r.finalized_at,
         r.tech_company_name, r.organization_id, r.customer_organization_id
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
  ORDER BY COALESCE(r.date_out::timestamptz, r.created_at) DESC NULLS LAST
  LIMIT 500;
$function$;

REVOKE ALL ON FUNCTION public.get_shared_service_history(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shared_service_history(bigint, bigint) TO authenticated;
