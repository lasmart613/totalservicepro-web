SET LOCAL lock_timeout = '5s';

-- 000921: linked shops see only their own reports; clinic owners manage links;
-- creator access ends when a clinic is claimed.
--
-- ORDER: 000919 (PR #309) -> 000920 (PR #310) -> 000921. Also correct when
-- 000919 is never applied (000920 -> 000921): org_creator_access picks its
-- "new and unclaimed" branch by whether organizations.creator_shop_org_id
-- (000919) exists. If 000919 is applied AFTER 000921 it overwrites
-- org_creator_access / customer_org_link_allowed: roll 000921 back first.
-- One transaction. Safe to re-run (the backup keeps the first capture).
--
-- 0. Exact rollback: the pre-000921 pg_get_functiondef of the three redefined
--    functions is saved in migration_backup.m000921_functions (schema not
--    exposed by PostgREST; no client grants). The rollback re-creates them from
--    there, so it restores exactly what was live, with or without 000919.
--
-- 1. can_view_service_report_for_history: drop the "service org linked via
--    organization_customers to report customer" branch. A linked shop sees the
--    reports it wrote (own-shop branch, unchanged) and nothing else of the
--    clinic's; other shops' history goes through owner-consent grants.
--    The two facility branches (report customer / equipment owner) now need a
--    real member of that facility, OR (creator access) a facility with no
--    organization_customers link at all. So creator access never opens a
--    LINKED clinic's reports, claimed or not (QA #311 M-1).
--    Prod impact (read-only, 2026-10-17): 0 views lost (LINKED-IMPACT.md).
--
-- 2. org_creator_access (QA #311 M-1; starts from 000919's body when present):
--      creator = auth.uid() AND (
--        member of the org
--        OR (org has NO memberships AND a shop I'm in links it)  -- shop CRM edit
--        OR (org_unclaimed_new [000919: AND not stamped AND not served]))
--    The linked-shop creator clause is no longer standalone: it lasts only
--    while the clinic has no members. It is kept for that window because the
--    shop's customer edit page (lib/customer-form.ts updateCustomerOrg ->
--    "Users can update their own organizations") relies on it for the tech who
--    added the clinic. With 1. it never grants report reads. Once the clinic
--    has any member, its creator has no creator access at all.
--
-- 3. customer_org_link_allowed (QA #311 M-2; 000919 body when present, plus):
--    a) the 000919 member-overlap rule is carried in both orders (prod: 0 of
--       1766 links overlap, so nothing existing changes);
--    b) blocked (owner, shop) pairs are refused (organization_customer_link_blocks);
--    c) RULE: the creator path ("the clinic's created_by is in the linking
--       shop") is refused once the clinic is CLAIMED (has any membership), and
--       whenever a block on this clinic recorded that same creator
--       (blocks.creator_user_id). So a blocked creator who starts or joins a
--       new shop cannot re-link through it. A claimed clinic is linked only
--       through the accepted owner-invite path (the owner's own consent).
--
-- 4. organization_customer_link_blocks + owner RPCs:
--    list_linked_service_shops(owner)
--    remove_linked_service_shop(owner, shop, p_block DEFAULT true,
--                               p_revoke_grants DEFAULT false)  (QA #311 L-1:
--        p_revoke_grants also revokes that shop's active history grants from
--        this clinic in the same step)
--    allow_linked_service_shop(owner, shop)   lifts a block (does not re-link)
--
-- 5. Grants / history (QA #310 + #311 info items):
--    - service_history_owner_admin: EXECUTE revoked from authenticated.
--    - service_history_grants SELECT: owner / company_admin / admin / manager
--      of the owner clinic only (granted_by / revoked_by are not visible to
--      plain clinic staff or to the grantee). Grantees use
--      list_my_service_history_grants() (no user ids).
--    - get_shared_service_history(owner, equipment, p_limit 200 (max 500),
--      p_offset): total_count on every row. service_company_name is now the
--      real organizations.name of the report's shop; the free text typed on the
--      report header is a separate, labeled column report_company_name_text.
--      A page past the end returns no rows (no total); the TS wrapper then
--      re-asks for the total and returns pastEnd: true.
--
-- Rollback: 20261017_000921_linked_shop_own_reports_rollback.sql
-- Proof: web/supabase/tests/20261017_linked_shop_own_reports.sql

-- 0) Backup of the prior definitions (first capture wins on re-run).
CREATE SCHEMA IF NOT EXISTS migration_backup;
REVOKE ALL ON SCHEMA migration_backup FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS migration_backup.m000921_functions (
  signature text PRIMARY KEY,
  definition text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE migration_backup.m000921_functions FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  old_path text := current_setting('search_path');
  sig text;
BEGIN
  PERFORM set_config('search_path', '', true);
  FOREACH sig IN ARRAY ARRAY[
    'public.can_view_service_report_for_history(public.service_reports)',
    'public.org_creator_access(bigint,uuid,timestamp with time zone)',
    'public.customer_org_link_allowed(bigint,bigint)'
  ] LOOP
    INSERT INTO migration_backup.m000921_functions (signature, definition)
    VALUES (sig, pg_catalog.pg_get_functiondef(sig::pg_catalog.regprocedure))
    ON CONFLICT (signature) DO NOTHING;
  END LOOP;
  PERFORM set_config('search_path', old_path, true);
END $$;

-- 1) History visibility.
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
    -- Facility that is the report customer (creator access only while the
    -- facility has no shop link)
    OR (
      r.customer_organization_id IS NOT NULL
      AND public.user_owns_or_created_org(r.customer_organization_id)
      AND (
        public.is_active_org_member(r.customer_organization_id)
        OR NOT EXISTS (
          SELECT 1 FROM public.organization_customers oc
          WHERE oc.customer_organization_id = r.customer_organization_id
        )
      )
    )
    -- Facility that currently owns the linked equipment row (real transfers
    -- move this row, so history follows them)
    OR (
      r.equipment_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.equipment e
        WHERE e.id = r.equipment_id
          AND public.user_owns_or_created_org(e.customer_organization_id)
          AND (
            public.is_active_org_member(e.customer_organization_id)
            OR NOT EXISTS (
              SELECT 1 FROM public.organization_customers oc
              WHERE oc.customer_organization_id = e.customer_organization_id
            )
          )
      )
    );
$function$;

-- 2) Creator access ends at the first membership.
DO $do$
DECLARE
  has_919 boolean := EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.organizations'::pg_catalog.regclass
      AND a.attname = 'creator_shop_org_id'
      AND NOT a.attisdropped
  );
  unclaimed_branch text;
