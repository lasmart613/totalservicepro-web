-- Local proof for 20261025_000945_service_report_type_templates.sql (+ rollback).
-- Scratch database only: the migration has its own BEGIN/COMMIT, so run it in
-- a throwaway DB and drop it afterwards. Refuses to run when sr_templates
-- already exists. From the repo root:
--
--   createdb sr_proof
--   psql "postgresql:///sr_proof" -v ON_ERROR_STOP=1 \
--     -f web/supabase/tests/20261025_service_report_type_templates.sql
--   dropdb sr_proof
--
-- Stubs: Supabase roles, organizations, service_reports,
-- get_my_org_id() (reads app.org_id) and can_view_service_report_for_history.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regclass('public.sr_templates') IS NOT NULL OR to_regclass('public.organizations') IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to run: not a scratch database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.organizations (id bigint PRIMARY KEY);
INSERT INTO public.organizations VALUES (11), (22);
CREATE TABLE public.service_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint,
  equipment_type text,
  checklist_electrical jsonb
);
CREATE FUNCTION public.get_my_org_id() RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT nullif(current_setting('app.org_id', true), '')::bigint $$;
CREATE FUNCTION public.can_view_service_report_for_history(r public.service_reports) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT r.organization_id = public.get_my_org_id() $$;
GRANT EXECUTE ON FUNCTION public.get_my_org_id(), public.can_view_service_report_for_history(public.service_reports)
  TO authenticated, anon;

\i web/supabase/migrations/20260914_000002_service_report_elements.sql

-- Replicate prod grants (Supabase default ACL), read Oct 25.
GRANT SELECT ON public.sr_elements, public.sr_templates, public.sr_template_elements, public.service_report_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sr_elements, public.sr_templates, public.sr_template_elements, public.service_report_items TO authenticated;
GRANT ALL ON public.sr_elements, public.sr_templates, public.sr_template_elements, public.service_report_items, public.service_reports TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.service_reports TO authenticated;

CREATE TEMP TABLE before_laser AS
SELECT e.slug, e.label, e.section, te.sort_order
FROM public.sr_template_elements te
JOIN public.sr_templates t ON t.id = te.template_id
JOIN public.sr_elements e ON e.id = te.element_id
WHERE t.slug = 'laser-pm-default';
CREATE FUNCTION pg_temp.sr_defs() RETURNS TABLE (k text, d text) LANGUAGE sql AS $f$
SELECT 'con:' || conname::text, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid IN ('public.sr_elements'::regclass, 'public.service_report_items'::regclass, 'public.sr_templates'::regclass)
UNION ALL SELECT 'idx:' || indexname::text, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename LIKE 'sr\_%'
UNION ALL SELECT 'pol:' || tablename || '.' || policyname, cmd || coalesce(qual, '') || coalesce(with_check, '') FROM pg_policies WHERE schemaname = 'public'
UNION ALL SELECT 'grant:' || table_name || ':' || grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
  FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated', 'service_role')
  GROUP BY table_name, grantee
UNION ALL SELECT 'col:' || table_name || '.' || column_name, data_type FROM information_schema.columns WHERE table_schema = 'public'
UNION ALL SELECT 'fn:' || p.oid::regprocedure::text, coalesce(array_to_string(p.proacl, ','), '') FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
UNION ALL SELECT 'trg:' || tgname::text, pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal
  AND tgrelid = 'public.service_report_items'::regclass
$f$;
CREATE TEMP TABLE before_defs AS SELECT * FROM pg_temp.sr_defs();

INSERT INTO public.service_reports (id, organization_id, equipment_type) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 11, 'laser');
INSERT INTO public.service_report_items (service_report_id, organization_id, section, label, result, sort_order)
VALUES ('00000000-0000-0000-0000-0000000000a1', 11, 'electrical', 'Display', 'pass', 1);

\i web/supabase/migrations/20261025_000945_service_report_type_templates.sql

-- Re-running must hit a drift guard.
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE public.sr_templates ADD COLUMN manufacturer text';
    RAISE EXCEPTION 'expected duplicate column';
  EXCEPTION WHEN duplicate_column THEN NULL;
  END;
END $$;

