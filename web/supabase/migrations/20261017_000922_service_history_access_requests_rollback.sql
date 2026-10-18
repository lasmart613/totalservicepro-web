SET LOCAL lock_timeout = '5s';

-- Rollback for 000922 (service history teaser + access requests).
-- Drops only objects 000922 created, and restores the live 000920
-- grant_service_history body (000922 adds the M-1 guard to it).
-- Grants created by approvals stay: they are real owner consent and are
-- revoked with revoke_service_history.
-- Notification rows written by the server routes stay (type 'general').
-- The private schema is left in place (it exists on prod for other objects).

DROP TRIGGER IF EXISTS trg_revoke_conflicted_history_grants ON public.organization_memberships;
DROP FUNCTION IF EXISTS public.revoke_conflicted_history_grants();
DROP FUNCTION IF EXISTS public.service_history_request_notice(bigint);
DROP FUNCTION IF EXISTS public.respond_to_service_history_request(bigint, text, text);
DROP FUNCTION IF EXISTS public.list_owner_service_history_grants(bigint, bigint);
DROP FUNCTION IF EXISTS public.list_incoming_service_history_requests(bigint, text, bigint, integer, integer);
DROP FUNCTION IF EXISTS public.list_my_service_history_requests(bigint);
DROP FUNCTION IF EXISTS public.request_service_history_access(bigint, bigint, text);
DROP FUNCTION IF EXISTS public.get_locked_service_history_teaser(bigint, bigint);
DROP FUNCTION IF EXISTS public.service_history_can_request(bigint, bigint);
DROP FUNCTION IF EXISTS public.service_history_teaser_rows(bigint, bigint, bigint);
DROP FUNCTION IF EXISTS public.service_history_title(text);
DROP FUNCTION IF EXISTS public.service_history_teaser_eligible(bigint, bigint, bigint);
DROP FUNCTION IF EXISTS public.take_service_history_slot(text, text, integer, interval);
DROP TABLE IF EXISTS public.service_history_requests;
DROP TABLE IF EXISTS public.service_history_slots;
DROP TABLE IF EXISTS private.service_history_ref_keys;

-- Restore 000920 grant_service_history exactly as it is live on prod
-- (pg_get_functiondef md5 c4b6de797b5e6ee4efcb918aa5137d69, read 2026-10-17).
CREATE OR REPLACE FUNCTION public.grant_service_history(p_owner_org bigint, p_grantee_shop bigint, p_equipment_id bigint DEFAULT NULL::bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
-- (CREATE OR REPLACE keeps the existing ACL, incl. the live service_role grant.)

NOTIFY pgrst, 'reload schema';
