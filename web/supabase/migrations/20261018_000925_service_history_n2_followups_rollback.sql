SET LOCAL lock_timeout = '5s';

-- Rollback for 20261018_000925_service_history_n2_followups.sql.
-- Restores the four prod bodies read 2026-10-18 verbatim (pg_get_functiondef
-- output), drops the new helper and the revoked_reason column (and its CHECK).
-- ACLs are unchanged by 000925 and by this file (CREATE OR REPLACE keeps
-- them). Safe to re-run.
--   public.grant_service_history(bigint,bigint,bigint)  md5 3bae6eee0d7d0360b795283d70839267
--   public.request_service_history_access(bigint,bigint,text)  md5 eb16d6ff8db01045369b330bc1fe3082
--   public.list_my_service_history_requests(bigint)  md5 849e65fd7513578572f1307778f267f1
--   public.revoke_service_history(bigint)  md5 031991b951143598428bc7466a7bd8fc

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
  -- N-1 (000922): serialize with trg_revoke_conflicted_history_grants for the
  -- same user (key tsp.history_grantor:<uid>), so a concurrent join is seen
  -- by the M-1 check below, or revokes this grant after it commits.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tsp.history_grantor:' || uid::text, 0));
  IF p_owner_org IS NULL OR p_grantee_shop IS NULL THEN
    RAISE EXCEPTION 'owner and service company are required' USING ERRCODE = '22023';
  END IF;
  IF p_owner_org = p_grantee_shop THEN
    RAISE EXCEPTION 'an organization cannot grant itself' USING ERRCODE = '22023';
  END IF;
  IF NOT public.service_history_owner_admin(p_owner_org) THEN
    RAISE EXCEPTION 'only an owner or admin of this facility can share its service history' USING ERRCODE = '42501';
  END IF;
  -- M-1 (000922): a clinic approver who is also a member of the grantee shop
  -- may not share the clinic's history with that shop.
  IF EXISTS (
    SELECT 1 FROM public.organization_memberships sm
    WHERE sm.organization_id = p_grantee_shop AND sm.user_id = uid
  ) THEN
    RAISE EXCEPTION 'only an owner or admin who is not part of that service company can share with it' USING ERRCODE = '42501';
  END IF;
  -- I-2 (000922): never share with a shop this facility has blocked.
  IF EXISTS (
    SELECT 1 FROM public.organization_customer_link_blocks b
    WHERE b.owner_org_id = p_owner_org AND b.shop_org_id = p_grantee_shop
  ) THEN
    RAISE EXCEPTION 'this facility has blocked that service company' USING ERRCODE = '42501';
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
$function$
;