BEGIN
  IF has_919 THEN
    unclaimed_branch := $b$
      OR (
        public.org_unclaimed_new(p_org, p_created_at)
        AND NOT EXISTS (
          SELECT 1 FROM public.organizations o
          WHERE o.id = p_org
            AND o.creator_shop_org_id IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.service_reports r
          WHERE r.customer_organization_id = p_org
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.service_tickets t
          WHERE t.customer_organization_id = p_org
        )
      )$b$;
  ELSE
    unclaimed_branch := $b$
      OR public.org_unclaimed_new(p_org, p_created_at)$b$;
  END IF;

  EXECUTE $f$
CREATE OR REPLACE FUNCTION public.org_creator_access(p_org bigint, p_created_by uuid, p_created_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p_org IS NOT NULL
    AND p_created_by IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND p_created_by = auth.uid()
    AND (
      public.is_active_org_member(p_org)
      -- 000921: a linking shop's creator keeps access only while the clinic
      -- has no members (CRM edits of a clinic the shop added).
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.organization_memberships cm
          WHERE cm.organization_id = p_org
        )
        AND EXISTS (
          SELECT 1 FROM public.organization_customers oc
          WHERE oc.customer_organization_id = p_org
            AND public.is_active_org_member(oc.service_organization_id)
        )
      )$f$ || unclaimed_branch || $f$
    );
$function$$f$;
END $do$;

-- 4) Link blocks (owner removals). creator_user_id binds the clinic's creator.
CREATE TABLE IF NOT EXISTS public.organization_customer_link_blocks (
  owner_org_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shop_org_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  creator_user_id uuid,
  blocked_by uuid NOT NULL,
  blocked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_org_id, shop_org_id)
);
COMMENT ON TABLE public.organization_customer_link_blocks IS
  'Clinic owner removed this shop''s organization_customers link. customer_org_link_allowed refuses the pair, and refuses the creator path for creator_user_id (the clinic''s created_by at block time) from any shop. Written only by the owner RPCs.';
