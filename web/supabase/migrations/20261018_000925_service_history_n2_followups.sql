SET LOCAL lock_timeout = '5s';

-- 000925: service history teaser follow-ups (QA live check of #314, 2026-10-18).
--
--   N-2  grant_service_history refuses a grantor who was on the grantee
--        shop's staff in the last 30 days (user id or login email, from
--        organization_membership_departures), on top of the M-1 current-
--        member refusal. respond_to_service_history_request approves only
--        through grant_service_history, so the approve path is covered with
--        no change to its body (a refused approve rolls back; the request
--        stays pending). Deny is unchanged. The per-user advisory lock
--        hashtextextended('tsp.history_grantor:' || uid, 0) and the lock
--        order are unchanged: the new check is a read under that lock.
--   Panel  list_my_service_history_requests reports an 'approved' request as
--        'revoked' when no active (revoked_at IS NULL) grant from that clinic
--        to the shop covers the laser (this laser or all). Same signature.
--   Cooldown (product decision): a deliberate OWNER revoke of any grant for
--        the (clinic, shop) pair starts the same 30-day cooldown as a deny,
--        with the same 'request_cooldown' error and retry_after detail.
--        System revokes do NOT: the revoke-on-join trigger
--        (trg_revoke_conflicted_history_grants, 000922) and linked-shop
--        removal (remove_linked_service_shop, 000921) both set revoked_by but
--        could not be told apart from an owner revoke, so 000925 adds
--        service_history_grants.revoked_reason (nullable; 'owner' is set only
--        by revoke_service_history; NULL = system or pre-000925). Those two
--        bodies are unchanged. Prod has 0 grants, so nothing to backfill.
--
-- Requires 000920..000924 (all live). Redefines four live functions; their
-- prod bodies (read 2026-10-18) are restored verbatim by the rollback:
--   public.grant_service_history(bigint,bigint,bigint)  md5 3bae6eee0d7d0360b795283d70839267
--   public.request_service_history_access(bigint,bigint,text)  md5 eb16d6ff8db01045369b330bc1fe3082
--   public.list_my_service_history_requests(bigint)  md5 849e65fd7513578572f1307778f267f1
--   public.revoke_service_history(bigint)  md5 031991b951143598428bc7466a7bd8fc
-- New: public.history_grantor_recent_shop_staff(bigint, uuid) (no client EXECUTE).
-- Table change: one nullable column + CHECK on service_history_grants
-- (additive; no policy or grant change). Idempotent (safe to re-run).
-- Rollback: 20261018_000925_service_history_n2_followups_rollback.sql
-- Proof: web/supabase/tests/20261018_service_history_n2_followups.sql

DO $$
BEGIN
  IF to_regclass('public.organization_membership_departures') IS NULL
     OR to_regclass('public.service_history_requests') IS NULL
     OR to_regprocedure('public.grant_service_history(bigint,bigint,bigint)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                    WHERE attrelid = 'public.organization_membership_departures'::regclass
                      AND attname = 'email' AND NOT attisdropped) THEN
    RAISE EXCEPTION '000925 requires 000922, 000923 and 000924';
  END IF;
END $$;