DO $$
BEGIN
  IF EXISTS (
    (SELECT slug, label, section, sort_order FROM before_laser
     EXCEPT SELECT e.slug, e.label, e.section, te.sort_order FROM public.sr_template_elements te
       JOIN public.sr_templates t ON t.id = te.template_id JOIN public.sr_elements e ON e.id = te.element_id
       WHERE t.slug = 'laser-pm-default')
    UNION ALL
    (SELECT e.slug, e.label, e.section, te.sort_order FROM public.sr_template_elements te
       JOIN public.sr_templates t ON t.id = te.template_id JOIN public.sr_elements e ON e.id = te.element_id
       WHERE t.slug = 'laser-pm-default'
     EXCEPT SELECT slug, label, section, sort_order FROM before_laser)
  ) THEN
    RAISE EXCEPTION 'laser template changed';
  END IF;
  IF (SELECT count(*) FROM before_laser) <> 24 THEN RAISE EXCEPTION 'expected 24 laser links (prod Oct 25)'; END IF;
  IF (SELECT string_agg(label, '|' ORDER BY sort_order) FROM public.sr_template_sections s
       JOIN public.sr_templates t ON t.id = s.template_id WHERE t.slug = 'laser-pm-default')
     IS DISTINCT FROM 'Electrical Checklist|Mechanical & Optical|Aesthetic Condition|Electrical Safety' THEN
    RAISE EXCEPTION 'laser sections wrong';
  END IF;
  IF (SELECT count(*) FROM public.sr_templates WHERE editable_default AND is_default AND status = 'published') <> 12 THEN
    RAISE EXCEPTION 'expected 12 starters';
  END IF;
  IF (SELECT string_agg(s.section_key, ',' ORDER BY s.sort_order) FROM public.sr_template_sections s
       JOIN public.sr_templates t ON t.id = s.template_id WHERE t.slug = 'beds-pm-default')
     IS DISTINCT FROM 'electrical,motion,mechanical,aesthetic,safety' THEN
    RAISE EXCEPTION 'beds sections wrong';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sr_template_elements te JOIN public.sr_templates t ON t.id = te.template_id
              JOIN public.sr_elements e ON e.id = te.element_id
              WHERE t.slug = 'beds-pm-default' AND e.slug IN ('optics', 'coolant', 'aiming-beam', 'filters')) THEN
    RAISE EXCEPTION 'beds template carries laser items';
  END IF;
END $$;

-- New section keys accepted, junk rejected.
INSERT INTO public.service_report_items (service_report_id, organization_id, section, section_label, label, result, sort_order)
VALUES ('00000000-0000-0000-0000-0000000000a1', 11, 'custom_hydraulics', 'Hydraulics', 'Pump', 'pass', 2);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.service_report_items (service_report_id, section, label) VALUES
      ('00000000-0000-0000-0000-0000000000a1', 'Bad Key!', 'x');
    RAISE EXCEPTION 'bad section key accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.service_reports SET checklist_sections = '{"a":1}' WHERE id = '00000000-0000-0000-0000-0000000000a1';
    RAISE EXCEPTION 'non-array checklist_sections accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- Org template for 22 plus a manufacturer-specific default.
INSERT INTO public.sr_templates (slug, name, equipment_type, status, is_default, organization_id, manufacturer)
VALUES ('org22-beds', 'Org 22 Beds', 'beds', 'published', true, 22, 'Hill-Rom');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.sr_templates (slug, name, equipment_type, status, is_default, organization_id, manufacturer)
    VALUES ('org22-beds-dup', 'Dup', 'beds', 'published', true, 22, 'HILL-ROM');
    RAISE EXCEPTION 'duplicate scoped default accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- RLS as authenticated.
SET ROLE authenticated;
SELECT set_config('app.org_id', '11', false);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sr_templates WHERE slug = 'org22-beds') THEN RAISE EXCEPTION 'org 11 sees org 22 template'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sr_templates WHERE slug = 'beds-pm-default') THEN RAISE EXCEPTION 'platform starter hidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sr_template_sections) THEN RAISE EXCEPTION 'sections hidden'; END IF;
  IF EXISTS (SELECT 1 FROM public.sr_template_sections s JOIN public.sr_templates t ON t.id = s.template_id WHERE t.organization_id = 22)
    THEN RAISE EXCEPTION 'org 22 sections leaked'; END IF;
  BEGIN
    INSERT INTO public.sr_templates (slug, name, equipment_type) VALUES ('x', 'x', 'beds');
    RAISE EXCEPTION 'authenticated can write sr_templates';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.sr_template_sections (template_id, section_key, label)
      SELECT id, 'zzz', 'z' FROM public.sr_templates LIMIT 1;
    RAISE EXCEPTION 'authenticated can write sr_template_sections';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('app.org_id', '22', false);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sr_templates WHERE slug = 'org22-beds') THEN RAISE EXCEPTION 'org 22 cannot see own template'; END IF;
