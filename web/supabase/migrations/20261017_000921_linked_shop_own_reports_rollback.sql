SET LOCAL lock_timeout = '5s';

-- Rollback for 000921. Restores exactly the state before 000921, with or
-- without 000919 underneath:
--   - can_view_service_report_for_history, org_creator_access and
--     customer_org_link_allowed are re-created from the pg_get_functiondef text
--     000921 saved in migration_backup.m000921_functions before it changed them
--     (000920 stopgapped can_view md5 4abb0da8...; org_creator_access /
--     customer_org_link_allowed as live, or as 000919 left them). Their ACLs
--     were never changed by 000921. Refuses to run if the backup is missing.
--   - service_history_owner_admin EXECUTE back to authenticated (000920).
--   - service_history_grants_select policy as in 000920 (owner OR grantee).
--   - get_shared_service_history(bigint, bigint) as in 000920.
-- Drops the owner link RPCs, list_my_service_history_grants, the block table
-- (owner removals are forgotten; removed links are NOT re-created; grants
-- revoked through remove_linked_service_shop stay revoked) and the backup.

DO $$
DECLARE
  rec record;
  n integer := 0;
BEGIN
  IF to_regclass('migration_backup.m000921_functions') IS NULL THEN
    RAISE EXCEPTION '000921 rollback: migration_backup.m000921_functions is missing; refusing to guess the prior bodies';
  END IF;
  FOR rec IN SELECT signature, definition FROM migration_backup.m000921_functions ORDER BY signature LOOP
    EXECUTE rec.definition;
    n := n + 1;
  END LOOP;
  IF n <> 3 THEN
    RAISE EXCEPTION '000921 rollback: expected 3 saved functions, found %', n;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.list_linked_service_shops(bigint);
DROP FUNCTION IF EXISTS public.remove_linked_service_shop(bigint, bigint, boolean, boolean);
DROP FUNCTION IF EXISTS public.remove_linked_service_shop(bigint, bigint, boolean);
DROP FUNCTION IF EXISTS public.allow_linked_service_shop(bigint, bigint);
DROP FUNCTION IF EXISTS public.list_my_service_history_grants();
DROP TABLE IF EXISTS public.organization_customer_link_blocks;

GRANT EXECUTE ON FUNCTION public.service_history_owner_admin(bigint) TO authenticated;

DROP POLICY IF EXISTS service_history_grants_select ON public.service_history_grants;
CREATE POLICY service_history_grants_select ON public.service_history_grants
  FOR SELECT TO authenticated
  USING (
    public.is_active_org_member(owner_org_id)
    OR public.is_active_org_member(grantee_shop_org_id)
  );

DROP FUNCTION IF EXISTS public.get_shared_service_history(bigint, bigint, integer, integer);

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

DROP TABLE IF EXISTS migration_backup.m000921_functions;
DROP SCHEMA IF EXISTS migration_backup;

NOTIFY pgrst, 'reload schema';
