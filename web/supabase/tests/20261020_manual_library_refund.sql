-- Local proof for 20261020_000936_manual_library_refund.sql and its rollback.
-- Empty Postgres 17 scratch database only (never production). Refuses to run when
-- public.organization_manuals already exists. Prod-shaped organization_manuals
-- (columns, ACL anon=rm / authenticated=arwdm, 3 member policies, UNIQUE).
-- Fixture rows are synthetic (orgs 7001/7002, made-up users).
--
--   createdb manual_refund_proof
--   psql "postgresql:///manual_refund_proof" -v ON_ERROR_STOP=1 \
--     -v mig=path/to/20261020_000936_manual_library_refund.sql \
--     -v rb=path/to/20261020_000936_manual_library_refund_rollback.sql \
--     -f path/to/web/supabase/tests/20261020_manual_library_refund.sql
--   dropdb manual_refund_proof
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF to_regclass('public.organization_manuals') IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to run: public.organization_manuals already exists';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
-- prod default ACLs for objects created by postgres in public
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, MAINTAIN ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT INSERT, SELECT, UPDATE, DELETE, MAINTAIN ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;

CREATE TABLE public.organizations (id bigint PRIMARY KEY, name text);
CREATE TABLE public.organization_memberships (id bigserial PRIMARY KEY, user_id uuid NOT NULL, organization_id bigint NOT NULL, role text);
CREATE TABLE public.user_profiles (id uuid PRIMARY KEY, organization_id bigint, role text);
CREATE TABLE public.manuals (id bigint PRIMARY KEY, title text, chapter_metadata jsonb DEFAULT '[]'::jsonb);
CREATE OR REPLACE FUNCTION public.is_active_org_member(p_org bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.user_id = auth.uid() AND m.organization_id = p_org); $$;

CREATE TABLE public.organization_manuals (
  id bigserial PRIMARY KEY,
  organization_id bigint REFERENCES public.organizations(id) ON DELETE CASCADE,
  manual_id bigint REFERENCES public.manuals(id) ON DELETE CASCADE,
  added_by uuid,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT organization_manuals_organization_id_manual_id_key UNIQUE (organization_id, manual_id)
);
ALTER TABLE public.organization_manuals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_manuals FROM PUBLIC, anon, authenticated;
GRANT SELECT, MAINTAIN ON public.organization_manuals TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, MAINTAIN ON public.organization_manuals TO authenticated;
GRANT ALL ON public.organization_manuals TO service_role;
CREATE POLICY organization_manuals_member_select ON public.organization_manuals FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()) AND public.is_active_org_member(organization_id));
CREATE POLICY organization_manuals_member_insert ON public.organization_manuals FOR INSERT
  WITH CHECK (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()) AND public.is_active_org_member(organization_id));
CREATE POLICY organization_manuals_member_delete ON public.organization_manuals FOR DELETE
  USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()) AND public.is_active_org_member(organization_id));
GRANT SELECT ON public.user_profiles, public.manuals, public.organization_memberships TO authenticated;

-- fixtures
INSERT INTO public.organizations VALUES (7001, 'Proof Service A'), (7002, 'Proof Service B');
INSERT INTO public.manuals SELECT g, 'Manual ' || g FROM generate_series(1, 40) g;
-- server page counts: 10 and 11 are 10-page manuals (two chapters 4 + 6); 8 has an entry without page_count
UPDATE public.manuals SET chapter_metadata = '[{"order":0,"page_count":4},{"order":1,"page_count":6}]' WHERE id IN (10, 11);
UPDATE public.manuals SET chapter_metadata = '[{"order":0,"page_count":4},{"order":1}]' WHERE id = 8;
INSERT INTO public.user_profiles VALUES
  ('a0000000-0000-0000-0000-00000000000a', 7001, 'owner'),   -- alice, org A
  ('b0000000-0000-0000-0000-00000000000b', 7002, 'owner'),   -- bob, org B
  ('c0000000-0000-0000-0000-00000000000c', 7001, 'tech');    -- carl: profile says A, no membership