-- Drift guard: every replaced body must be the recorded live body (or this
-- migration's own, on a re-run).
DO $$
BEGIN
  IF md5(pg_catalog.pg_get_functiondef('public.grant_service_history(bigint,bigint,bigint)'::regprocedure))
     NOT IN ('3bae6eee0d7d0360b795283d70839267', '5dd66dd337620e9abbcd1bcc2da7896c') THEN
    RAISE EXCEPTION '000925: grant_service_history differs from the recorded live body; refusing to overwrite';
  END IF;
END $$;
DO $$
BEGIN
  IF md5(pg_catalog.pg_get_functiondef('public.request_service_history_access(bigint,bigint,text)'::regprocedure))
     NOT IN ('eb16d6ff8db01045369b330bc1fe3082', '6b6b3239a922033385159ac94e4b11c8') THEN
    RAISE EXCEPTION '000925: request_service_history_access differs from the recorded live body; refusing to overwrite';
  END IF;
END $$;
DO $$
BEGIN
  IF md5(pg_catalog.pg_get_functiondef('public.list_my_service_history_requests(bigint)'::regprocedure))
     NOT IN ('849e65fd7513578572f1307778f267f1', 'b120c31ad8e3bd21c10ed32f4f426afc') THEN
    RAISE EXCEPTION '000925: list_my_service_history_requests differs from the recorded live body; refusing to overwrite';
  END IF;
END $$;
DO $$
BEGIN
  IF md5(pg_catalog.pg_get_functiondef('public.revoke_service_history(bigint)'::regprocedure))
     NOT IN ('031991b951143598428bc7466a7bd8fc', 'ce11e179a58cb1355eafc0c4a9161860') THEN
    RAISE EXCEPTION '000925: revoke_service_history differs from the recorded live body; refusing to overwrite';
  END IF;
END $$;

-- Owner vs system revokes (see header). Additive, nullable, no default.
ALTER TABLE public.service_history_grants ADD COLUMN IF NOT EXISTS revoked_reason text;
ALTER TABLE public.service_history_grants DROP CONSTRAINT IF EXISTS service_history_grants_revoked_reason_check;
ALTER TABLE public.service_history_grants ADD CONSTRAINT service_history_grants_revoked_reason_check
  CHECK (revoked_reason IS NULL OR (revoked_reason = 'owner' AND revoked_at IS NOT NULL));
COMMENT ON COLUMN public.service_history_grants.revoked_reason IS
  'owner = revoked by the clinic through revoke_service_history (starts the 30-day request cooldown). NULL = active, or a system revoke (revoke-on-join, linked-shop removal) or a pre-000925 revoke.';


CREATE OR REPLACE FUNCTION public.history_grantor_recent_shop_staff(p_shop bigint, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- N-2 (000925): the clinic_shop_staff_now_or_recent rule (000923/000924),
  -- for ONE shop: a current member by id, a current member with the same
  -- login email, or a departure from that shop in the last 30 days by id or
  -- by the email they left with.
  WITH me AS (
    SELECT nullif(lower(btrim(coalesce(u.email, ''))), '') AS email
    FROM auth.users u WHERE u.id = p_user
  )
  SELECT p_shop IS NOT NULL AND p_user IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.organization_id = p_shop AND m.user_id = p_user
    ) OR EXISTS (
      SELECT 1
      FROM public.organization_memberships m
      JOIN auth.users u ON u.id = m.user_id
      JOIN me ON me.email IS NOT NULL AND lower(btrim(coalesce(u.email, ''))) = me.email
      WHERE m.organization_id = p_shop
    ) OR EXISTS (
      SELECT 1 FROM public.organization_membership_departures d
      WHERE d.organization_id = p_shop
        AND d.left_at > now() - interval '30 days'
        AND (
          d.user_id = p_user
          OR (d.email IS NOT NULL AND d.email = (SELECT me.email FROM me))
        )
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.history_grantor_recent_shop_staff(bigint, uuid) FROM PUBLIC, anon, authenticated, service_role;

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
  -- N-2 (000925): nor one who was on that shop's staff in the last 30 days
  -- (user id or login email; the 000923/000924 departures rule). Read-only,
  -- under the same tsp.history_grantor lock taken above; no new lock.
  IF public.history_grantor_recent_shop_staff(p_grantee_shop, uid) THEN
    RAISE EXCEPTION 'only an owner or admin who has not been part of that service company in the last 30 days can share with it' USING ERRCODE = '42501';
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
REVOKE ALL ON FUNCTION public.grant_service_history(bigint, bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_service_history(bigint, bigint, bigint) TO authenticated;

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
  last_revoked timestamptz;
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
  -- 000925: an OWNER revoke (revoke_service_history, revoked_reason 'owner')
  -- starts the same 30-day pair cooldown as a deny. System revokes
  -- (revoke-on-join trigger, linked-shop removal) leave revoked_reason NULL
  -- and do not.
  SELECT max(g.revoked_at) INTO last_revoked
  FROM public.service_history_grants g
  WHERE g.owner_org_id = p_owner_org
    AND g.grantee_shop_org_id = shop
    AND g.revoked_at IS NOT NULL
    AND g.revoked_reason = 'owner';
  last_denied := greatest(last_denied, last_revoked);
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
REVOKE ALL ON FUNCTION public.request_service_history_access(bigint, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_service_history_access(bigint, bigint, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_service_history_requests(p_equipment_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(id bigint, owner_org_id bigint, equipment_id bigint, status text, created_at timestamp with time zone, expires_at timestamp with time zone, responded_at timestamp with time zone, approved_scope text, retry_after timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH me AS (SELECT public.get_my_org_id() AS shop)
  SELECT q.id, q.owner_org_id, q.equipment_id,
         CASE
           WHEN q.status = 'pending' AND q.expires_at <= now() THEN 'expired'
           -- 000925: 'approved' only while an active grant covers this laser.
           WHEN q.status = 'approved' AND NOT EXISTS (
             SELECT 1 FROM public.service_history_grants g
             WHERE g.owner_org_id = q.owner_org_id
               AND g.grantee_shop_org_id = q.requester_shop_org_id
               AND g.revoked_at IS NULL
               AND (g.equipment_id IS NULL OR g.equipment_id = q.equipment_id)
           ) THEN 'revoked'
           ELSE q.status
         END,
         q.created_at, q.expires_at, q.responded_at, q.approved_scope,
         -- L-2: retry_after is the pair-level cooldown end, on every row of that clinic.
         -- 000925: an owner revoke of any grant for the pair counts like a deny.
         greatest(
           (SELECT max(d.responded_at) + interval '720 hours'
              FROM public.service_history_requests d
             WHERE d.owner_org_id = q.owner_org_id
               AND d.requester_shop_org_id = q.requester_shop_org_id
               AND d.status = 'denied'
               AND d.responded_at > now() - interval '720 hours'),
           (SELECT max(g.revoked_at) + interval '720 hours'
              FROM public.service_history_grants g
             WHERE g.owner_org_id = q.owner_org_id
               AND g.grantee_shop_org_id = q.requester_shop_org_id
               AND g.revoked_at > now() - interval '720 hours'
               AND g.revoked_reason = 'owner'))
  FROM me
  JOIN public.service_history_requests q ON q.requester_shop_org_id = me.shop
  WHERE me.shop IS NOT NULL
    AND public.is_active_org_member(me.shop)
    AND (p_equipment_id IS NULL OR q.equipment_id = p_equipment_id)
  ORDER BY q.created_at DESC, q.id DESC
  LIMIT 200;
$function$
;
REVOKE ALL ON FUNCTION public.list_my_service_history_requests(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_service_history_requests(bigint) TO authenticated;

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
     SET revoked_at = now(), revoked_by = uid,
         -- 000925: the deliberate owner revoke (counts for the request cooldown).
         revoked_reason = 'owner'
   WHERE id = p_grant_id AND revoked_at IS NULL;
  RETURN FOUND;
END;
$function$
;
REVOKE ALL ON FUNCTION public.revoke_service_history(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_service_history(bigint) TO authenticated;

-- (CREATE OR REPLACE keeps the existing ACL, incl. the live service_role grant.)

NOTIFY pgrst, 'reload schema';