END $$;
RESET ROLE;
SET ROLE anon;
DO $$
BEGIN
  PERFORM 1 FROM public.sr_templates;
  RAISE EXCEPTION 'anon can read sr_templates';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

-- Safety rows are kept and the item save is atomic (QA F1).
INSERT INTO public.service_reports (id, organization_id, equipment_type) VALUES
  ('00000000-0000-0000-0000-0000000000a2', 11, 'beds'),
  ('00000000-0000-0000-0000-0000000000b2', 22, 'beds');
INSERT INTO public.service_report_items (service_report_id, organization_id, element_id, section, label, value_numeric, sort_order)
SELECT '00000000-0000-0000-0000-0000000000a2', 11, e.id, 'safety', e.label, 0.1, 900 + row_number() OVER (ORDER BY e.slug)
FROM public.sr_elements e WHERE e.slug IN ('ground-resistance', 'leakage-current');
INSERT INTO public.service_report_items (service_report_id, organization_id, section, label, result, sort_order)
VALUES ('00000000-0000-0000-0000-0000000000a2', 11, 'motion', 'Bed raises and lowers', 'pass', 10);
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.replace_service_report_items(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute replace_service_report_items';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.replace_service_report_items(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute replace_service_report_items';
  END IF;
  IF (SELECT prosecdef AND proconfig = ARRAY['search_path=""']::text[] FROM pg_proc
       WHERE oid = 'public.replace_service_report_items(uuid, jsonb)'::regprocedure) IS NOT TRUE
     OR (SELECT prosecdef AND proconfig = ARRAY['search_path=""']::text[] FROM pg_proc
       WHERE oid = 'public.sr_items_keep_safety()'::regprocedure) IS NOT TRUE THEN
    RAISE EXCEPTION '000945 functions must be SECURITY DEFINER with search_path ''''';
  END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('app.org_id', '11', false);
DO $$
DECLARE n integer;
BEGIN
  -- Direct DELETE of a safety row is refused; the motion row deletes fine.
  BEGIN
    DELETE FROM public.service_report_items WHERE service_report_id = '00000000-0000-0000-0000-0000000000a2' AND section = 'safety';
    RAISE EXCEPTION 'safety row delete accepted';
  EXCEPTION WHEN SQLSTATE 'P0945' THEN NULL;
  END;
  BEGIN
    DELETE FROM public.service_report_items WHERE service_report_id = '00000000-0000-0000-0000-0000000000a2';
    RAISE EXCEPTION 'delete-all including safety accepted';
  EXCEPTION WHEN SQLSTATE 'P0945' THEN NULL;
  END;
  BEGIN
    UPDATE public.service_report_items SET section = 'motion'
    WHERE service_report_id = '00000000-0000-0000-0000-0000000000a2' AND section = 'safety';
    RAISE EXCEPTION 'safety row moved out of safety';
  EXCEPTION WHEN SQLSTATE 'P0945' THEN NULL;
  END;
  IF (SELECT count(*) FROM public.service_report_items WHERE service_report_id = '00000000-0000-0000-0000-0000000000a2') <> 3 THEN
    RAISE EXCEPTION 'refused deletes still removed rows';
  END IF;

  -- RPC: payload without safety keeps safety, replaces the rest.
  n := public.replace_service_report_items('00000000-0000-0000-0000-0000000000a2',
    '[{"section":"motion","label":"Bed raises and lowers","result":"fail","sort_order":10},
      {"section":"custom_lift","section_label":"Lift","label":"Hydraulic seal","result":"pass","is_extra":true}]');
  IF n <> 4 THEN RAISE EXCEPTION 'rpc count % (expected 4)', n; END IF;
  IF (SELECT count(*) FROM public.service_report_items WHERE service_report_id = '00000000-0000-0000-0000-0000000000a2' AND section = 'safety') <> 2 THEN
    RAISE EXCEPTION 'rpc dropped safety rows';
  END IF;
  IF (SELECT result FROM public.service_report_items WHERE service_report_id = '00000000-0000-0000-0000-0000000000a2' AND section = 'motion') <> 'fail' THEN
    RAISE EXCEPTION 'rpc did not replace motion row';
  END IF;

  -- RPC: safety values update in place, no duplicates.
  n := public.replace_service_report_items('00000000-0000-0000-0000-0000000000a2',
    '[{"section":"motion","label":"Bed raises and lowers","result":"pass"},
      {"section":"safety","label":"Ground Resistance","value_numeric":0.15,"unit":"Ω"}]');
  IF n <> 3 THEN RAISE EXCEPTION 'rpc safety upsert count % (expected 3)', n; END IF;
  IF (SELECT value_numeric FROM public.service_report_items WHERE service_report_id = '00000000-0000-0000-0000-0000000000a2' AND label = 'Ground Resistance') <> 0.15 THEN
    RAISE EXCEPTION 'rpc did not update ground resistance';
  END IF;

  -- RPC: a bad row fails the whole call and nothing is lost (atomic).
  BEGIN
    PERFORM public.replace_service_report_items('00000000-0000-0000-0000-0000000000a2',
      '[{"section":"motion","label":"ok"},{"section":"Bad Key!","label":"x"}]');
    RAISE EXCEPTION 'rpc accepted a bad section';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM public.service_report_items WHERE service_report_id = '00000000-0000-0000-0000-0000000000a2') <> 3
     OR NOT EXISTS (SELECT 1 FROM public.service_report_items WHERE service_report_id = '00000000-0000-0000-0000-0000000000a2'
                     AND label = 'Bed raises and lowers' AND result = 'pass') THEN
    RAISE EXCEPTION 'failed rpc lost items';
  END IF;
  BEGIN
    PERFORM public.replace_service_report_items('00000000-0000-0000-0000-0000000000a2', '{"a":1}');
    RAISE EXCEPTION 'rpc accepted non-array';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- RPC: another org's report is refused.
  BEGIN
    PERFORM public.replace_service_report_items('00000000-0000-0000-0000-0000000000b2', '[]');
    RAISE EXCEPTION 'rpc wrote another org report';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('app.org_id', '', false);
DO $$
BEGIN
  PERFORM public.replace_service_report_items('00000000-0000-0000-0000-0000000000a2', '[]');
  RAISE EXCEPTION 'rpc ran without an org';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
SET ROLE anon;
DO $$
BEGIN
  PERFORM public.replace_service_report_items('00000000-0000-0000-0000-0000000000a2', '[]');
  RAISE EXCEPTION 'anon ran rpc';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
-- Deleting the report still cascades its safety rows.
DELETE FROM public.service_reports WHERE id IN ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b2');
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.service_report_items WHERE service_report_id = '00000000-0000-0000-0000-0000000000a2') THEN
    RAISE EXCEPTION 'report delete did not cascade items';
  END IF;
END $$;

-- Rollback refuses while new-shape data exists.
DO $$ BEGIN RAISE NOTICE 'expect rollback refusal next'; END $$;
\set ON_ERROR_STOP off
\i web/supabase/migrations/20261025_000945_service_report_type_templates_rollback.sql
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF to_regclass('public.sr_template_sections') IS NULL THEN RAISE EXCEPTION 'refused rollback still dropped objects'; END IF;
END $$;

DELETE FROM public.service_report_items WHERE section = 'custom_hydraulics';
DELETE FROM public.sr_templates WHERE slug = 'org22-beds';

\i web/supabase/migrations/20261025_000945_service_report_type_templates_rollback.sql

DO $$
DECLARE diff text;
BEGIN
  SELECT string_agg(k, ', ') INTO diff FROM (
    (SELECT k, d FROM before_defs EXCEPT SELECT k, d FROM pg_temp.sr_defs())
    UNION ALL
    (SELECT k, d FROM pg_temp.sr_defs() EXCEPT SELECT k, d FROM before_defs)
  ) x;
  IF diff IS NOT NULL THEN
    RAISE EXCEPTION 'rollback did not restore: %', diff;
  END IF;
  IF (SELECT count(*) FROM public.sr_templates) <> 1 OR (SELECT count(*) FROM public.sr_elements) <> 27 THEN
    RAISE EXCEPTION 'rollback left seed rows';
  END IF;
  IF (SELECT count(*) FROM public.service_report_items) <> 1 THEN RAISE EXCEPTION 'rollback lost report items'; END IF;
END $$;

-- Re-apply after rollback works (idempotent cycle).
\i web/supabase/migrations/20261025_000945_service_report_type_templates.sql

DO $$ BEGIN RAISE NOTICE '000945 proof: OK'; END $$;