INSERT INTO public.organization_memberships (user_id, organization_id, role) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 7001, 'owner'),
  ('b0000000-0000-0000-0000-00000000000b', 7002, 'owner');
-- legacy row added before 000936 (no ledger entry)
INSERT INTO public.organization_manuals (organization_id, manual_id, added_by, created_at)
VALUES (7001, 40, 'a0000000-0000-0000-0000-00000000000a', now() - interval '2 hours');

CREATE TABLE pg_temp.results (n serial, name text, ok boolean, detail text);
GRANT ALL ON pg_temp.results TO PUBLIC;
GRANT ALL ON SEQUENCE pg_temp.results_n_seq TO PUBLIC;
CREATE OR REPLACE FUNCTION pg_temp.check(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void
LANGUAGE sql AS $$ INSERT INTO pg_temp.results (name, ok, detail) VALUES (p_name, coalesce(p_ok, false), p_detail) $$;

-- snapshot (for exact rollback)
CREATE OR REPLACE FUNCTION pg_temp.snap() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(x, E'\n' ORDER BY x) FROM (
    SELECT 'col ' || attname || ' ' || format_type(atttypid, atttypmod) || ' ' || coalesce(array_to_string(attacl, ','), '')
      FROM pg_attribute WHERE attrelid = 'public.organization_manuals'::regclass AND attnum > 0 AND NOT attisdropped
    UNION ALL SELECT 'acl ' || (SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(relacl) a) FROM pg_class WHERE oid = 'public.organization_manuals'::regclass
    UNION ALL SELECT 'con ' || conname || ' ' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.organization_manuals'::regclass
    UNION ALL SELECT 'pol ' || polname || ' ' || polcmd::text || ' ' || coalesce(pg_get_expr(polqual, polrelid), '') || ' | ' || coalesce(pg_get_expr(polwithcheck, polrelid), '')
      FROM pg_policy WHERE polrelid = 'public.organization_manuals'::regclass
    UNION ALL SELECT 'trg ' || tgname FROM pg_trigger WHERE tgrelid = 'public.organization_manuals'::regclass AND NOT tgisinternal
    UNION ALL SELECT 'fn ' || p.oid::regprocedure::text || ' ' || coalesce(array_to_string(p.proacl, ','), '')
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
    UNION ALL SELECT 'rel ' || c.relname || ' ' || c.relkind::text FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
    UNION ALL SELECT 'rows ' || count(*) FROM public.organization_manuals
  ) s(x) $$;
CREATE TEMP TABLE before_snap AS SELECT pg_temp.snap() AS s;

-- acting as a signed-in user / service role
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', p_uid, false), set_config('request.jwt.claim.role', 'authenticated', false) $$;
\set alice '''a0000000-0000-0000-0000-00000000000a'''
\set bob   '''b0000000-0000-0000-0000-00000000000b'''
\set carl  '''c0000000-0000-0000-0000-00000000000c'''

-- ================= apply =================
\i :mig
\i :mig
SELECT pg_temp.check('01 apply + re-apply (idempotent)', (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.organization_manuals'::regclass AND NOT tgisinternal) = 3);

-- ================= grants =================
SELECT pg_temp.check('02 ledger closed to anon/authenticated',
  NOT has_table_privilege('anon', 'public.manual_library_events', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.manual_library_events', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('anon', 'public.manual_library_events', 'MAINTAIN')
  AND NOT has_table_privilege('authenticated', 'public.manual_library_events', 'MAINTAIN')
  AND has_table_privilege('service_role', 'public.manual_library_events', 'SELECT'));
SELECT pg_temp.check('03 function grants',
  NOT has_function_privilege('anon', 'public.manual_library_remove(bigint,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.manual_library_status(bigint)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.manual_record_access(bigint,text,integer[],integer,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.manual_library_remove(bigint,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.manual_record_access(bigint,text,integer[],integer,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.manual_record_url_issued(bigint,bigint,uuid,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.manual_record_url_issued(bigint,bigint,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.manual_refund_check(bigint,bigint,timestamptz,bigint)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.manual_library_log_add()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.manual_slots_held(bigint)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.manual_slot_is_held(bigint,bigint)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.manual_library_guard_insert()', 'EXECUTE'));

-- ================= add logging =================
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SET ROLE service_role;
INSERT INTO public.organization_manuals (organization_id, manual_id, added_by, source) VALUES (7001, 1, 'a0000000-0000-0000-0000-00000000000a', 'web');
INSERT INTO public.organization_manuals (organization_id, manual_id, added_by) VALUES (7001, 2, 'a0000000-0000-0000-0000-00000000000a');
-- forged future created_at is clamped to now()
INSERT INTO public.organization_manuals (organization_id, manual_id, added_by, source, created_at) VALUES (7001, 3, 'a0000000-0000-0000-0000-00000000000a', 'api', now() + interval '10 years');
RESET ROLE;
SELECT pg_temp.check('04b created_at can never be in the future (clamped, even for service_role)',
  (SELECT created_at <= now() FROM public.organization_manuals WHERE organization_id = 7001 AND manual_id = 3));
DELETE FROM public.organization_manuals WHERE organization_id = 7001 AND manual_id = 3;
DELETE FROM public.manual_library_events WHERE manual_id = 3;

-- direct client INSERT is closed (QA #332 MEDIUM)
SELECT pg_temp.as_user(:alice);
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN
    INSERT INTO public.organization_manuals (organization_id, manual_id, added_by, source, created_at)
    VALUES (7001, 3, auth.uid(), 'web', now() + interval '10 years');
    PERFORM pg_temp.check('04c member direct INSERT refused (privilege revoked)', false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check('04c member direct INSERT refused (privilege revoked)', true);
  END;
  BEGIN
    UPDATE public.organization_manuals SET created_at = now() WHERE organization_id = 7001;
    PERFORM pg_temp.check('04d member UPDATE refused (privilege revoked)', false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check('04d member UPDATE refused (privilege revoked)', true);
  END;
END $$;
RESET ROLE;
-- defense in depth: even with INSERT granted by mistake, the BEFORE INSERT trigger refuses
DO $$ BEGIN
  GRANT INSERT ON public.organization_manuals TO authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000a', true);
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.organization_manuals (organization_id, manual_id, added_by) VALUES (7001, 3, auth.uid());
    RESET ROLE;
    PERFORM pg_temp.check('04e guard trigger refuses non-service INSERT', false);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.check('04e guard trigger refuses non-service INSERT', SQLERRM LIKE 'add manuals through%', SQLERRM);
  END;
  RESET ROLE;
  REVOKE INSERT ON public.organization_manuals FROM authenticated;
END $$;
SELECT pg_temp.check('04f MAINTAIN closed on organization_manuals and the ledger',
  NOT has_table_privilege('anon', 'public.organization_manuals', 'MAINTAIN')
  AND NOT has_table_privilege('authenticated', 'public.organization_manuals', 'MAINTAIN')
  AND NOT has_table_privilege('authenticated', 'public.organization_manuals', 'INSERT')
  AND has_table_privilege('authenticated', 'public.organization_manuals', 'SELECT')
  AND has_table_privilege('authenticated', 'public.organization_manuals', 'DELETE')
  AND has_table_privilege('service_role', 'public.organization_manuals', 'INSERT'));
SELECT pg_temp.check('04 every add logged with source (web / unknown)',
  (SELECT array_agg(source ORDER BY manual_id) FROM public.manual_library_events WHERE kind = 'add' AND organization_id = 7001) = ARRAY['web','unknown']);
DO $$ BEGIN
  BEGIN
    INSERT INTO public.organization_manuals (organization_id, manual_id, source) VALUES (7001, 3, 'hacker');
    PERFORM pg_temp.check('05 source check constraint', false);
  EXCEPTION WHEN check_violation THEN PERFORM pg_temp.check('05 source check constraint', true);
  END;
END $$;

-- ================= fresh remove refunds =================
SELECT pg_temp.as_user(:alice);
SET ROLE authenticated;
CREATE TEMP TABLE r1 AS SELECT public.manual_library_remove(1, 'web') j;
RESET ROLE;
SELECT pg_temp.check('06 remove within 24h, untouched: refunded',
  (SELECT (j->>'removed')::bool AND (j->>'refunded')::bool AND j->>'reason' = 'refund' AND (j->>'slots_held')::int = 0 FROM r1)
  AND NOT EXISTS (SELECT 1 FROM public.organization_manuals WHERE organization_id = 7001 AND manual_id = 1)
  AND (SELECT count(*) FROM public.manual_library_events WHERE kind = 'remove' AND manual_id = 1) = 1,
  (SELECT j::text FROM r1));

-- ================= legacy (pre-000936) row: window from created_at =================
SELECT pg_temp.as_user(:alice);
SET ROLE authenticated;
CREATE TEMP TABLE r2 AS SELECT public.manual_library_status(40) j;
RESET ROLE;
SELECT pg_temp.check('07 pre-000936 row (2h old) is refund-eligible via created_at',
  (SELECT (j->>'owned')::bool AND (j->>'refund_eligible')::bool FROM r2), (SELECT j::text FROM r2));

-- ================= 24h window =================
INSERT INTO public.organization_manuals (organization_id, manual_id, source, created_at) VALUES (7001, 5, 'web', now() - interval '25 hours');
SELECT pg_temp.as_user(:alice);
SET ROLE authenticated;
CREATE TEMP TABLE r3 AS SELECT public.manual_library_remove(5, 'web') j;
RESET ROLE;
SELECT pg_temp.check('08 after 24h: removed, not refunded, slot held',
  (SELECT (j->>'removed')::bool AND NOT (j->>'refunded')::bool AND j->>'reason' = 'window_expired' AND (j->>'slots_held')::int = 1 FROM r3),
  (SELECT j::text FROM r3));
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT pg_temp.check('09a manual_slot_is_held: held after the non-refunded removal', public.manual_slot_is_held(7001, 5) AND NOT public.manual_slot_is_held(7001, 6));
INSERT INTO public.organization_manuals (organization_id, manual_id, source) VALUES (7001, 5, 'web');
SELECT pg_temp.check('09 re-adding the held manual releases the held slot', public.manual_slots_held(7001) = 0 AND NOT public.manual_slot_is_held(7001, 5));
SELECT pg_temp.as_user(:alice);
SET ROLE authenticated;
CREATE TEMP TABLE r3b AS SELECT public.manual_library_status(5) s, public.manual_library_remove(5) j;
RESET ROLE;
SELECT pg_temp.check('09b re-add then remove within 24h: still_held, no refund, no cap use, hold back',
  (SELECT s->>'reason' = 'still_held' AND NOT (s->>'refund_eligible')::bool
          AND j->>'reason' = 'still_held' AND NOT (j->>'refunded')::bool
          AND (j->>'refunds_used')::int = 1 AND (j->>'slots_held')::int = 1 FROM r3b),
  (SELECT j::text FROM r3b));
INSERT INTO public.organization_manuals (organization_id, manual_id, source) VALUES (7001, 14, 'web');
DELETE FROM public.organization_manuals WHERE organization_id = 7001 AND manual_id = 14;  -- direct delete
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT pg_temp.check('10 direct DELETE logged as non-refunded removal (holds slot)',
  (SELECT reason = 'direct_delete' AND refunded IS FALSE AND source = 'db' FROM public.manual_library_events WHERE kind = 'remove' AND manual_id = 14 ORDER BY id DESC LIMIT 1)
  AND public.manual_slots_held(7001) = 2);

-- ================= download / print =================
INSERT INTO public.organization_manuals (organization_id, manual_id, source) VALUES (7001, 6, 'web'), (7001, 7, 'web');
SELECT pg_temp.as_user(:alice);
SET ROLE authenticated;
SELECT public.manual_record_access(6, 'download');
SELECT public.manual_record_access(7, 'print');
CREATE TEMP TABLE r4 AS SELECT public.manual_library_remove(6) a, public.manual_library_remove(7) b;
RESET ROLE;
SELECT pg_temp.check('11 download / print block the refund',
  (SELECT a->>'reason' = 'downloaded' AND NOT (a->>'refunded')::bool AND b->>'reason' = 'printed' AND NOT (b->>'refunded')::bool FROM r4),
  (SELECT a::text || b::text FROM r4));

-- ================= heavy reading =================
INSERT INTO public.organization_manuals (organization_id, manual_id, source) VALUES (7001, 8, 'web'), (7001, 9, 'web'), (7001, 10, 'web'), (7001, 11, 'web');
SELECT pg_temp.as_user(:alice);
SET ROLE authenticated;
-- 8: 20 distinct pages of a 300-page manual (sent twice: duplicates ignored)
SELECT public.manual_record_access(8, 'page_view', (SELECT array_agg(g) FROM generate_series(1, 20) g), 300);
SELECT public.manual_record_access(8, 'page_view', ARRAY[1,2,3,20], 300);
-- 9: 21 distinct pages
SELECT public.manual_record_access(9, 'page_view', (SELECT array_agg(g) FROM generate_series(1, 21) g), 300);
-- 10: 6 of a 10-page manual (server count); the client claims 100000 pages: ignored
SELECT public.manual_record_access(10, 'page_view', ARRAY[1,2,3,4,5,6], 100000);
-- 11: 5 of a 10-page manual (half, not most); client claims 6 pages: ignored
SELECT public.manual_record_access(11, 'page_view', ARRAY[1,2,3,4,5], 6);
CREATE TEMP TABLE r5 AS SELECT public.manual_library_status(8) s8, public.manual_library_status(9) s9,
                                public.manual_library_status(10) s10, public.manual_library_status(11) s11;
RESET ROLE;
SELECT pg_temp.check('12 paging is fine: 20 distinct pages still refundable (dupes not counted)',
  (SELECT (s8->>'refund_eligible')::bool AND (s8->>'pages_viewed')::int = 20 FROM r5), (SELECT s8::text FROM r5));
SELECT pg_temp.check('13 heavy reading: >20 pages, or most of a short manual (server page count, client value ignored), blocks; half does not',
  (SELECT s9->>'reason' = 'heavy_reading' AND s10->>'reason' = 'heavy_reading' AND (s10->>'page_count')::int = 10
          AND (s11->>'refund_eligible')::bool AND (s11->>'page_count')::int = 10 AND s8->>'page_count' IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.manual_library_events WHERE page_count IS NOT NULL) FROM r5),
  (SELECT s9::text || s10::text || s11::text FROM r5));

-- ================= signed-URL proxy =================
INSERT INTO public.organization_manuals (organization_id, manual_id, source) VALUES (7001, 12, 'web');
SELECT pg_temp.as_user(:alice);
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.manual_record_url_issued(7001, 12, auth.uid(), 'edge');
    PERFORM pg_temp.check('14 authenticated cannot write url_issued', false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check('14 authenticated cannot write url_issued', true);
  END;
END $$;
RESET ROLE;
SET ROLE service_role;
SELECT public.manual_record_url_issued(7001, 12, 'a0000000-0000-0000-0000-00000000000a', 'edge') FROM generate_series(1, 15);
RESET ROLE;
SELECT pg_temp.as_user(:alice);
SET ROLE authenticated;
CREATE TEMP TABLE r6a AS SELECT public.manual_library_status(12) j;
RESET ROLE;
SET ROLE service_role;
SELECT public.manual_record_url_issued(7001, 12, 'a0000000-0000-0000-0000-00000000000a', 'edge');
RESET ROLE;
SELECT pg_temp.as_user(:alice);
SET ROLE authenticated;
CREATE TEMP TABLE r6b AS SELECT public.manual_library_status(12) j;
RESET ROLE;
SELECT pg_temp.check('15 15 signed URLs ok, 16th = heavy (server-side proxy)',
  (SELECT (j->>'refund_eligible')::bool FROM r6a) AND (SELECT j->>'reason' = 'many_fetches' FROM r6b),
  (SELECT j::text FROM r6b));

-- ================= isolation =================
SELECT pg_temp.as_user(:bob);
SET ROLE authenticated;
CREATE TEMP TABLE r7 AS SELECT public.manual_library_remove(40) j, public.manual_record_access(40, 'download') n,
                               public.manual_library_status(40) s;
RESET ROLE;
SELECT pg_temp.check('16 other org cannot remove / mark / see org A''s manual',
  (SELECT j->>'reason' = 'not_in_library' AND n = 0 AND NOT (s->>'owned')::bool FROM r7)
  AND EXISTS (SELECT 1 FROM public.organization_manuals WHERE organization_id = 7001 AND manual_id = 40),
  (SELECT j::text || s::text FROM r7));
SELECT pg_temp.as_user(:carl);
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.manual_library_remove(40);
    PERFORM pg_temp.check('17 profile org without membership is refused (42501)', false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check('17 profile org without membership is refused (42501)', true);
  END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);
SET ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.manual_library_remove(40);
    PERFORM pg_temp.check('18 anon cannot call remove', false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check('18 anon cannot call remove', true);
  END;
END $$;
RESET ROLE;

-- ================= outside window: reads not recorded =================
INSERT INTO public.organization_manuals (organization_id, manual_id, source, created_at) VALUES (7001, 13, 'web', now() - interval '30 hours');
SELECT pg_temp.as_user(:alice);
SET ROLE authenticated;
CREATE TEMP TABLE r8 AS SELECT public.manual_record_access(13, 'page_view', ARRAY[1,2,3], 50) n;
RESET ROLE;
SELECT pg_temp.check('19 reads after the 24h window are not stored',
  (SELECT n = 0 FROM r8) AND NOT EXISTS (SELECT 1 FROM public.manual_library_events WHERE manual_id = 13 AND kind = 'page_view'));

-- ================= monthly cap =================
-- org A used 1 refund (manual 1). Add 2 more refunds, then the 4th is capped.
INSERT INTO public.organization_manuals (organization_id, manual_id, source) VALUES (7001, 20, 'web'), (7001, 21, 'web'), (7001, 22, 'web');
SELECT pg_temp.as_user(:alice);
SET ROLE authenticated;
CREATE TEMP TABLE r9 AS SELECT public.manual_library_remove(20) a;
INSERT INTO r9 SELECT public.manual_library_remove(21);
INSERT INTO r9 SELECT public.manual_library_remove(22);
RESET ROLE;
SELECT pg_temp.check('20 monthly cap: refunds 2 and 3 pass, 4th removes without refund',
  (SELECT array_agg((a->>'refunded') || ':' || (a->>'reason')) FROM r9) = ARRAY['true:refund','true:refund','false:monthly_cap']
  AND EXISTS (SELECT 1 FROM r9 WHERE a->>'reason' = 'monthly_cap' AND (a->>'refunds_used')::int = 3),
  (SELECT string_agg(a::text, ' ') FROM r9));
-- last month's refunds do not count
UPDATE public.manual_library_events SET created_at = date_trunc('month', now()) - interval '1 day'
 WHERE organization_id = 7001 AND kind = 'remove' AND reason = 'refund';
INSERT INTO public.organization_manuals (organization_id, manual_id, source) VALUES (7001, 23, 'web');
SELECT pg_temp.as_user(:alice);
SET ROLE authenticated;
CREATE TEMP TABLE r10 AS SELECT public.manual_library_remove(23) a;
RESET ROLE;
SELECT pg_temp.check('21 cap resets with the calendar month', (SELECT (a->>'refunded')::bool FROM r10), (SELECT a::text FROM r10));

-- ================= catalog removal =================
INSERT INTO public.organization_manuals (organization_id, manual_id, source) VALUES (7002, 30, 'web');
DELETE FROM public.manuals WHERE id = 30;
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT pg_temp.check('22 catalog delete cascade logged as refunded (no held slot)',
  (SELECT reason = 'catalog_removed' AND refunded FROM public.manual_library_events WHERE manual_id = 30 AND kind = 'remove')
  AND public.manual_slots_held(7002) = 0);

-- ================= concurrency: double remove =================
INSERT INTO public.organization_manuals (organization_id, manual_id, source) VALUES (7002, 31, 'web');
SELECT pg_temp.as_user(:bob);
SET ROLE authenticated;
CREATE TEMP TABLE r11 AS SELECT public.manual_library_remove(31) a;
INSERT INTO r11 SELECT public.manual_library_remove(31);
RESET ROLE;
SELECT pg_temp.check('23 second Undo click is a no-op (not_in_library), one remove event',
  (SELECT array_agg(a->>'reason') FROM r11) = ARRAY['refund','not_in_library']
  AND (SELECT count(*) FROM public.manual_library_events WHERE manual_id = 31 AND kind = 'remove') = 1);

-- ================= drift guards =================
COMMENT ON FUNCTION public.manual_slots_held(bigint) IS 'someone else';
\set ON_ERROR_STOP off
\echo 'expected ERROR (drift guard) x2:'
\i :rb
ROLLBACK;
SELECT pg_temp.check('24 rollback refuses a foreign function (nothing dropped)',
  to_regclass('public.manual_library_events') IS NOT NULL
  AND to_regprocedure('public.manual_library_remove(bigint,text)') IS NOT NULL);
\i :mig
ROLLBACK;
SELECT pg_temp.check('25 apply refuses a foreign function',
  obj_description('public.manual_slots_held(bigint)'::regprocedure, 'pg_proc') = 'someone else');
\set ON_ERROR_STOP on
COMMENT ON FUNCTION public.manual_slots_held(bigint) IS '000936 slots held by non-refunded removals this month';

-- ACL drift guard: an unexpected grant makes apply refuse
GRANT TRIGGER ON public.organization_manuals TO authenticated;
\set ON_ERROR_STOP off
\echo 'expected ERROR (ACL drift guard):'
\i :mig
ROLLBACK;
\set ON_ERROR_STOP on
SELECT pg_temp.check('25b apply refuses an unexpected organization_manuals ACL',
  has_table_privilege('authenticated', 'public.organization_manuals', 'TRIGGER'));
REVOKE TRIGGER ON public.organization_manuals FROM authenticated;

-- ================= rollback (twice), exact =================
DELETE FROM public.organization_manuals WHERE manual_id <> 40;
\i :rb
\i :rb
SELECT pg_temp.check('26 rollback x2 restores the exact pre-000936 schema/ACLs/policies/functions',
  pg_temp.snap() = (SELECT s FROM before_snap),
  (SELECT string_agg(l, E'\n') FROM (SELECT unnest(string_to_array(pg_temp.snap(), E'\n')) EXCEPT SELECT unnest(string_to_array(s, E'\n')) FROM before_snap) d(l)));
\i :mig
SELECT pg_temp.check('27 re-apply after rollback', to_regclass('public.manual_library_events') IS NOT NULL);

SELECT n, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name, CASE WHEN ok THEN '' ELSE detail END AS detail FROM pg_temp.results ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS pass, count(*) FILTER (WHERE NOT ok) AS fail FROM pg_temp.results;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_temp.results WHERE NOT ok) THEN RAISE EXCEPTION 'proof FAILED'; END IF;
END $$;