ALTER TABLE public.organization_customer_link_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organization_customer_link_blocks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.organization_customer_link_blocks TO service_role;

-- 3) Linking rule (000919 body + 000921 rules).
CREATE OR REPLACE FUNCTION public.customer_org_link_allowed(p_service bigint, p_customer bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
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
      SELECT 1 FROM public.organization_customers existing
      WHERE existing.customer_organization_id = p_customer
        AND existing.service_organization_id IS DISTINCT FROM p_service
    )
    -- 000919 rev 3 (QA #309 H3): nobody in the linking shop may already
    -- belong to the customer org (its owner can't be on the shop's staff).
    AND NOT EXISTS (
      SELECT 1
      FROM public.organization_memberships cm
      JOIN public.organization_memberships sm ON sm.user_id = cm.user_id
      WHERE cm.organization_id = p_customer
        AND sm.organization_id = p_service
    )
    -- 000921: the clinic owner removed and blocked this shop.
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_customer_link_blocks b
      WHERE b.owner_org_id = p_customer
        AND b.shop_org_id = p_service
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
          -- 000921: the creator path ends once the clinic is claimed ...
          AND NOT EXISTS (
            SELECT 1 FROM public.organization_memberships cm
            WHERE cm.organization_id = p_customer
          )
          -- ... and a block binds the creator, from any shop.
          AND NOT EXISTS (
            SELECT 1 FROM public.organization_customer_link_blocks b
            WHERE b.owner_org_id = p_customer
              AND b.creator_user_id = o.created_by
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

-- Replaces the 3-argument draft from 000921 rev 1 (never applied anywhere).
DROP FUNCTION IF EXISTS public.remove_linked_service_shop(bigint, bigint, boolean);

CREATE OR REPLACE FUNCTION public.remove_linked_service_shop(
  p_owner_org bigint,
  p_shop bigint,
  p_block boolean DEFAULT true,
  p_revoke_grants boolean DEFAULT false
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
    INSERT INTO public.organization_customer_link_blocks (owner_org_id, shop_org_id, creator_user_id, blocked_by)
    SELECT p_owner_org, p_shop, o.created_by, uid
    FROM public.organizations o
    WHERE o.id = p_owner_org
    ON CONFLICT (owner_org_id, shop_org_id) DO NOTHING;
  END IF;
  IF COALESCE(p_revoke_grants, false) THEN
    UPDATE public.service_history_grants
       SET revoked_at = now(), revoked_by = uid
     WHERE owner_org_id = p_owner_org
       AND grantee_shop_org_id = p_shop
       AND revoked_at IS NULL;
  END IF;
  RETURN removed > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.remove_linked_service_shop(bigint, bigint, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_linked_service_shop(bigint, bigint, boolean, boolean) TO authenticated;

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

-- 5) Grant rows: owner / admin roles of the owner clinic only (same role list
--    as service_history_owner_admin; inline, since that helper is no longer
--    executable by authenticated; a user can always read their own
--    organization_memberships rows).
DROP POLICY IF EXISTS service_history_grants_select ON public.service_history_grants;
CREATE POLICY service_history_grants_select ON public.service_history_grants
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = auth.uid()
        AND m.organization_id = service_history_grants.owner_org_id
        AND lower(btrim(COALESCE(m.role, ''))) IN ('owner', 'company_admin', 'admin', 'manager')
    )
  );

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
-- Rev 1 of this file had a different RETURNS list for the 4-arg signature.
DROP FUNCTION IF EXISTS public.get_shared_service_history(bigint, bigint, integer, integer);

-- service_company_name     = organizations.name of the shop that wrote the report
-- report_company_name_text = free text typed on the report header (tech_company_name)
CREATE FUNCTION public.get_shared_service_history(
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
   report_company_name_text text,
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
         s.name, h.tech_company_name, h.organization_id, h.customer_organization_id,
         count(*) OVER () AS total_count
  FROM hits h
  LEFT JOIN public.organizations s ON s.id = h.organization_id
  ORDER BY COALESCE(h.date_out::timestamptz, h.created_at) DESC NULLS LAST, h.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$function$;

REVOKE ALL ON FUNCTION public.get_shared_service_history(bigint, bigint, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shared_service_history(bigint, bigint, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
