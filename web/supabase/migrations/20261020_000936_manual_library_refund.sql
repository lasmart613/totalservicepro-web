-- 000936: company manual library: add/remove ledger, server-enforced Remove & refund.
--
-- Background (/workspace/manual-autoadd/REPORT.md): a double click on /manuals
-- added manual 67 to org 4 via the native window.confirm. The web PR adds an
-- in-app confirm (Cancel default) and an in-flight guard; this migration is the
-- server half of "Undo / Remove & refund".
--
-- How slots work today (prod, read-only check 2026-10-20): slots used = the live
-- row count of organization_manuals (+ legacy user_manuals) for the org,
-- compared with manualSlotLimit(plan) in TypeScript (POST /api/manuals/library,
-- get-manual-url action=add, and the page's pre-check). There is no counter,
-- so before 000936 any DELETE freed a slot at once: every removal was a refund.
--
-- After 000936:
--   * public.manual_library_events: append-only ledger (add, remove, page_view,
--     download, print, url_issued), each with a source (web/android/ios/api/
--     edge/db/unknown). Written only by triggers and SECURITY DEFINER
--     functions. anon/authenticated have no table privileges at all.
--   * organization_manuals.source (nullable): who added the row. An AFTER INSERT
--     trigger logs every add from every writer (route, edge, client fallback).
--   * public.manual_library_remove(manual_id, source): the only refund path.
--     Removal always works. It REFUNDS the slot only when ALL of:
--       - the row was added less than 24h ago (organization_manuals.created_at);
--       - no download and no print was recorded since that add;
--       - not heavy reading since that add: more than 20 distinct pages viewed,
--         or more than half of a manual of at most 40 pages, or more than 15
--         signed URLs issued by get-manual-url (server-side proxy, see below);
--       - the org has had fewer than 3 refunded removals this calendar month (UTC).
--     A removal that does not refund keeps holding its slot until the end of the
--     calendar month (UTC): see manual_slots_held(org). Re-adding the same
--     manual releases the held slot (it is counted once, as owned).
--   * A direct DELETE (RLS still allows members to delete) is logged as a
--     non-refunded removal by an AFTER DELETE trigger, so it cannot dodge the
--     rules. Catalog deletions (manuals row gone, FK cascade) count as refunded.
--   * public.manual_record_access(manual_id, kind, pages, page_count, source):
--     viewer reports page views, downloads and prints (page_count is ignored). It records only while
--     the caller's org owns the manual and only inside the 24h window.
--   * public.manual_record_url_issued(org, manual, user, source): service_role
--     only; get-manual-url calls it each time it signs a URL for an owned
--     manual. This count is the tamper-proof proxy: the PDF is served whole by
--     a signed URL, so page views are client-reported. A client that suppresses
--     page reports still cannot refetch the file more than 15 times and refund.
--   * public.manual_library_status(manual_id): eligibility preview for the UI.
--   * public.manual_slots_held(org): non-refunded removals still holding a slot
--     this month; the add paths add it to the used count.
--
--   * Direct client writes are closed (QA #332 MEDIUM): INSERT, UPDATE and
--     MAINTAIN on organization_manuals are revoked from anon and authenticated.
--     Adds go only through POST /api/manuals/library or get-manual-url
--     action=add (service_role), which enforce plan limit + held slots in code.
--     A BEFORE INSERT trigger (SECURITY INVOKER) refuses any other role (42501)
--     and clamps created_at to now() at most, so the 24h window cannot be
--     forged even by a future definer function or a mistaken GRANT.
--   * The "most of a short manual" rule uses the server's page count (sum of
--     manuals.chapter_metadata[*].page_count when every entry has one). Client
--     page counts are ignored. Unknown page count: only the >20 pages and URL
--     rules apply.
--   * Re-adding a manual whose slot is held (non-refunded removal this month)
--     nets zero, so the add paths allow it even when full; removing it again
--     inside 24h is reported as 'still_held' (no refund, no cap use) because
--     the earlier hold comes back.
--
-- Wrapped in BEGIN/COMMIT. Idempotent. Objects carry COMMENT '000936 ...' so the
-- drift guards and the rollback refuse anything 000936 did not create.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ---------- drift guards ----------
DO $$
DECLARE
  v_missing text;
BEGIN
  IF to_regclass('public.organization_manuals') IS NULL THEN
    RAISE EXCEPTION '000936 drift: public.organization_manuals is missing';
  END IF;
  SELECT string_agg(c, ', ') INTO v_missing
  FROM unnest(ARRAY['id','organization_id','manual_id','added_by','created_at']) c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organization_manuals' AND column_name = c);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '000936 drift: organization_manuals is missing column(s): %', v_missing;
  END IF;
  -- organization_manuals ACL must be the prod shape (or already 000936's), so the
  -- rollback can restore it exactly.
  IF (SELECT string_agg(a::text, ',' ORDER BY a::text) FROM pg_class c, unnest(c.relacl) a
      WHERE c.oid = 'public.organization_manuals'::regclass
        AND (a::text LIKE 'anon=%' OR a::text LIKE 'authenticated=%'))
     NOT IN ('anon=rm/postgres,authenticated=arwdm/postgres', 'anon=r/postgres,authenticated=rd/postgres') THEN
    RAISE EXCEPTION '000936 drift: organization_manuals anon/authenticated ACL is not the expected prod shape';
  END IF;
  IF to_regprocedure('public.is_active_org_member(bigint)') IS NULL THEN
    RAISE EXCEPTION '000936 drift: public.is_active_org_member(bigint) missing';
  END IF;
  IF to_regclass('public.manual_library_events') IS NOT NULL
     AND coalesce(obj_description(to_regclass('public.manual_library_events'), 'pg_class'), '') NOT LIKE '000936%' THEN
    RAISE EXCEPTION '000936 drift: a public.manual_library_events not created by 000936 already exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organization_manuals' AND column_name = 'source')
     AND coalesce(col_description('public.organization_manuals'::regclass,
           (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.organization_manuals'::regclass AND attname = 'source')), '')
         NOT LIKE '000936%' THEN
    RAISE EXCEPTION '000936 drift: organization_manuals.source exists but was not created by 000936';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('manual_library_remove','manual_library_status','manual_record_access',
                        'manual_record_url_issued','manual_slots_held','manual_refund_check',
                        'manual_library_log_add','manual_library_log_delete',
                        'manual_library_guard_insert','manual_slot_is_held')
      AND coalesce(obj_description(p.oid, 'pg_proc'), '') NOT LIKE '000936%') THEN
    RAISE EXCEPTION '000936 drift: a manual library function not created by 000936 already exists';
  END IF;
END $$;

-- ---------- ledger ----------
CREATE TABLE IF NOT EXISTS public.manual_library_events (
  id              bigserial PRIMARY KEY,
  organization_id bigint NOT NULL,
  manual_id       bigint NOT NULL,
  library_row_id  bigint,              -- organization_manuals.id the event belongs to
  user_id         uuid,
  kind            text NOT NULL CHECK (kind IN ('add','remove','page_view','download','print','url_issued')),
  source          text NOT NULL DEFAULT 'unknown'
                  CHECK (source IN ('web','android','ios','api','edge','db','unknown')),
  page            integer CHECK (page IS NULL OR page BETWEEN 1 AND 100000),
  page_count      integer CHECK (page_count IS NULL OR page_count BETWEEN 1 AND 100000),
  refunded        boolean,
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- No FKs on purpose: the ledger outlives the library row, the org and the manual.
COMMENT ON TABLE public.manual_library_events IS
  '000936 append-only ledger of company manual library adds/removes and reads (refund rules).';
CREATE INDEX IF NOT EXISTS manual_library_events_row_idx
  ON public.manual_library_events (library_row_id, kind);
CREATE INDEX IF NOT EXISTS manual_library_events_org_idx
  ON public.manual_library_events (organization_id, kind, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS manual_library_events_page_once
  ON public.manual_library_events (library_row_id, page) WHERE kind = 'page_view';

ALTER TABLE public.manual_library_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.manual_library_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.manual_library_events_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.manual_library_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.manual_library_events_id_seq TO service_role;

-- ---------- organization_manuals.source ----------
ALTER TABLE public.organization_manuals ADD COLUMN IF NOT EXISTS source text;
COMMENT ON COLUMN public.organization_manuals.source IS
  '000936 client that added the row (web/android/ios/api/edge/db/unknown); NULL = unknown/legacy.';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.organization_manuals'::regclass
                   AND conname = 'organization_manuals_source_check') THEN
    ALTER TABLE public.organization_manuals ADD CONSTRAINT organization_manuals_source_check
      CHECK (source IS NULL OR source IN ('web','android','ios','api','edge','db','unknown'));
  END IF;
END $$;

-- ---------- close direct client writes ----------
REVOKE INSERT, UPDATE, MAINTAIN ON TABLE public.organization_manuals FROM anon, authenticated;
REVOKE MAINTAIN ON TABLE public.organization_manuals FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.manual_library_guard_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- INVOKER on purpose: current_user is the real caller.
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'add manuals through /api/manuals/library' USING ERRCODE = '42501';
  END IF;
  -- Nobody, not even the service role, can date an add in the future.
  NEW.created_at := least(coalesce(NEW.created_at, now()), now());
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.manual_library_guard_insert() IS '000936 trigger: only trusted roles add; created_at <= now()';
REVOKE ALL ON FUNCTION public.manual_library_guard_insert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS organization_manuals_guard_insert ON public.organization_manuals;
CREATE TRIGGER organization_manuals_guard_insert
  BEFORE INSERT ON public.organization_manuals
  FOR EACH ROW EXECUTE FUNCTION public.manual_library_guard_insert();

-- ---------- triggers: log every add and every delete ----------
CREATE OR REPLACE FUNCTION public.manual_library_log_add()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.manual_library_events
    (organization_id, manual_id, library_row_id, user_id, kind, source)
  VALUES
    (NEW.organization_id, NEW.manual_id, NEW.id, coalesce(NEW.added_by, auth.uid()), 'add',
     coalesce(NEW.source, 'unknown'));
  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION public.manual_library_log_add() IS '000936 trigger: log organization_manuals inserts';

CREATE OR REPLACE FUNCTION public.manual_library_log_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_catalog_gone boolean;
BEGIN
  -- manual_library_remove() logs its own row (with the refund decision).
  IF coalesce(current_setting('tsp.manual_remove_row', true), '') = OLD.id::text THEN
    RETURN NULL;
  END IF;
  v_catalog_gone := NOT EXISTS (SELECT 1 FROM public.manuals m WHERE m.id = OLD.manual_id);
  INSERT INTO public.manual_library_events
    (organization_id, manual_id, library_row_id, user_id, kind, source, refunded, reason)
  VALUES
    (OLD.organization_id, OLD.manual_id, OLD.id, auth.uid(), 'remove', 'db',
     v_catalog_gone, CASE WHEN v_catalog_gone THEN 'catalog_removed' ELSE 'direct_delete' END);
  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION public.manual_library_log_delete() IS '000936 trigger: log organization_manuals deletes';

REVOKE ALL ON FUNCTION public.manual_library_log_add() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.manual_library_log_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS organization_manuals_log_add ON public.organization_manuals;
CREATE TRIGGER organization_manuals_log_add
  AFTER INSERT ON public.organization_manuals
  FOR EACH ROW EXECUTE FUNCTION public.manual_library_log_add();
DROP TRIGGER IF EXISTS organization_manuals_log_delete ON public.organization_manuals;
CREATE TRIGGER organization_manuals_log_delete
  AFTER DELETE ON public.organization_manuals
  FOR EACH ROW EXECUTE FUNCTION public.manual_library_log_delete();

-- ---------- rule evaluation (internal) ----------
CREATE OR REPLACE FUNCTION public.manual_refund_check(p_row_id bigint, p_org bigint, p_added_at timestamptz, p_manual_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_window    constant interval := interval '24 hours';
  c_pages     constant int := 20;   -- more than this many distinct pages = heavy
  c_short     constant int := 40;   -- "short manual": at most this many pages
  c_urls      constant int := 15;   -- more than this many signed URLs = heavy
  c_cap       constant int := 3;    -- refunded removals per org per calendar month (UTC)
  v_pages     int;
  v_pc        int;
  v_urls      int;
  v_dl        boolean;
  v_pr        boolean;
  v_used      int;
  v_held      boolean;
  v_reason    text := NULL;
  v_month     timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
BEGIN
  SELECT count(*) FILTER (WHERE kind = 'page_view'),
         count(*) FILTER (WHERE kind = 'url_issued'),
         bool_or(kind = 'download'),
         bool_or(kind = 'print')
    INTO v_pages, v_urls, v_dl, v_pr
  FROM public.manual_library_events
  WHERE library_row_id = p_row_id;

  -- Server page count: sum of chapter_metadata[*].page_count, only when every
  -- entry has a positive one. Client-sent page counts are never used.
  SELECT CASE WHEN count(*) > 0 AND bool_and(e ? 'page_count' AND jsonb_typeof(e->'page_count') = 'number'
                                             AND (e->>'page_count')::numeric >= 1)
              THEN least(sum(floor((e->>'page_count')::numeric)), 100000)::int END
    INTO v_pc
  FROM public.manuals m,
       jsonb_array_elements(CASE WHEN jsonb_typeof(m.chapter_metadata) = 'array' THEN m.chapter_metadata ELSE '[]'::jsonb END) e
  WHERE m.id = p_manual_id;

  SELECT EXISTS (
    SELECT 1 FROM public.manual_library_events h
    WHERE h.organization_id = p_org AND h.manual_id = p_manual_id AND h.kind = 'remove'
      AND h.refunded IS FALSE AND h.created_at < p_added_at AND h.created_at >= v_month)
    INTO v_held;

  SELECT count(*) INTO v_used
  FROM public.manual_library_events
  WHERE organization_id = p_org AND kind = 'remove' AND refunded AND reason = 'refund'
    AND created_at >= v_month;

  IF now() - p_added_at >= c_window THEN
    v_reason := 'window_expired';
  ELSIF v_held THEN
    v_reason := 'still_held';   -- the earlier hold comes back; nothing to refund
  ELSIF coalesce(v_dl, false) THEN
    v_reason := 'downloaded';
  ELSIF coalesce(v_pr, false) THEN
    v_reason := 'printed';
  ELSIF v_pages > c_pages OR (v_pc IS NOT NULL AND v_pc <= c_short AND v_pages * 2 > v_pc) THEN
    v_reason := 'heavy_reading';
  ELSIF v_urls > c_urls THEN
    v_reason := 'many_fetches';
  ELSIF v_used >= c_cap THEN
    v_reason := 'monthly_cap';
  END IF;

  RETURN jsonb_build_object(
    'refund_eligible', v_reason IS NULL,
    'reason', coalesce(v_reason, 'refund'),
    'refund_until', p_added_at + c_window,
    'pages_viewed', v_pages,
    'page_count', v_pc,
    'url_fetches', v_urls,
    'refunds_used', v_used,
    'refunds_cap', c_cap);
END;
$$;
COMMENT ON FUNCTION public.manual_refund_check(bigint, bigint, timestamptz, bigint) IS '000936 internal refund rules';
REVOKE ALL ON FUNCTION public.manual_refund_check(bigint, bigint, timestamptz, bigint) FROM PUBLIC, anon, authenticated;

-- ---------- held slots ----------
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

-- caller's org (profile org, must be an active member)
-- (inline in each function; no extra helper so the surface stays small)

-- ---------- status preview ----------
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

-- ---------- remove (the only refund path) ----------
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

-- ---------- viewer reports (page views, download, print) ----------
CREATE OR REPLACE FUNCTION public.manual_record_access(
  p_manual_id bigint, p_kind text, p_pages integer[] DEFAULT NULL,
  p_page_count integer DEFAULT NULL, p_source text DEFAULT 'web')
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org bigint;
  v_src text := CASE WHEN p_source IN ('web','android','ios','api') THEN p_source ELSE 'unknown' END;
  -- p_page_count is accepted for client compatibility and ignored (server page count only).
  v_pc  int  := NULL;
  v_row public.organization_manuals%ROWTYPE;
  v_n   int := 0;
BEGIN
  IF p_kind NOT IN ('page_view','download','print') THEN
    RAISE EXCEPTION 'bad kind' USING ERRCODE = '22023';
  END IF;
  IF v_uid IS NULL THEN RETURN 0; END IF;
  SELECT organization_id INTO v_org FROM public.user_profiles WHERE id = v_uid;
  IF v_org IS NULL OR NOT public.is_active_org_member(v_org) THEN RETURN 0; END IF;
  SELECT * INTO v_row FROM public.organization_manuals
  WHERE organization_id = v_org AND manual_id = p_manual_id;
  -- Only reads inside the refund window matter; skip the rest (keeps the ledger small).
  IF NOT FOUND OR now() - v_row.created_at >= interval '24 hours' THEN RETURN 0; END IF;

  IF p_kind = 'page_view' THEN
    INSERT INTO public.manual_library_events
      (organization_id, manual_id, library_row_id, user_id, kind, source, page, page_count)
    SELECT v_org, v_row.manual_id, v_row.id, v_uid, 'page_view', v_src, pg, v_pc
    FROM (SELECT DISTINCT pg FROM unnest(coalesce(p_pages, '{}'::int[])) pg
          WHERE pg BETWEEN 1 AND 100000 LIMIT 500) s
    ON CONFLICT (library_row_id, page) WHERE kind = 'page_view' DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSE
    INSERT INTO public.manual_library_events
      (organization_id, manual_id, library_row_id, user_id, kind, source)
    VALUES (v_org, v_row.manual_id, v_row.id, v_uid, p_kind, v_src);
    v_n := 1;
  END IF;
  RETURN v_n;
END;
$$;
COMMENT ON FUNCTION public.manual_record_access(bigint, text, integer[], integer, text) IS '000936 viewer page/download/print reports';
REVOKE ALL ON FUNCTION public.manual_record_access(bigint, text, integer[], integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manual_record_access(bigint, text, integer[], integer, text) TO authenticated;

-- ---------- get-manual-url signed URL count (service_role only) ----------
CREATE OR REPLACE FUNCTION public.manual_record_url_issued(
  p_org bigint, p_manual_id bigint, p_user uuid, p_source text DEFAULT 'edge')
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.organization_manuals%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.organization_manuals
  WHERE organization_id = p_org AND manual_id = p_manual_id;
  IF NOT FOUND OR now() - v_row.created_at >= interval '24 hours' THEN RETURN 0; END IF;
  INSERT INTO public.manual_library_events
    (organization_id, manual_id, library_row_id, user_id, kind, source)
  VALUES (p_org, p_manual_id, v_row.id, p_user, 'url_issued',
          CASE WHEN p_source IN ('web','android','ios','api','edge') THEN p_source ELSE 'edge' END);
  RETURN 1;
END;
$$;
COMMENT ON FUNCTION public.manual_record_url_issued(bigint, bigint, uuid, text) IS '000936 get-manual-url signed URL ledger (service_role)';
REVOKE ALL ON FUNCTION public.manual_record_url_issued(bigint, bigint, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manual_record_url_issued(bigint, bigint, uuid, text) TO service_role;

COMMIT;
