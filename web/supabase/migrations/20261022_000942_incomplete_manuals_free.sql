-- 000942: incomplete manuals (manuals.is_incomplete = true) are free.
--
-- Product rule (Larry, 2026-10-22): a manual flagged incomplete is free to view
-- and never counts against the company's manual slots.
--
-- Web/edge half (same PR): get-manual-url, POST /api/manuals/library and the
-- /manuals page exclude incomplete manuals from the used count, skip the cap
-- for them, and get-manual-url serves an incomplete manual to a company member
-- without a library row (shelf and storage path still checked).
--
-- DB half (this file). It changes only the Remove & refund rules of 000936:
--   * manual_slots_held / manual_slot_is_held: a removed incomplete manual
--     never holds a slot (also covers direct DELETEs logged by the 000936
--     trigger as non-refunded, and manuals flagged incomplete later).
--   * manual_library_status: owned incomplete manual -> refund_eligible=true,
--     reason 'incomplete_free', free=true.
--   * manual_library_remove: removing an incomplete manual is logged refunded
--     with reason 'incomplete_free'. It does NOT use one of the 3 monthly
--     refunds (the cap counts reason = 'refund' only) and refunds_used is not
--     bumped.
-- Signatures, SECURITY DEFINER, search_path '', and grants are unchanged from
-- 000936 and re-stated explicitly. No table, column, RLS or data change.
-- Comments keep the '000936' prefix (so the 000936 rollback still recognizes
-- them) plus a '(000942: incomplete manuals are free)' suffix for the 000942 guards.
-- Wrapped in BEGIN/COMMIT. Idempotent. Rollback: *_rollback.sql (exact 000936 bodies).

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.manuals'::regclass AND attname = 'is_incomplete'
      AND atttypid = 'boolean'::regtype AND NOT attisdropped) THEN
    RAISE EXCEPTION '000942 drift: public.manuals.is_incomplete (boolean) is missing';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.oid IN (
        to_regprocedure('public.manual_slots_held(bigint)'),
        to_regprocedure('public.manual_slot_is_held(bigint,bigint)'),
        to_regprocedure('public.manual_library_status(bigint)'),
        to_regprocedure('public.manual_library_remove(bigint,text)'),
        to_regprocedure('public.manual_refund_check(bigint,bigint,timestamptz,bigint)'))
        AND coalesce(obj_description(p.oid, 'pg_proc'), '') LIKE '000936%') <> 5 THEN
    RAISE EXCEPTION '000942 drift: 000936 manual library functions are missing or not 000936''s (apply 000936 first)';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN ('manual_slots_held','manual_slot_is_held','manual_library_status','manual_library_remove')) <> 4 THEN
    RAISE EXCEPTION '000942 drift: unexpected overloads of the manual library functions';
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
    -- 000942: incomplete manuals are free, so they never hold a slot.
    AND NOT EXISTS (SELECT 1 FROM public.manuals m
                    WHERE m.id = e.manual_id AND m.is_incomplete IS TRUE)
    AND (auth.role() = 'service_role' OR public.is_active_org_member(p_org));
$$;
COMMENT ON FUNCTION public.manual_slots_held(bigint) IS '000936 slots held by non-refunded removals this month (000942: incomplete manuals are free)';
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
                      WHERE om.organization_id = p_org AND om.manual_id = p_manual_id)
      -- 000942: incomplete manuals are free, so they never hold a slot.
      AND NOT EXISTS (SELECT 1 FROM public.manuals m
                      WHERE m.id = p_manual_id AND m.is_incomplete IS TRUE))
    AND (auth.role() = 'service_role' OR public.is_active_org_member(p_org));
$$;
COMMENT ON FUNCTION public.manual_slot_is_held(bigint, bigint) IS '000936 is this manual''s slot held (re-add nets zero) (000942: incomplete manuals are free)';
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
  IF EXISTS (SELECT 1 FROM public.manuals m WHERE m.id = v_row.manual_id AND m.is_incomplete IS TRUE) THEN
    -- 000942: free manual. Removing it frees nothing and uses no monthly refund.
    RETURN public.manual_refund_check(v_row.id, v_org, v_row.created_at, v_row.manual_id)
           || jsonb_build_object('refund_eligible', true, 'reason', 'incomplete_free', 'free', true,
                                 'owned', true, 'added_at', v_row.created_at,
                                 'slots_held', public.manual_slots_held(v_org));
  END IF;
  RETURN public.manual_refund_check(v_row.id, v_org, v_row.created_at, v_row.manual_id)
         || jsonb_build_object('owned', true, 'added_at', v_row.created_at,
                               'slots_held', public.manual_slots_held(v_org));
END;
$$;
COMMENT ON FUNCTION public.manual_library_status(bigint) IS '000936 refund eligibility preview for the caller org (000942: incomplete manuals are free)';
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
  v_free   boolean := false;
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
  -- 000942: incomplete manuals are free. Logged refunded=true with reason
  -- 'incomplete_free': no held slot, and the monthly cap counts only 'refund'.
  IF EXISTS (SELECT 1 FROM public.manuals m WHERE m.id = v_row.manual_id AND m.is_incomplete IS TRUE) THEN
    v_free := true;
    v_refund := true;
    v_check := v_check || jsonb_build_object('reason', 'incomplete_free');
  END IF;

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
    'refunds_used', (v_check->>'refunds_used')::int + CASE WHEN v_refund AND NOT v_free THEN 1 ELSE 0 END,
    'free', v_free,
    'refunds_cap', (v_check->>'refunds_cap')::int,
    'slots_held', public.manual_slots_held(v_org));
END;
$$;
COMMENT ON FUNCTION public.manual_library_remove(bigint, text) IS '000936 remove from company library; refunds the slot only under the 000936 rules (000942: incomplete manuals are free)';
REVOKE ALL ON FUNCTION public.manual_library_remove(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manual_library_remove(bigint, text) TO authenticated;

COMMIT;
