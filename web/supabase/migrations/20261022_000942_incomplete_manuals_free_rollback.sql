-- Rollback for 000942. Exact: restores the 000936 bodies, comments and grants of
-- manual_slots_held, manual_slot_is_held, manual_library_status and
-- manual_library_remove. Ledger rows written while 000942 was live keep
-- reason 'incomplete_free' (refunded=true): they hold no slot and do not count
-- toward the monthly cap under 000936 either. Re-runnable (no-op when 000942 is
-- not applied).

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('manual_slots_held','manual_slot_is_held','manual_library_status','manual_library_remove')
      AND coalesce(obj_description(p.oid, 'pg_proc'), '') NOT LIKE '000936%') THEN
    RAISE EXCEPTION '000942 rollback: a manual library function is not 000936/000942''s';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.manual_slots_held(p_org bigint)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(DISTINCT e.manual_id)::int
  FROM public.manual_library_events e
  WHERE e.organization_id = p_org
    AND e.kind = 'remove'
    AND e.refunded IS FALSE
    AND e.created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
    AND NOT EXISTS (SELECT 1 FROM public.organization_manuals om
                    WHERE om.organization_id = p_org AND om.manual_id = e.manual_id)
    AND (auth.role() = 'service_role' OR public.is_active_org_member(p_org));
$$;
COMMENT ON FUNCTION public.manual_slots_held(bigint) IS '000936 slots held by non-refunded removals this month';
REVOKE ALL ON FUNCTION public.manual_slots_held(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manual_slots_held(bigint) TO authenticated, service_role;

-- Is this manual's slot held for the org right now? Re-adding it nets zero.
CREATE OR REPLACE FUNCTION public.manual_slot_is_held(p_org bigint, p_manual_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.manual_library_events e
    WHERE e.organization_id = p_org AND e.manual_id = p_manual_id
      AND e.kind = 'remove' AND e.refunded IS FALSE
      AND e.created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
      AND NOT EXISTS (SELECT 1 FROM public.organization_manuals om
                      WHERE om.organization_id = p_org AND om.manual_id = p_manual_id))
    AND (auth.role() = 'service_role' OR public.is_active_org_member(p_org));
$$;
COMMENT ON FUNCTION public.manual_slot_is_held(bigint, bigint) IS '000936 is this manual''s slot held (re-add nets zero)';
REVOKE ALL ON FUNCTION public.manual_slot_is_held(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manual_slot_is_held(bigint, bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.manual_library_status(p_manual_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org bigint;
  v_row public.organization_manuals%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '42501'; END IF;
  SELECT organization_id INTO v_org FROM public.user_profiles WHERE id = v_uid;
  IF v_org IS NULL OR NOT public.is_active_org_member(v_org) THEN
    RAISE EXCEPTION 'not a member of a company' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.organization_manuals
  WHERE organization_id = v_org AND manual_id = p_manual_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('owned', false, 'slots_held', public.manual_slots_held(v_org));
  END IF;
  RETURN public.manual_refund_check(v_row.id, v_org, v_row.created_at, v_row.manual_id)
         || jsonb_build_object('owned', true, 'added_at', v_row.created_at,
                               'slots_held', public.manual_slots_held(v_org));
END;
$$;
COMMENT ON FUNCTION public.manual_library_status(bigint) IS '000936 refund eligibility preview for the caller org';
REVOKE ALL ON FUNCTION public.manual_library_status(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manual_library_status(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.manual_library_remove(p_manual_id bigint, p_source text DEFAULT 'web')
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_org    bigint;
  v_src    text := CASE WHEN p_source IN ('web','android','ios','api') THEN p_source ELSE 'unknown' END;
  v_row    public.organization_manuals%ROWTYPE;
  v_check  jsonb;
  v_refund boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '42501'; END IF;
  SELECT organization_id INTO v_org FROM public.user_profiles WHERE id = v_uid;
  IF v_org IS NULL OR NOT public.is_active_org_member(v_org) THEN
    RAISE EXCEPTION 'not a member of a company' USING ERRCODE = '42501';
  END IF;

  -- Serialize per org so two tabs cannot both take the last monthly refund.
  PERFORM pg_advisory_xact_lock(936, (v_org % 2147483647)::int);

  SELECT * INTO v_row FROM public.organization_manuals
  WHERE organization_id = v_org AND manual_id = p_manual_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('removed', false, 'refunded', false, 'reason', 'not_in_library');
  END IF;

  v_check  := public.manual_refund_check(v_row.id, v_org, v_row.created_at, v_row.manual_id);
  v_refund := (v_check->>'refund_eligible')::boolean;

  PERFORM set_config('tsp.manual_remove_row', v_row.id::text, true);
  DELETE FROM public.organization_manuals WHERE id = v_row.id;
  PERFORM set_config('tsp.manual_remove_row', '', true);

  INSERT INTO public.manual_library_events
    (organization_id, manual_id, library_row_id, user_id, kind, source, refunded, reason)
  VALUES (v_org, v_row.manual_id, v_row.id, v_uid, 'remove', v_src, v_refund, v_check->>'reason');

  RETURN jsonb_build_object(
    'removed', true,
    'refunded', v_refund,
    'reason', v_check->>'reason',
    'refunds_used', (v_check->>'refunds_used')::int + CASE WHEN v_refund THEN 1 ELSE 0 END,
    'refunds_cap', (v_check->>'refunds_cap')::int,
    'slots_held', public.manual_slots_held(v_org));
END;
$$;
COMMENT ON FUNCTION public.manual_library_remove(bigint, text) IS '000936 remove from company library; refunds the slot only under the 000936 rules';
REVOKE ALL ON FUNCTION public.manual_library_remove(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manual_library_remove(bigint, text) TO authenticated;

COMMIT;