CREATE OR REPLACE FUNCTION public.request_service_history_access(p_owner_org bigint, p_equipment_id bigint, p_ref text DEFAULT NULL::text)
 RETURNS TABLE(request_id bigint, status text, created boolean, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  uid uuid := auth.uid();
  shop bigint;
  elig text;
  n_rows integer;
  existing record;
  last_denied timestamptz;
  report uuid;
  new_id bigint;
  new_exp timestamptz;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  shop := public.get_my_org_id();
  IF shop IS NULL OR NOT public.is_active_org_member(shop) THEN
    RAISE EXCEPTION 'not available for this laser' USING ERRCODE = '42501';
  END IF;
  elig := public.service_history_teaser_eligible(shop, p_owner_org, p_equipment_id);
  IF elig = 'unclaimed' THEN
    RAISE EXCEPTION 'clinic_unclaimed' USING ERRCODE = '42501';
  ELSIF elig <> 'ok' THEN
    RAISE EXCEPTION 'not available for this laser' USING ERRCODE = '42501';
  END IF;
  IF NOT public.service_history_can_request(shop, p_owner_org) THEN
    RAISE EXCEPTION 'only a shop owner or admin, or a tech assigned to this clinic, can ask for history' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tsp.history_req:' || p_owner_org::text || ':' || shop::text || ':' || p_equipment_id::text, 0)
  );

  UPDATE public.service_history_requests q
     SET status = 'expired', close_reason = 'expired'
   WHERE q.owner_org_id = p_owner_org
     AND q.requester_shop_org_id = shop
     AND q.equipment_id = p_equipment_id
     AND q.status = 'pending'
     AND q.expires_at <= now();

  -- Dedupe: the open request answers again, nothing new is sent.
  SELECT q.id, q.status, q.expires_at INTO existing
  FROM public.service_history_requests q
  WHERE q.owner_org_id = p_owner_org
    AND q.requester_shop_org_id = shop
    AND q.equipment_id = p_equipment_id
    AND q.status = 'pending';
  IF FOUND THEN
    RETURN QUERY SELECT existing.id, existing.status, false, existing.expires_at;
    RETURN;
  END IF;

  -- Already shared (this laser or all): nothing to ask.
  IF EXISTS (
    SELECT 1 FROM public.service_history_grants g
    WHERE g.owner_org_id = p_owner_org
      AND g.grantee_shop_org_id = shop
      AND g.revoked_at IS NULL
      AND (g.equipment_id IS NULL OR g.equipment_id = p_equipment_id)
  ) THEN
    RETURN QUERY SELECT NULL::bigint, 'approved'::text, false, NULL::timestamptz;
    RETURN;
  END IF;

  -- L-2: the cooldown is per (clinic, shop), whichever laser was denied.
  SELECT max(q.responded_at) INTO last_denied
  FROM public.service_history_requests q
  WHERE q.owner_org_id = p_owner_org
    AND q.requester_shop_org_id = shop
    AND q.status = 'denied';
  IF last_denied IS NOT NULL AND last_denied > now() - interval '720 hours' THEN
    RAISE EXCEPTION 'request_cooldown' USING ERRCODE = 'P0001',
      DETAIL = 'retry_after=' || to_char((last_denied + interval '720 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  END IF;

  SELECT count(*)::integer INTO n_rows
  FROM public.service_history_teaser_rows(shop, p_owner_org, p_equipment_id);
  IF n_rows = 0 THEN
    RAISE EXCEPTION 'no locked history on this laser' USING ERRCODE = '22023';
  END IF;

  IF NOT public.take_service_history_slot('request_shop', shop::text, 20, interval '24 hours')
     OR NOT public.take_service_history_slot('request_pair', shop::text || ':' || p_owner_org::text, 5, interval '24 hours') THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;

  IF p_ref IS NOT NULL AND btrim(p_ref) <> '' THEN
    SELECT t.report_id INTO report
    FROM public.service_history_teaser_rows(shop, p_owner_org, p_equipment_id) t
    WHERE t.ref = lower(btrim(p_ref))
    LIMIT 1;
  END IF;

  INSERT INTO public.service_history_requests
    (owner_org_id, requester_shop_org_id, equipment_id, requested_by, requested_report_id, teaser_count)
  VALUES (p_owner_org, shop, p_equipment_id, uid, report, n_rows)
  RETURNING service_history_requests.id, service_history_requests.expires_at INTO new_id, new_exp;

  RETURN QUERY SELECT new_id, 'pending'::text, true, new_exp;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.list_my_service_history_requests(p_equipment_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(id bigint, owner_org_id bigint, equipment_id bigint, status text, created_at timestamp with time zone, expires_at timestamp with time zone, responded_at timestamp with time zone, approved_scope text, retry_after timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH me AS (SELECT public.get_my_org_id() AS shop)
  SELECT q.id, q.owner_org_id, q.equipment_id,
         CASE WHEN q.status = 'pending' AND q.expires_at <= now() THEN 'expired' ELSE q.status END,
         q.created_at, q.expires_at, q.responded_at, q.approved_scope,
         -- L-2: retry_after is the pair-level cooldown end, on every row of that clinic.
         (SELECT max(d.responded_at) + interval '720 hours'
            FROM public.service_history_requests d
           WHERE d.owner_org_id = q.owner_org_id
             AND d.requester_shop_org_id = q.requester_shop_org_id
             AND d.status = 'denied'
             AND d.responded_at > now() - interval '720 hours')
  FROM me
  JOIN public.service_history_requests q ON q.requester_shop_org_id = me.shop
  WHERE me.shop IS NOT NULL
    AND public.is_active_org_member(me.shop)
    AND (p_equipment_id IS NULL OR q.equipment_id = p_equipment_id)
  ORDER BY q.created_at DESC, q.id DESC
  LIMIT 200;
$function$
;

CREATE OR REPLACE FUNCTION public.revoke_service_history(p_grant_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
$function$
;

DROP FUNCTION IF EXISTS public.history_grantor_recent_shop_staff(bigint, uuid);
ALTER TABLE public.service_history_grants DROP COLUMN IF EXISTS revoked_reason;

NOTIFY pgrst, 'reload schema';
