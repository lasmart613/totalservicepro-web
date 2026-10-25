-- 000945: Service Report templates per equipment type (modular sections).
--
-- Why: a bed / exam table report showed every laser line item. The web form
-- fell back to laser-pm-default for any type with no template, and the
-- section CHECKs only allow electrical / mechanical / aesthetic / safety, so
-- a non-laser checklist could not have its own sections.
--
-- What changes:
--   * Section keys: sr_elements.section and service_report_items.section now
--     accept any key matching ^[a-z][a-z0-9_]{1,39}$ (template sections like
--     'motion' or 'sterilization', and per-report 'custom_<slug>'). The four
--     legacy keys still match.
--   * sr_templates gets manufacturer, model, organization_id (NULL = platform
--     template) and editable_default. One published default per
--     (org, type, manufacturer, model) replaces one per type. The web form
--     resolves type -> manufacturer -> model, most specific wins.
--   * NEW sr_template_sections (template_id, section_key, label, sort_order).
--   * sr_elements.equipment_type (NULL = shared) scopes the "add from library"
--     list so bed items do not show on a laser report and vice versa.
--   * service_report_items.section_label (custom section title) and
--     service_reports.checklist_sections (jsonb array, NULL on laser reports
--     so their print / email / view render exactly as before).
--   * RLS: sr_templates_select and sr_template_elements_select also require
--     organization_id IS NULL OR = public.get_my_org_id(). New
--     sr_template_sections_select follows the template.
--   * Grants: the catalog tables are read-only for clients. anon loses SELECT
--     (no anon policy existed, so it already saw nothing) and authenticated
--     loses INSERT / UPDATE / DELETE (no write policy existed). service_role
--     unchanged. service_report_items grants are not touched.
--   * Seed: laser-pm-default keeps its 24 linked elements unchanged and gets its four
--     sections with today's titles. Starter templates (editable_default =
--     true) for beds, sterile_processing (autoclaves), defibrillator,
--     infusion_pump, patient_monitor, ventilator, anesthesia, c_arm,
--     ultrasound, endoscope, lithotriptor and a 'general' fallback. Rows come
--     from web/lib/service-report-templates.ts (starterSeedValues); the unit
--     test fails if they differ.
--
--   * Safety rows: trigger sr_items_keep_safety blocks DELETE (and moving
--     out of section 'safety') of the ground resistance / leakage current
--     rows on service_report_items, for every role. Deleting the parent
--     service report still cascades.
--   * Atomic save: NEW public.replace_service_report_items(report, items)
--     (SECURITY DEFINER, search_path '', checks the report's org =
--     get_my_org_id()) replaces the non-safety rows and upserts the safety
--     rows in one transaction, so a failed insert cannot lose items.
--     EXECUTE: authenticated + service_role only.
--
-- Deploy order: ship the web (which detects 000945 and uses the RPC) BEFORE
-- applying this migration. The pre-PR web deletes all items, safety rows
-- included, and that DELETE is refused once the trigger exists.
--
-- Policies call the existing public.get_my_org_id() (SECURITY DEFINER,
-- bigint) as the 000002 policies do.
--
-- Drift guards: 000002 objects exist with the exact CHECK, index and policy
-- definitions read from prod on Oct 25 (SELECT-only); new columns, table and
-- starter slugs are absent; shared element slugs carry their 000002 labels.
-- Bookkeeping: after applying, record version 20261025_000945 in
-- supabase_migrations.schema_migrations (name service_report_type_templates),
-- same as 000939. Deploy order: this migration first, then the web build.
-- Local proof: web/supabase/tests/20261025_service_report_type_templates.sql
-- (PG17). APPLY ON LIVE SUPABASE only after Larry's yes. Rollback:
-- 20261025_000945_service_report_type_templates_rollback.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  legacy_check constant text :=
    'CHECK ((section = ANY (ARRAY[''electrical''::text, ''mechanical''::text, ''aesthetic''::text, ''safety''::text])))';
BEGIN
  IF to_regclass('public.sr_elements') IS NULL
     OR to_regclass('public.sr_templates') IS NULL
     OR to_regclass('public.sr_template_elements') IS NULL
     OR to_regclass('public.service_report_items') IS NULL
     OR to_regclass('public.service_reports') IS NULL THEN
    RAISE EXCEPTION '000945 drift: 000002 tables are missing';
  END IF;
  IF to_regprocedure('public.get_my_org_id()') IS NULL THEN
    RAISE EXCEPTION '000945 drift: public.get_my_org_id() is missing';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'public.sr_elements'::regclass AND conname = 'sr_elements_section_check')
     IS DISTINCT FROM legacy_check THEN
    RAISE EXCEPTION '000945 drift: sr_elements_section_check is not the 000002 CHECK';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'public.service_report_items'::regclass AND conname = 'service_report_items_section_check')
     IS DISTINCT FROM legacy_check THEN
    RAISE EXCEPTION '000945 drift: service_report_items_section_check is not the 000002 CHECK';
  END IF;
  IF (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'sr_templates_one_default_per_type')
     IS DISTINCT FROM 'CREATE UNIQUE INDEX sr_templates_one_default_per_type ON public.sr_templates USING btree (equipment_type) WHERE (is_default AND (status = ''published''::text))' THEN
    RAISE EXCEPTION '000945 drift: sr_templates_one_default_per_type differs from 000002';
  END IF;
  IF (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sr_templates' AND policyname = 'sr_templates_select')
     IS DISTINCT FROM '(status = ''published''::text)' THEN
    RAISE EXCEPTION '000945 drift: sr_templates_select differs from 000002';
  END IF;
  IF (SELECT regexp_replace(qual, '\s+', ' ', 'g') FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'sr_template_elements' AND policyname = 'sr_template_elements_select')
     IS DISTINCT FROM '(EXISTS ( SELECT 1 FROM sr_templates t WHERE ((t.id = sr_template_elements.template_id) AND (t.status = ''published''::text))))' THEN
    RAISE EXCEPTION '000945 drift: sr_template_elements_select differs from 000002';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
              AND tablename IN ('sr_elements', 'sr_templates', 'sr_template_elements') AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION '000945 drift: a write policy exists on the SR catalog; refusing to revoke client writes';
  END IF;
  IF to_regclass('public.sr_template_sections') IS NOT NULL THEN
    RAISE EXCEPTION '000945 drift: sr_template_sections already exists; refusing';
  END IF;
  IF to_regprocedure('public.replace_service_report_items(uuid, jsonb)') IS NOT NULL
     OR to_regprocedure('public.sr_items_keep_safety()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.service_report_items'::regclass
                 AND tgname = 'sr_items_keep_safety') THEN
    RAISE EXCEPTION '000945 drift: service_report_items already has a trigger or the 000945 functions exist; refusing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND ((table_name = 'sr_templates' AND column_name IN ('manufacturer', 'model', 'organization_id', 'editable_default'))
        OR (table_name = 'sr_elements' AND column_name = 'equipment_type')
        OR (table_name = 'service_report_items' AND column_name = 'section_label')
        OR (table_name = 'service_reports' AND column_name = 'checklist_sections'))
  ) THEN
    RAISE EXCEPTION '000945 drift: a 000945 column already exists; refusing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sr_templates
                  WHERE slug = 'laser-pm-default' AND equipment_type = 'laser' AND status = 'published' AND is_default) THEN
    RAISE EXCEPTION '000945 drift: laser-pm-default is missing';
  END IF;
END $$;

CREATE TEMP TABLE sr_laser_before_000945 ON COMMIT DROP AS
SELECT te.element_id, te.sort_order
FROM public.sr_template_elements te
JOIN public.sr_templates t ON t.id = te.template_id
WHERE t.slug = 'laser-pm-default';

-- Seed rows (generated from web/lib/service-report-templates.ts starterSeedValues()).
CREATE TEMP TABLE sr_seed_000945 (
  template_slug text NOT NULL,
  template_name text NOT NULL,
  equipment_type text NOT NULL,
  section_key text NOT NULL,
  section_label text NOT NULL,
  section_order integer NOT NULL,
  element_slug text NOT NULL,
  element_label text NOT NULL,
  element_order integer NOT NULL,
  input_kind text NOT NULL,
  unit text,
  spec_hint text,
  element_equipment_type text
) ON COMMIT DROP;

INSERT INTO sr_seed_000945 VALUES
-- BEGIN STARTER SEED
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'electrical', 'Electrical & Controls', 10, 'power-cord-plug', 'Power Cord & Plug integrity', 10, 'pass_fail_na', NULL, NULL, NULL),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'electrical', 'Electrical & Controls', 10, 'beds-hand-pendant', 'Hand control / pendant & cord', 20, 'pass_fail_na', NULL, NULL, 'beds'),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'electrical', 'Electrical & Controls', 10, 'beds-foot-control', 'Foot control function', 30, 'pass_fail_na', NULL, NULL, 'beds'),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'electrical', 'Electrical & Controls', 10, 'beds-limit-switches', 'Limit switches stop travel at end points', 40, 'pass_fail_na', NULL, NULL, 'beds'),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'electrical', 'Electrical & Controls', 10, 'beds-battery', 'Battery backup charged & functional (if equipped)', 50, 'pass_fail_na', NULL, NULL, 'beds'),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'motion', 'Motion & Function', 20, 'beds-height-travel', 'Height (base up/down) travel smooth, full range', 10, 'pass_fail_na', NULL, NULL, 'beds'),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'motion', 'Motion & Function', 20, 'beds-back-tilt', 'Back / tilt articulation full range', 20, 'pass_fail_na', NULL, NULL, 'beds'),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'motion', 'Motion & Function', 20, 'beds-foot-section', 'Foot / leg section function', 30, 'pass_fail_na', NULL, NULL, 'beds'),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'motion', 'Motion & Function', 20, 'beds-trendelenburg', 'Trendelenburg / reverse (if equipped)', 40, 'pass_fail_na', NULL, NULL, 'beds'),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'motion', 'Motion & Function', 20, 'beds-no-drift', 'Holds position under load (no drift)', 50, 'pass_fail_na', NULL, NULL, 'beds'),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'motion', 'Motion & Function', 20, 'beds-cpr-release', 'CPR / emergency release (if equipped)', 60, 'pass_fail_na', NULL, NULL, 'beds'),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'motion', 'Motion & Function', 20, 'beds-brakes', 'Brakes / caster locks hold', 70, 'pass_fail_na', NULL, NULL, 'beds'),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'mechanical', 'Frame & Mechanical', 30, 'beds-hydraulics', 'Hydraulic fluid level, no leaks', 10, 'pass_fail_na', NULL, NULL, 'beds'),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'mechanical', 'Frame & Mechanical', 30, 'beds-actuators', 'Motors / actuators, no abnormal noise', 20, 'pass_fail_na', NULL, NULL, 'beds'),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'mechanical', 'Frame & Mechanical', 30, 'beds-frame-fasteners', 'Frame, welds & fasteners secure', 30, 'pass_fail_na', NULL, NULL, 'beds'),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'mechanical', 'Frame & Mechanical', 30, 'beds-lubrication', 'Pivot points lubricated', 40, 'pass_fail_na', NULL, NULL, 'beds'),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'mechanical', 'Frame & Mechanical', 30, 'beds-side-rails', 'Side rails / armrests latch securely', 50, 'pass_fail_na', NULL, NULL, 'beds'),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'mechanical', 'Frame & Mechanical', 30, 'wheels-castors', 'Wheels & Castors integrity', 60, 'pass_fail_na', NULL, NULL, NULL),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'aesthetic', 'Upholstery & Condition', 40, 'beds-upholstery', 'Upholstery free of tears / cracks', 10, 'pass_fail_na', NULL, NULL, 'beds'),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'aesthetic', 'Upholstery & Condition', 40, 'beds-accessories', 'Paper roll holder, drawers & stirrups', 20, 'pass_fail_na', NULL, NULL, 'beds'),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'aesthetic', 'Upholstery & Condition', 40, 'beds-covers-finish', 'Covers & finish condition', 30, 'pass_fail_na', NULL, NULL, 'beds'),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'aesthetic', 'Upholstery & Condition', 40, 'warning-labels', 'Warning labels present & legible', 40, 'pass_fail_na', NULL, NULL, NULL),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'safety', 'Electrical Safety', 50, 'ground-resistance', 'Ground Resistance', 10, 'numeric', 'Ω', 'spec ≤ 0.2Ω', NULL),
('beds-pm-default', 'Bed / Exam Table PM', 'beds', 'safety', 'Electrical Safety', 50, 'leakage-current', 'Leakage Current', 20, 'numeric', 'µA', 'spec ≤ 300µA', NULL),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'electrical', 'Electrical', 10, 'power-cord-plug', 'Power Cord & Plug integrity', 10, 'pass_fail_na', NULL, NULL, NULL),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'electrical', 'Electrical', 10, 'display', 'Display functioning properly', 20, 'pass_fail_na', NULL, NULL, NULL),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'electrical', 'Electrical', 10, 'faults-errors', 'Faults/Errors documented & cleared', 30, 'pass_fail_na', NULL, NULL, NULL),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'electrical', 'Electrical', 10, 'autoclave-heater', 'Heating element / heater current to spec', 40, 'pass_fail_na', NULL, NULL, 'sterile_processing'),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'sterilization', 'Cycle & Sterilization', 20, 'autoclave-test-cycle', 'Test cycle completed (temp / pressure / time logged)', 10, 'pass_fail_na', NULL, NULL, 'sterile_processing'),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'sterilization', 'Cycle & Sterilization', 20, 'autoclave-temp-cal', 'Temperature calibration verified', 20, 'pass_fail_na', NULL, NULL, 'sterile_processing'),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'sterilization', 'Cycle & Sterilization', 20, 'autoclave-pressure-cal', 'Pressure gauge / transducer verified', 30, 'pass_fail_na', NULL, NULL, 'sterile_processing'),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'sterilization', 'Cycle & Sterilization', 20, 'autoclave-bi-test', 'Bowie-Dick / BI test result (if applicable)', 40, 'pass_fail_na', NULL, NULL, 'sterile_processing'),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'sterilization', 'Cycle & Sterilization', 20, 'autoclave-drying', 'Drying cycle performs', 50, 'pass_fail_na', NULL, NULL, 'sterile_processing'),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'mechanical', 'Chamber & Mechanical', 30, 'autoclave-door-gasket', 'Door gasket inspected / replaced', 10, 'pass_fail_na', NULL, NULL, 'sterile_processing'),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'mechanical', 'Chamber & Mechanical', 30, 'autoclave-door-interlock', 'Door interlock / safety lock', 20, 'pass_fail_na', NULL, NULL, 'sterile_processing'),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'mechanical', 'Chamber & Mechanical', 30, 'autoclave-relief-valve', 'Pressure relief valve tested', 30, 'pass_fail_na', NULL, NULL, 'sterile_processing'),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'mechanical', 'Chamber & Mechanical', 30, 'autoclave-reservoir', 'Reservoir drained, cleaned & refilled (distilled)', 40, 'pass_fail_na', NULL, NULL, 'sterile_processing'),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'mechanical', 'Chamber & Mechanical', 30, 'autoclave-filters', 'Chamber & water filters cleaned', 50, 'pass_fail_na', NULL, NULL, 'sterile_processing'),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'mechanical', 'Chamber & Mechanical', 30, 'autoclave-plumbing', 'Plumbing / solenoids, no leaks', 60, 'pass_fail_na', NULL, NULL, 'sterile_processing'),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'mechanical', 'Chamber & Mechanical', 30, 'autoclave-trays', 'Trays & rack condition', 70, 'pass_fail_na', NULL, NULL, 'sterile_processing'),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'aesthetic', 'Condition', 40, 'control-panel', 'Control Panel condition', 10, 'pass_fail_na', NULL, NULL, NULL),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'aesthetic', 'Condition', 40, 'autoclave-cabinet', 'Cabinet & finish condition', 20, 'pass_fail_na', NULL, NULL, 'sterile_processing'),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'aesthetic', 'Condition', 40, 'warning-labels', 'Warning labels present & legible', 30, 'pass_fail_na', NULL, NULL, NULL),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'safety', 'Electrical Safety', 50, 'ground-resistance', 'Ground Resistance', 10, 'numeric', 'Ω', 'spec ≤ 0.2Ω', NULL),
('sterile-processing-pm-default', 'Autoclave / Sterilizer PM', 'sterile_processing', 'safety', 'Electrical Safety', 50, 'leakage-current', 'Leakage Current', 20, 'numeric', 'µA', 'spec ≤ 300µA', NULL),
('defibrillator-pm-default', 'Defibrillator / AED PM', 'defibrillator', 'electrical', 'Electrical', 10, 'power-cord-plug', 'Power Cord & Plug integrity', 10, 'pass_fail_na', NULL, NULL, NULL),
('defibrillator-pm-default', 'Defibrillator / AED PM', 'defibrillator', 'electrical', 'Electrical', 10, 'battery-backup', 'Battery charged & holds capacity', 20, 'pass_fail_na', NULL, NULL, NULL),
('defibrillator-pm-default', 'Defibrillator / AED PM', 'defibrillator', 'electrical', 'Electrical', 10, 'display', 'Display functioning properly', 30, 'pass_fail_na', NULL, NULL, NULL),
('defibrillator-pm-default', 'Defibrillator / AED PM', 'defibrillator', 'electrical', 'Electrical', 10, 'faults-errors', 'Faults/Errors documented & cleared', 40, 'pass_fail_na', NULL, NULL, NULL),
('defibrillator-pm-default', 'Defibrillator / AED PM', 'defibrillator', 'electrical', 'Electrical', 10, 'defib-self-test', 'Self-test passes', 50, 'pass_fail_na', NULL, NULL, 'defibrillator'),
('defibrillator-pm-default', 'Defibrillator / AED PM', 'defibrillator', 'energy', 'Energy & Function', 20, 'defib-energy', 'Delivered energy within spec at each setting', 10, 'pass_fail_na', NULL, NULL, 'defibrillator'),
('defibrillator-pm-default', 'Defibrillator / AED PM', 'defibrillator', 'energy', 'Energy & Function', 20, 'defib-charge-time', 'Charge time to max energy within spec', 20, 'pass_fail_na', NULL, NULL, 'defibrillator'),
('defibrillator-pm-default', 'Defibrillator / AED PM', 'defibrillator', 'energy', 'Energy & Function', 20, 'defib-sync', 'Synchronized cardioversion', 30, 'pass_fail_na', NULL, NULL, 'defibrillator'),
('defibrillator-pm-default', 'Defibrillator / AED PM', 'defibrillator', 'energy', 'Energy & Function', 20, 'defib-ecg', 'ECG monitoring / leads', 40, 'pass_fail_na', NULL, NULL, 'defibrillator'),
('defibrillator-pm-default', 'Defibrillator / AED PM', 'defibrillator', 'energy', 'Energy & Function', 20, 'defib-pacer', 'Pacer output (if equipped)', 50, 'pass_fail_na', NULL, NULL, 'defibrillator'),
('defibrillator-pm-default', 'Defibrillator / AED PM', 'defibrillator', 'energy', 'Energy & Function', 20, 'defib-recorder', 'Recorder / printer', 60, 'pass_fail_na', NULL, NULL, 'defibrillator'),
('defibrillator-pm-default', 'Defibrillator / AED PM', 'defibrillator', 'energy', 'Energy & Function', 20, 'defib-alarms', 'Alarms audible & visual', 70, 'pass_fail_na', NULL, NULL, 'defibrillator'),
('defibrillator-pm-default', 'Defibrillator / AED PM', 'defibrillator', 'aesthetic', 'Accessories & Condition', 30, 'defib-paddles-cables', 'Paddles / pads cable condition', 10, 'pass_fail_na', NULL, NULL, 'defibrillator'),
('defibrillator-pm-default', 'Defibrillator / AED PM', 'defibrillator', 'aesthetic', 'Accessories & Condition', 30, 'defib-pads-in-date', 'Pads & supplies in date', 20, 'pass_fail_na', NULL, NULL, 'defibrillator'),
('defibrillator-pm-default', 'Defibrillator / AED PM', 'defibrillator', 'aesthetic', 'Accessories & Condition', 30, 'control-panel', 'Control Panel condition', 30, 'pass_fail_na', NULL, NULL, NULL),
('defibrillator-pm-default', 'Defibrillator / AED PM', 'defibrillator', 'aesthetic', 'Accessories & Condition', 30, 'warning-labels', 'Warning labels present & legible', 40, 'pass_fail_na', NULL, NULL, NULL),
('defibrillator-pm-default', 'Defibrillator / AED PM', 'defibrillator', 'safety', 'Electrical Safety', 40, 'ground-resistance', 'Ground Resistance', 10, 'numeric', 'Ω', 'spec ≤ 0.2Ω', NULL),
('defibrillator-pm-default', 'Defibrillator / AED PM', 'defibrillator', 'safety', 'Electrical Safety', 40, 'leakage-current', 'Leakage Current', 20, 'numeric', 'µA', 'spec ≤ 300µA', NULL),
('infusion-pump-pm-default', 'Infusion Pump PM', 'infusion_pump', 'electrical', 'Electrical', 10, 'power-cord-plug', 'Power Cord & Plug integrity', 10, 'pass_fail_na', NULL, NULL, NULL),
('infusion-pump-pm-default', 'Infusion Pump PM', 'infusion_pump', 'electrical', 'Electrical', 10, 'battery-backup', 'Battery charged & holds capacity', 20, 'pass_fail_na', NULL, NULL, NULL),
('infusion-pump-pm-default', 'Infusion Pump PM', 'infusion_pump', 'electrical', 'Electrical', 10, 'display', 'Display functioning properly', 30, 'pass_fail_na', NULL, NULL, NULL),
('infusion-pump-pm-default', 'Infusion Pump PM', 'infusion_pump', 'electrical', 'Electrical', 10, 'faults-errors', 'Faults/Errors documented & cleared', 40, 'pass_fail_na', NULL, NULL, NULL),
('infusion-pump-pm-default', 'Infusion Pump PM', 'infusion_pump', 'flow', 'Flow & Alarms', 20, 'infusion-flow-accuracy', 'Flow rate accuracy within spec', 10, 'pass_fail_na', NULL, NULL, 'infusion_pump'),
('infusion-pump-pm-default', 'Infusion Pump PM', 'infusion_pump', 'flow', 'Flow & Alarms', 20, 'infusion-occlusion', 'Occlusion pressure alarm', 20, 'pass_fail_na', NULL, NULL, 'infusion_pump'),
('infusion-pump-pm-default', 'Infusion Pump PM', 'infusion_pump', 'flow', 'Flow & Alarms', 20, 'infusion-air-in-line', 'Air-in-line detection', 30, 'pass_fail_na', NULL, NULL, 'infusion_pump'),
('infusion-pump-pm-default', 'Infusion Pump PM', 'infusion_pump', 'flow', 'Flow & Alarms', 20, 'infusion-free-flow', 'Door open / free-flow protection', 40, 'pass_fail_na', NULL, NULL, 'infusion_pump'),
('infusion-pump-pm-default', 'Infusion Pump PM', 'infusion_pump', 'flow', 'Flow & Alarms', 20, 'infusion-alarms', 'Alarms audible & visual', 50, 'pass_fail_na', NULL, NULL, 'infusion_pump'),
('infusion-pump-pm-default', 'Infusion Pump PM', 'infusion_pump', 'flow', 'Flow & Alarms', 20, 'infusion-keypad', 'Keypad / buttons', 60, 'pass_fail_na', NULL, NULL, 'infusion_pump'),
('infusion-pump-pm-default', 'Infusion Pump PM', 'infusion_pump', 'aesthetic', 'Condition', 30, 'infusion-housing', 'Housing & pole clamp condition', 10, 'pass_fail_na', NULL, NULL, 'infusion_pump'),
('infusion-pump-pm-default', 'Infusion Pump PM', 'infusion_pump', 'aesthetic', 'Condition', 30, 'warning-labels', 'Warning labels present & legible', 20, 'pass_fail_na', NULL, NULL, NULL),
('infusion-pump-pm-default', 'Infusion Pump PM', 'infusion_pump', 'safety', 'Electrical Safety', 40, 'ground-resistance', 'Ground Resistance', 10, 'numeric', 'Ω', 'spec ≤ 0.2Ω', NULL),
('infusion-pump-pm-default', 'Infusion Pump PM', 'infusion_pump', 'safety', 'Electrical Safety', 40, 'leakage-current', 'Leakage Current', 20, 'numeric', 'µA', 'spec ≤ 300µA', NULL),
('patient-monitor-pm-default', 'Patient Monitor PM', 'patient_monitor', 'electrical', 'Electrical', 10, 'power-cord-plug', 'Power Cord & Plug integrity', 10, 'pass_fail_na', NULL, NULL, NULL),
('patient-monitor-pm-default', 'Patient Monitor PM', 'patient_monitor', 'electrical', 'Electrical', 10, 'battery-backup', 'Battery charged & holds capacity', 20, 'pass_fail_na', NULL, NULL, NULL),
('patient-monitor-pm-default', 'Patient Monitor PM', 'patient_monitor', 'electrical', 'Electrical', 10, 'display', 'Display functioning properly', 30, 'pass_fail_na', NULL, NULL, NULL),
('patient-monitor-pm-default', 'Patient Monitor PM', 'patient_monitor', 'electrical', 'Electrical', 10, 'faults-errors', 'Faults/Errors documented & cleared', 40, 'pass_fail_na', NULL, NULL, NULL),
('patient-monitor-pm-default', 'Patient Monitor PM', 'patient_monitor', 'parameters', 'Parameters', 20, 'monitor-ecg', 'ECG / heart rate accuracy (simulator)', 10, 'pass_fail_na', NULL, NULL, 'patient_monitor'),
('patient-monitor-pm-default', 'Patient Monitor PM', 'patient_monitor', 'parameters', 'Parameters', 20, 'monitor-spo2', 'SpO2 accuracy', 20, 'pass_fail_na', NULL, NULL, 'patient_monitor'),
('patient-monitor-pm-default', 'Patient Monitor PM', 'patient_monitor', 'parameters', 'Parameters', 20, 'monitor-nibp', 'NIBP accuracy & leak test', 30, 'pass_fail_na', NULL, NULL, 'patient_monitor'),
('patient-monitor-pm-default', 'Patient Monitor PM', 'patient_monitor', 'parameters', 'Parameters', 20, 'monitor-temp', 'Temperature', 40, 'pass_fail_na', NULL, NULL, 'patient_monitor'),
('patient-monitor-pm-default', 'Patient Monitor PM', 'patient_monitor', 'parameters', 'Parameters', 20, 'monitor-ibp-co2', 'IBP / CO2 (if equipped)', 50, 'pass_fail_na', NULL, NULL, 'patient_monitor'),
('patient-monitor-pm-default', 'Patient Monitor PM', 'patient_monitor', 'parameters', 'Parameters', 20, 'monitor-alarms', 'Alarms audible & visual', 60, 'pass_fail_na', NULL, NULL, 'patient_monitor'),
('patient-monitor-pm-default', 'Patient Monitor PM', 'patient_monitor', 'parameters', 'Parameters', 20, 'monitor-network', 'Network / central station connection', 70, 'pass_fail_na', NULL, NULL, 'patient_monitor'),
('patient-monitor-pm-default', 'Patient Monitor PM', 'patient_monitor', 'aesthetic', 'Accessories & Condition', 30, 'monitor-cables', 'Patient cables & sensors condition', 10, 'pass_fail_na', NULL, NULL, 'patient_monitor'),
('patient-monitor-pm-default', 'Patient Monitor PM', 'patient_monitor', 'aesthetic', 'Accessories & Condition', 30, 'monitor-mount', 'Mount / housing condition', 20, 'pass_fail_na', NULL, NULL, 'patient_monitor'),
('patient-monitor-pm-default', 'Patient Monitor PM', 'patient_monitor', 'aesthetic', 'Accessories & Condition', 30, 'warning-labels', 'Warning labels present & legible', 30, 'pass_fail_na', NULL, NULL, NULL),
('patient-monitor-pm-default', 'Patient Monitor PM', 'patient_monitor', 'safety', 'Electrical Safety', 40, 'ground-resistance', 'Ground Resistance', 10, 'numeric', 'Ω', 'spec ≤ 0.2Ω', NULL),
('patient-monitor-pm-default', 'Patient Monitor PM', 'patient_monitor', 'safety', 'Electrical Safety', 40, 'leakage-current', 'Leakage Current', 20, 'numeric', 'µA', 'spec ≤ 300µA', NULL),
('ventilator-pm-default', 'Ventilator PM', 'ventilator', 'electrical', 'Electrical', 10, 'power-cord-plug', 'Power Cord & Plug integrity', 10, 'pass_fail_na', NULL, NULL, NULL),
('ventilator-pm-default', 'Ventilator PM', 'ventilator', 'electrical', 'Electrical', 10, 'battery-backup', 'Battery charged & holds capacity', 20, 'pass_fail_na', NULL, NULL, NULL),
('ventilator-pm-default', 'Ventilator PM', 'ventilator', 'electrical', 'Electrical', 10, 'display', 'Display functioning properly', 30, 'pass_fail_na', NULL, NULL, NULL),
('ventilator-pm-default', 'Ventilator PM', 'ventilator', 'electrical', 'Electrical', 10, 'faults-errors', 'Faults/Errors documented & cleared', 40, 'pass_fail_na', NULL, NULL, NULL),
('ventilator-pm-default', 'Ventilator PM', 'ventilator', 'ventilation', 'Ventilation & Alarms', 20, 'vent-self-test', 'Self-test / pre-use check passes', 10, 'pass_fail_na', NULL, NULL, 'ventilator'),
('ventilator-pm-default', 'Ventilator PM', 'ventilator', 'ventilation', 'Ventilation & Alarms', 20, 'vent-volume', 'Tidal volume accuracy', 20, 'pass_fail_na', NULL, NULL, 'ventilator'),
('ventilator-pm-default', 'Ventilator PM', 'ventilator', 'ventilation', 'Ventilation & Alarms', 20, 'vent-pressure', 'Pressure / PEEP accuracy', 30, 'pass_fail_na', NULL, NULL, 'ventilator'),
('ventilator-pm-default', 'Ventilator PM', 'ventilator', 'ventilation', 'Ventilation & Alarms', 20, 'vent-o2', 'O2 concentration / sensor calibration', 40, 'pass_fail_na', NULL, NULL, 'ventilator'),
('ventilator-pm-default', 'Ventilator PM', 'ventilator', 'ventilation', 'Ventilation & Alarms', 20, 'vent-rate', 'Rate & I:E ratio', 50, 'pass_fail_na', NULL, NULL, 'ventilator'),
('ventilator-pm-default', 'Ventilator PM', 'ventilator', 'ventilation', 'Ventilation & Alarms', 20, 'vent-alarms', 'Alarms (high/low pressure, disconnect, power)', 60, 'pass_fail_na', NULL, NULL, 'ventilator'),
('ventilator-pm-default', 'Ventilator PM', 'ventilator', 'mechanical', 'Pneumatics', 30, 'vent-filters', 'Filters replaced per PM kit', 10, 'pass_fail_na', NULL, NULL, 'ventilator'),
('ventilator-pm-default', 'Ventilator PM', 'ventilator', 'mechanical', 'Pneumatics', 30, 'vent-leak', 'Circuit leak test', 20, 'pass_fail_na', NULL, NULL, 'ventilator'),
('ventilator-pm-default', 'Ventilator PM', 'ventilator', 'mechanical', 'Pneumatics', 30, 'vent-gas-inlets', 'Gas inlet pressures & hoses', 30, 'pass_fail_na', NULL, NULL, 'ventilator'),
('ventilator-pm-default', 'Ventilator PM', 'ventilator', 'aesthetic', 'Condition', 40, 'control-panel', 'Control Panel condition', 10, 'pass_fail_na', NULL, NULL, NULL),
('ventilator-pm-default', 'Ventilator PM', 'ventilator', 'aesthetic', 'Condition', 40, 'warning-labels', 'Warning labels present & legible', 20, 'pass_fail_na', NULL, NULL, NULL),
('ventilator-pm-default', 'Ventilator PM', 'ventilator', 'safety', 'Electrical Safety', 50, 'ground-resistance', 'Ground Resistance', 10, 'numeric', 'Ω', 'spec ≤ 0.2Ω', NULL),
('ventilator-pm-default', 'Ventilator PM', 'ventilator', 'safety', 'Electrical Safety', 50, 'leakage-current', 'Leakage Current', 20, 'numeric', 'µA', 'spec ≤ 300µA', NULL),
('anesthesia-pm-default', 'Anesthesia Machine PM', 'anesthesia', 'electrical', 'Electrical', 10, 'power-cord-plug', 'Power Cord & Plug integrity', 10, 'pass_fail_na', NULL, NULL, NULL),
('anesthesia-pm-default', 'Anesthesia Machine PM', 'anesthesia', 'electrical', 'Electrical', 10, 'battery-backup', 'Battery charged & holds capacity', 20, 'pass_fail_na', NULL, NULL, NULL),
('anesthesia-pm-default', 'Anesthesia Machine PM', 'anesthesia', 'electrical', 'Electrical', 10, 'display', 'Display functioning properly', 30, 'pass_fail_na', NULL, NULL, NULL),
('anesthesia-pm-default', 'Anesthesia Machine PM', 'anesthesia', 'electrical', 'Electrical', 10, 'faults-errors', 'Faults/Errors documented & cleared', 40, 'pass_fail_na', NULL, NULL, NULL),
('anesthesia-pm-default', 'Anesthesia Machine PM', 'anesthesia', 'gas_delivery', 'Gas Delivery & Ventilation', 20, 'anes-leak-test', 'High / low pressure leak test', 10, 'pass_fail_na', NULL, NULL, 'anesthesia'),
('anesthesia-pm-default', 'Anesthesia Machine PM', 'anesthesia', 'gas_delivery', 'Gas Delivery & Ventilation', 20, 'anes-flowmeters', 'Flowmeter accuracy', 20, 'pass_fail_na', NULL, NULL, 'anesthesia'),
('anesthesia-pm-default', 'Anesthesia Machine PM', 'anesthesia', 'gas_delivery', 'Gas Delivery & Ventilation', 20, 'anes-o2-failsafe', 'O2 fail-safe / hypoxic guard', 30, 'pass_fail_na', NULL, NULL, 'anesthesia'),
('anesthesia-pm-default', 'Anesthesia Machine PM', 'anesthesia', 'gas_delivery', 'Gas Delivery & Ventilation', 20, 'anes-vaporizers', 'Vaporizer interlock & output', 40, 'pass_fail_na', NULL, NULL, 'anesthesia'),
('anesthesia-pm-default', 'Anesthesia Machine PM', 'anesthesia', 'gas_delivery', 'Gas Delivery & Ventilation', 20, 'anes-ventilator', 'Ventilator volume / pressure accuracy', 50, 'pass_fail_na', NULL, NULL, 'anesthesia'),
('anesthesia-pm-default', 'Anesthesia Machine PM', 'anesthesia', 'gas_delivery', 'Gas Delivery & Ventilation', 20, 'anes-apl', 'APL valve', 60, 'pass_fail_na', NULL, NULL, 'anesthesia'),
('anesthesia-pm-default', 'Anesthesia Machine PM', 'anesthesia', 'gas_delivery', 'Gas Delivery & Ventilation', 20, 'anes-alarms', 'Alarms audible & visual', 70, 'pass_fail_na', NULL, NULL, 'anesthesia'),
('anesthesia-pm-default', 'Anesthesia Machine PM', 'anesthesia', 'mechanical', 'Pneumatics & Scavenging', 30, 'anes-pipeline', 'Pipeline & cylinder pressures / yokes', 10, 'pass_fail_na', NULL, NULL, 'anesthesia'),
('anesthesia-pm-default', 'Anesthesia Machine PM', 'anesthesia', 'mechanical', 'Pneumatics & Scavenging', 30, 'anes-absorber', 'CO2 absorber canister', 20, 'pass_fail_na', NULL, NULL, 'anesthesia'),
('anesthesia-pm-default', 'Anesthesia Machine PM', 'anesthesia', 'mechanical', 'Pneumatics & Scavenging', 30, 'anes-scavenging', 'Scavenging system', 30, 'pass_fail_na', NULL, NULL, 'anesthesia'),
('anesthesia-pm-default', 'Anesthesia Machine PM', 'anesthesia', 'mechanical', 'Pneumatics & Scavenging', 30, 'anes-o2-sensor', 'O2 sensor calibrated', 40, 'pass_fail_na', NULL, NULL, 'anesthesia'),
('anesthesia-pm-default', 'Anesthesia Machine PM', 'anesthesia', 'mechanical', 'Pneumatics & Scavenging', 30, 'wheels-castors', 'Wheels & Castors integrity', 50, 'pass_fail_na', NULL, NULL, NULL),
('anesthesia-pm-default', 'Anesthesia Machine PM', 'anesthesia', 'aesthetic', 'Condition', 40, 'control-panel', 'Control Panel condition', 10, 'pass_fail_na', NULL, NULL, NULL),
('anesthesia-pm-default', 'Anesthesia Machine PM', 'anesthesia', 'aesthetic', 'Condition', 40, 'warning-labels', 'Warning labels present & legible', 20, 'pass_fail_na', NULL, NULL, NULL),
('anesthesia-pm-default', 'Anesthesia Machine PM', 'anesthesia', 'safety', 'Electrical Safety', 50, 'ground-resistance', 'Ground Resistance', 10, 'numeric', 'Ω', 'spec ≤ 0.2Ω', NULL),
('anesthesia-pm-default', 'Anesthesia Machine PM', 'anesthesia', 'safety', 'Electrical Safety', 50, 'leakage-current', 'Leakage Current', 20, 'numeric', 'µA', 'spec ≤ 300µA', NULL),
('c-arm-pm-default', 'C-arm PM', 'c_arm', 'electrical', 'Electrical', 10, 'power-cord-plug', 'Power Cord & Plug integrity', 10, 'pass_fail_na', NULL, NULL, NULL),
('c-arm-pm-default', 'C-arm PM', 'c_arm', 'electrical', 'Electrical', 10, 'display', 'Display functioning properly', 20, 'pass_fail_na', NULL, NULL, NULL),
('c-arm-pm-default', 'C-arm PM', 'c_arm', 'electrical', 'Electrical', 10, 'faults-errors', 'Faults/Errors documented & cleared', 30, 'pass_fail_na', NULL, NULL, NULL),
('c-arm-pm-default', 'C-arm PM', 'c_arm', 'electrical', 'Electrical', 10, 'carm-interlocks', 'Interlocks & exposure switches', 40, 'pass_fail_na', NULL, NULL, 'c_arm'),
('c-arm-pm-default', 'C-arm PM', 'c_arm', 'imaging', 'Imaging & Radiation', 20, 'carm-kvp', 'kVp accuracy', 10, 'pass_fail_na', NULL, NULL, 'c_arm'),
('c-arm-pm-default', 'C-arm PM', 'c_arm', 'imaging', 'Imaging & Radiation', 20, 'carm-ma', 'mA / exposure time accuracy', 20, 'pass_fail_na', NULL, NULL, 'c_arm'),
('c-arm-pm-default', 'C-arm PM', 'c_arm', 'imaging', 'Imaging & Radiation', 20, 'carm-dose', 'Dose / air kerma rate within limits', 30, 'pass_fail_na', NULL, NULL, 'c_arm'),
('c-arm-pm-default', 'C-arm PM', 'c_arm', 'imaging', 'Imaging & Radiation', 20, 'carm-image-quality', 'Image quality (resolution / contrast phantom)', 40, 'pass_fail_na', NULL, NULL, 'c_arm'),
('c-arm-pm-default', 'C-arm PM', 'c_arm', 'imaging', 'Imaging & Radiation', 20, 'carm-collimator', 'Collimator / beam alignment', 50, 'pass_fail_na', NULL, NULL, 'c_arm'),
('c-arm-pm-default', 'C-arm PM', 'c_arm', 'imaging', 'Imaging & Radiation', 20, 'carm-laser-aimer', 'Laser aimer', 60, 'pass_fail_na', NULL, NULL, 'c_arm'),
('c-arm-pm-default', 'C-arm PM', 'c_arm', 'mechanical', 'Mechanical', 30, 'carm-locks', 'Brakes & movement locks', 10, 'pass_fail_na', NULL, NULL, 'c_arm'),
('c-arm-pm-default', 'C-arm PM', 'c_arm', 'mechanical', 'Mechanical', 30, 'carm-cables', 'Cable track / HV cables', 20, 'pass_fail_na', NULL, NULL, 'c_arm'),
('c-arm-pm-default', 'C-arm PM', 'c_arm', 'mechanical', 'Mechanical', 30, 'wheels-castors', 'Wheels & Castors integrity', 30, 'pass_fail_na', NULL, NULL, NULL),
('c-arm-pm-default', 'C-arm PM', 'c_arm', 'aesthetic', 'Condition', 40, 'carm-monitor-cart', 'Monitor cart condition', 10, 'pass_fail_na', NULL, NULL, 'c_arm'),
('c-arm-pm-default', 'C-arm PM', 'c_arm', 'aesthetic', 'Condition', 40, 'warning-labels', 'Warning labels present & legible', 20, 'pass_fail_na', NULL, NULL, NULL),
('c-arm-pm-default', 'C-arm PM', 'c_arm', 'safety', 'Electrical Safety', 50, 'ground-resistance', 'Ground Resistance', 10, 'numeric', 'Ω', 'spec ≤ 0.2Ω', NULL),
('c-arm-pm-default', 'C-arm PM', 'c_arm', 'safety', 'Electrical Safety', 50, 'leakage-current', 'Leakage Current', 20, 'numeric', 'µA', 'spec ≤ 300µA', NULL),
('ultrasound-pm-default', 'Ultrasound PM', 'ultrasound', 'electrical', 'Electrical', 10, 'power-cord-plug', 'Power Cord & Plug integrity', 10, 'pass_fail_na', NULL, NULL, NULL),
('ultrasound-pm-default', 'Ultrasound PM', 'ultrasound', 'electrical', 'Electrical', 10, 'display', 'Display functioning properly', 20, 'pass_fail_na', NULL, NULL, NULL),
('ultrasound-pm-default', 'Ultrasound PM', 'ultrasound', 'electrical', 'Electrical', 10, 'faults-errors', 'Faults/Errors documented & cleared', 30, 'pass_fail_na', NULL, NULL, NULL),
('ultrasound-pm-default', 'Ultrasound PM', 'ultrasound', 'imaging', 'Imaging', 20, 'us-transducers', 'Transducer element / dropout test', 10, 'pass_fail_na', NULL, NULL, 'ultrasound'),
('ultrasound-pm-default', 'Ultrasound PM', 'ultrasound', 'imaging', 'Imaging', 20, 'us-image-quality', 'Image quality / phantom check', 20, 'pass_fail_na', NULL, NULL, 'ultrasound'),
('ultrasound-pm-default', 'Ultrasound PM', 'ultrasound', 'imaging', 'Imaging', 20, 'us-doppler', 'Doppler / color', 30, 'pass_fail_na', NULL, NULL, 'ultrasound'),
('ultrasound-pm-default', 'Ultrasound PM', 'ultrasound', 'imaging', 'Imaging', 20, 'us-calipers', 'Measurement caliper accuracy', 40, 'pass_fail_na', NULL, NULL, 'ultrasound'),
('ultrasound-pm-default', 'Ultrasound PM', 'ultrasound', 'imaging', 'Imaging', 20, 'us-peripherals', 'Printer / storage / network', 50, 'pass_fail_na', NULL, NULL, 'ultrasound'),
('ultrasound-pm-default', 'Ultrasound PM', 'ultrasound', 'mechanical', 'Mechanical', 30, 'us-fans-filters', 'Fans & air filters cleaned', 10, 'pass_fail_na', NULL, NULL, 'ultrasound'),
('ultrasound-pm-default', 'Ultrasound PM', 'ultrasound', 'mechanical', 'Mechanical', 30, 'wheels-castors', 'Wheels & Castors integrity', 20, 'pass_fail_na', NULL, NULL, NULL),
('ultrasound-pm-default', 'Ultrasound PM', 'ultrasound', 'aesthetic', 'Condition', 40, 'us-transducer-lens', 'Transducer lens & cable condition', 10, 'pass_fail_na', NULL, NULL, 'ultrasound'),
('ultrasound-pm-default', 'Ultrasound PM', 'ultrasound', 'aesthetic', 'Condition', 40, 'control-panel', 'Control Panel condition', 20, 'pass_fail_na', NULL, NULL, NULL),
('ultrasound-pm-default', 'Ultrasound PM', 'ultrasound', 'aesthetic', 'Condition', 40, 'warning-labels', 'Warning labels present & legible', 30, 'pass_fail_na', NULL, NULL, NULL),
('ultrasound-pm-default', 'Ultrasound PM', 'ultrasound', 'safety', 'Electrical Safety', 50, 'ground-resistance', 'Ground Resistance', 10, 'numeric', 'Ω', 'spec ≤ 0.2Ω', NULL),
('ultrasound-pm-default', 'Ultrasound PM', 'ultrasound', 'safety', 'Electrical Safety', 50, 'leakage-current', 'Leakage Current', 20, 'numeric', 'µA', 'spec ≤ 300µA', NULL),
('endoscope-pm-default', 'Endoscope / Tower PM', 'endoscope', 'electrical', 'Electrical', 10, 'power-cord-plug', 'Power Cord & Plug integrity', 10, 'pass_fail_na', NULL, NULL, NULL),
('endoscope-pm-default', 'Endoscope / Tower PM', 'endoscope', 'electrical', 'Electrical', 10, 'display', 'Display functioning properly', 20, 'pass_fail_na', NULL, NULL, NULL),
('endoscope-pm-default', 'Endoscope / Tower PM', 'endoscope', 'electrical', 'Electrical', 10, 'faults-errors', 'Faults/Errors documented & cleared', 30, 'pass_fail_na', NULL, NULL, NULL),
('endoscope-pm-default', 'Endoscope / Tower PM', 'endoscope', 'scope', 'Scope & Tower', 20, 'endo-leak-test', 'Leak test passes', 10, 'pass_fail_na', NULL, NULL, 'endoscope'),
('endoscope-pm-default', 'Endoscope / Tower PM', 'endoscope', 'scope', 'Scope & Tower', 20, 'endo-angulation', 'Angulation / deflection range', 20, 'pass_fail_na', NULL, NULL, 'endoscope'),
('endoscope-pm-default', 'Endoscope / Tower PM', 'endoscope', 'scope', 'Scope & Tower', 20, 'endo-image', 'Image quality (CCD / fiber bundle)', 30, 'pass_fail_na', NULL, NULL, 'endoscope'),
('endoscope-pm-default', 'Endoscope / Tower PM', 'endoscope', 'scope', 'Scope & Tower', 20, 'endo-light-source', 'Light source output / lamp hours', 40, 'pass_fail_na', NULL, NULL, 'endoscope'),
('endoscope-pm-default', 'Endoscope / Tower PM', 'endoscope', 'scope', 'Scope & Tower', 20, 'endo-channels', 'Air / water / suction channels', 50, 'pass_fail_na', NULL, NULL, 'endoscope'),
('endoscope-pm-default', 'Endoscope / Tower PM', 'endoscope', 'scope', 'Scope & Tower', 20, 'endo-buttons', 'Control buttons', 60, 'pass_fail_na', NULL, NULL, 'endoscope'),
('endoscope-pm-default', 'Endoscope / Tower PM', 'endoscope', 'aesthetic', 'Condition', 30, 'endo-insertion-tube', 'Insertion tube & bending rubber condition', 10, 'pass_fail_na', NULL, NULL, 'endoscope'),
('endoscope-pm-default', 'Endoscope / Tower PM', 'endoscope', 'aesthetic', 'Condition', 30, 'endo-distal-lens', 'Distal lens condition', 20, 'pass_fail_na', NULL, NULL, 'endoscope'),
('endoscope-pm-default', 'Endoscope / Tower PM', 'endoscope', 'aesthetic', 'Condition', 30, 'warning-labels', 'Warning labels present & legible', 30, 'pass_fail_na', NULL, NULL, NULL),
('endoscope-pm-default', 'Endoscope / Tower PM', 'endoscope', 'safety', 'Electrical Safety', 40, 'ground-resistance', 'Ground Resistance', 10, 'numeric', 'Ω', 'spec ≤ 0.2Ω', NULL),
('endoscope-pm-default', 'Endoscope / Tower PM', 'endoscope', 'safety', 'Electrical Safety', 40, 'leakage-current', 'Leakage Current', 20, 'numeric', 'µA', 'spec ≤ 300µA', NULL),
('lithotriptor-pm-default', 'Lithotriptor PM', 'lithotriptor', 'electrical', 'Electrical', 10, 'power-cord-plug', 'Power Cord & Plug integrity', 10, 'pass_fail_na', NULL, NULL, NULL),
('lithotriptor-pm-default', 'Lithotriptor PM', 'lithotriptor', 'electrical', 'Electrical', 10, 'display', 'Display functioning properly', 20, 'pass_fail_na', NULL, NULL, NULL),
('lithotriptor-pm-default', 'Lithotriptor PM', 'lithotriptor', 'electrical', 'Electrical', 10, 'faults-errors', 'Faults/Errors documented & cleared', 30, 'pass_fail_na', NULL, NULL, NULL),
('lithotriptor-pm-default', 'Lithotriptor PM', 'lithotriptor', 'electrical', 'Electrical', 10, 'litho-hv-generator', 'High voltage / generator to spec', 40, 'pass_fail_na', NULL, NULL, 'lithotriptor'),
('lithotriptor-pm-default', 'Lithotriptor PM', 'lithotriptor', 'shockwave', 'Shockwave & Imaging', 20, 'litho-shockwave', 'Shockwave generation / energy levels', 10, 'pass_fail_na', NULL, NULL, 'lithotriptor'),
('lithotriptor-pm-default', 'Lithotriptor PM', 'lithotriptor', 'shockwave', 'Shockwave & Imaging', 20, 'litho-ecg-trigger', 'ECG trigger / sync', 20, 'pass_fail_na', NULL, NULL, 'lithotriptor'),
('lithotriptor-pm-default', 'Lithotriptor PM', 'lithotriptor', 'shockwave', 'Shockwave & Imaging', 20, 'litho-targeting', 'Targeting / localization alignment', 30, 'pass_fail_na', NULL, NULL, 'lithotriptor'),
('lithotriptor-pm-default', 'Lithotriptor PM', 'lithotriptor', 'shockwave', 'Shockwave & Imaging', 20, 'litho-water', 'Water conditioning / degassing', 40, 'pass_fail_na', NULL, NULL, 'lithotriptor'),
('lithotriptor-pm-default', 'Lithotriptor PM', 'lithotriptor', 'shockwave', 'Shockwave & Imaging', 20, 'litho-coupling', 'Coupling cushion / membrane', 50, 'pass_fail_na', NULL, NULL, 'lithotriptor'),
('lithotriptor-pm-default', 'Lithotriptor PM', 'lithotriptor', 'shockwave', 'Shockwave & Imaging', 20, 'litho-table', 'Patient table motion', 60, 'pass_fail_na', NULL, NULL, 'lithotriptor'),
('lithotriptor-pm-default', 'Lithotriptor PM', 'lithotriptor', 'mechanical', 'Mechanical', 30, 'litho-cooling', 'Cooling system & filters', 10, 'pass_fail_na', NULL, NULL, 'lithotriptor'),
('lithotriptor-pm-default', 'Lithotriptor PM', 'lithotriptor', 'mechanical', 'Mechanical', 30, 'litho-electrode', 'Electrode / emitter shot count', 20, 'pass_fail_na', NULL, NULL, 'lithotriptor'),
('lithotriptor-pm-default', 'Lithotriptor PM', 'lithotriptor', 'aesthetic', 'Condition', 40, 'control-panel', 'Control Panel condition', 10, 'pass_fail_na', NULL, NULL, NULL),
('lithotriptor-pm-default', 'Lithotriptor PM', 'lithotriptor', 'aesthetic', 'Condition', 40, 'warning-labels', 'Warning labels present & legible', 20, 'pass_fail_na', NULL, NULL, NULL),
('lithotriptor-pm-default', 'Lithotriptor PM', 'lithotriptor', 'safety', 'Electrical Safety', 50, 'ground-resistance', 'Ground Resistance', 10, 'numeric', 'Ω', 'spec ≤ 0.2Ω', NULL),
('lithotriptor-pm-default', 'Lithotriptor PM', 'lithotriptor', 'safety', 'Electrical Safety', 50, 'leakage-current', 'Leakage Current', 20, 'numeric', 'µA', 'spec ≤ 300µA', NULL),
('general-pm-default', 'General Equipment PM', 'general', 'electrical', 'Electrical', 10, 'power-cord-plug', 'Power Cord & Plug integrity', 10, 'pass_fail_na', NULL, NULL, NULL),
('general-pm-default', 'General Equipment PM', 'general', 'electrical', 'Electrical', 10, 'display', 'Display functioning properly', 20, 'pass_fail_na', NULL, NULL, NULL),
('general-pm-default', 'General Equipment PM', 'general', 'electrical', 'Electrical', 10, 'faults-errors', 'Faults/Errors documented & cleared', 30, 'pass_fail_na', NULL, NULL, NULL),
('general-pm-default', 'General Equipment PM', 'general', 'electrical', 'Electrical', 10, 'general-controls', 'Controls & indicators', 40, 'pass_fail_na', NULL, NULL, 'general'),
('general-pm-default', 'General Equipment PM', 'general', 'functional', 'Function', 20, 'general-performance', 'Performs to manufacturer specification', 10, 'pass_fail_na', NULL, NULL, 'general'),
('general-pm-default', 'General Equipment PM', 'general', 'functional', 'Function', 20, 'general-alarms', 'Alarms / safety features (if equipped)', 20, 'pass_fail_na', NULL, NULL, 'general'),
('general-pm-default', 'General Equipment PM', 'general', 'mechanical', 'Mechanical', 30, 'general-hardware', 'Housing, mounts & hardware secure', 10, 'pass_fail_na', NULL, NULL, 'general'),
('general-pm-default', 'General Equipment PM', 'general', 'mechanical', 'Mechanical', 30, 'wheels-castors', 'Wheels & Castors integrity', 20, 'pass_fail_na', NULL, NULL, NULL),
('general-pm-default', 'General Equipment PM', 'general', 'aesthetic', 'Condition', 40, 'control-panel', 'Control Panel condition', 10, 'pass_fail_na', NULL, NULL, NULL),
('general-pm-default', 'General Equipment PM', 'general', 'aesthetic', 'Condition', 40, 'warning-labels', 'Warning labels present & legible', 20, 'pass_fail_na', NULL, NULL, NULL),
('general-pm-default', 'General Equipment PM', 'general', 'safety', 'Electrical Safety', 50, 'ground-resistance', 'Ground Resistance', 10, 'numeric', 'Ω', 'spec ≤ 0.2Ω', NULL),
('general-pm-default', 'General Equipment PM', 'general', 'safety', 'Electrical Safety', 50, 'leakage-current', 'Leakage Current', 20, 'numeric', 'µA', 'spec ≤ 300µA', NULL)
-- END STARTER SEED
;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sr_templates t JOIN sr_seed_000945 s ON s.template_slug = t.slug) THEN
    RAISE EXCEPTION '000945 drift: a starter template slug already exists; refusing';
  END IF;
  -- Shared slugs must already exist with the same label and section.
  IF EXISTS (
    SELECT 1 FROM sr_seed_000945 s
    JOIN public.sr_elements e ON e.slug = s.element_slug
    WHERE s.element_equipment_type IS NOT NULL
  ) THEN
    RAISE EXCEPTION '000945 drift: a type-specific starter element slug already exists; refusing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM sr_seed_000945 s
    JOIN public.sr_elements e ON e.slug = s.element_slug
    WHERE e.label <> s.element_label OR e.section <> s.section_key
  ) THEN
    RAISE EXCEPTION '000945 drift: a shared element label or section differs; refusing';
  END IF;
END $$;

-- 1. Section keys: any template / custom key.
ALTER TABLE public.sr_elements DROP CONSTRAINT sr_elements_section_check;
ALTER TABLE public.sr_elements
  ADD CONSTRAINT sr_elements_section_check CHECK (section ~ '^[a-z][a-z0-9_]{1,39}$');
ALTER TABLE public.service_report_items DROP CONSTRAINT service_report_items_section_check;
ALTER TABLE public.service_report_items
  ADD CONSTRAINT service_report_items_section_check CHECK (section ~ '^[a-z][a-z0-9_]{1,39}$');

-- 2. New columns.
ALTER TABLE public.sr_elements ADD COLUMN equipment_type text;
ALTER TABLE public.sr_templates
  ADD COLUMN manufacturer text,
  ADD COLUMN model text,
  ADD COLUMN organization_id bigint REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN editable_default boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT sr_templates_model_needs_manufacturer CHECK (model IS NULL OR manufacturer IS NOT NULL);
ALTER TABLE public.service_report_items
  ADD COLUMN section_label text
  CONSTRAINT service_report_items_section_label_check
  CHECK (section_label IS NULL OR char_length(section_label) BETWEEN 1 AND 80);
ALTER TABLE public.service_reports
  ADD COLUMN checklist_sections jsonb
  CONSTRAINT service_reports_checklist_sections_check
  CHECK (checklist_sections IS NULL OR jsonb_typeof(checklist_sections) = 'array');

COMMENT ON COLUMN public.sr_templates.organization_id IS 'NULL = platform template; else visible to that org only (000945).';
COMMENT ON COLUMN public.sr_templates.editable_default IS 'Starter checklist: techs may remove any line on a report (000945).';
COMMENT ON COLUMN public.service_reports.checklist_sections IS 'Modular checklist [{key,label,items:[{label,result}]}]; NULL = legacy checklist_* only (000945).';

-- 3. One default per scope (org, type, manufacturer, model).
DROP INDEX public.sr_templates_one_default_per_type;
CREATE UNIQUE INDEX sr_templates_one_default_per_scope ON public.sr_templates (
  coalesce(organization_id, 0), equipment_type, lower(coalesce(manufacturer, '')), lower(coalesce(model, ''))
) WHERE is_default AND status = 'published';
CREATE INDEX idx_sr_templates_org ON public.sr_templates (organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX idx_sr_elements_equipment_type ON public.sr_elements (equipment_type) WHERE equipment_type IS NOT NULL;

-- 4. Template sections.
CREATE TABLE public.sr_template_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.sr_templates(id) ON DELETE CASCADE,
  section_key text NOT NULL CHECK (section_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, section_key)
);
CREATE INDEX idx_sr_template_sections_template ON public.sr_template_sections (template_id, sort_order);
ALTER TABLE public.sr_template_sections ENABLE ROW LEVEL SECURITY;

-- 5. Org-scoped read policies.
DROP POLICY sr_templates_select ON public.sr_templates;
CREATE POLICY sr_templates_select ON public.sr_templates
  FOR SELECT TO authenticated
  USING (status = 'published' AND (organization_id IS NULL OR organization_id = public.get_my_org_id()));

DROP POLICY sr_template_elements_select ON public.sr_template_elements;
CREATE POLICY sr_template_elements_select ON public.sr_template_elements
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sr_templates t
    WHERE t.id = sr_template_elements.template_id
      AND t.status = 'published'
      AND (t.organization_id IS NULL OR t.organization_id = public.get_my_org_id())
  ));

CREATE POLICY sr_template_sections_select ON public.sr_template_sections
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sr_templates t
    WHERE t.id = sr_template_sections.template_id
      AND t.status = 'published'
      AND (t.organization_id IS NULL OR t.organization_id = public.get_my_org_id())
  ));

-- 6. Grants: catalog is read-only for clients.
REVOKE ALL ON public.sr_template_sections FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON public.sr_elements, public.sr_templates, public.sr_template_elements FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.sr_elements, public.sr_templates, public.sr_template_elements FROM authenticated;
GRANT SELECT ON public.sr_elements, public.sr_templates, public.sr_template_elements, public.sr_template_sections TO authenticated;
GRANT ALL ON public.sr_template_sections TO service_role;

-- 6b. Safety rows cannot be deleted; report items save atomically.
CREATE FUNCTION public.sr_items_keep_safety()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  protected boolean;
BEGIN
  protected := OLD.section = 'safety'
    OR EXISTS (SELECT 1 FROM public.sr_elements e
                WHERE e.id = OLD.element_id AND e.slug IN ('ground-resistance', 'leakage-current'));
  IF NOT protected THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- ON DELETE CASCADE from service_reports: the parent is already gone.
    IF NOT EXISTS (SELECT 1 FROM public.service_reports r WHERE r.id = OLD.service_report_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Electrical safety rows (ground resistance, leakage current) cannot be deleted from a service report'
      USING ERRCODE = 'P0945';
  END IF;
  IF NEW.section IS DISTINCT FROM OLD.section OR NEW.service_report_id IS DISTINCT FROM OLD.service_report_id THEN
    RAISE EXCEPTION 'Electrical safety rows (ground resistance, leakage current) cannot be moved off a service report'
      USING ERRCODE = 'P0945';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER sr_items_keep_safety
  BEFORE DELETE OR UPDATE ON public.service_report_items
  FOR EACH ROW EXECUTE FUNCTION public.sr_items_keep_safety();

CREATE FUNCTION public.replace_service_report_items(p_report_id uuid, p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org bigint := public.get_my_org_id();
  v_report_org bigint;
  v_count integer;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'not signed in to an organization' USING ERRCODE = '42501';
  END IF;
  SELECT r.organization_id INTO v_report_org
  FROM public.service_reports r WHERE r.id = p_report_id FOR UPDATE;
  IF NOT FOUND OR v_report_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'service report not found for this organization' USING ERRCODE = '42501';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items must be a JSON array' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.sr_rpc_items (
    ord integer, element_id uuid, section text, section_label text, label text, result text,
    value_numeric numeric, unit text, is_extra boolean, sort_order integer
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.sr_rpc_items;
  INSERT INTO pg_temp.sr_rpc_items
  SELECT x.ord::integer, (x.j->>'element_id')::uuid, x.j->>'section', nullif(x.j->>'section_label', ''),
         x.j->>'label', nullif(x.j->>'result', ''), (x.j->>'value_numeric')::numeric, x.j->>'unit',
         coalesce((x.j->>'is_extra')::boolean, false), coalesce((x.j->>'sort_order')::integer, x.ord::integer * 10)
  FROM jsonb_array_elements(p_items) WITH ORDINALITY AS x(j, ord);
  IF EXISTS (SELECT 1 FROM pg_temp.sr_rpc_items WHERE section IS NULL OR coalesce(btrim(label), '') = '') THEN
    RAISE EXCEPTION 'every item needs a section and a label' USING ERRCODE = '22023';
  END IF;

  -- Non-safety rows: replace. Safety rows: update in place, insert missing,
  -- never delete (the trigger refuses anyway).
  DELETE FROM public.service_report_items i
  WHERE i.service_report_id = p_report_id
    AND i.section <> 'safety'
    AND NOT EXISTS (SELECT 1 FROM public.sr_elements e
                     WHERE e.id = i.element_id AND e.slug IN ('ground-resistance', 'leakage-current'));

  UPDATE public.service_report_items i
  SET result = n.result, value_numeric = n.value_numeric, unit = n.unit,
      label = n.label, sort_order = n.sort_order, element_id = coalesce(i.element_id, n.element_id),
      updated_at = now()
  FROM pg_temp.sr_rpc_items n
  WHERE i.service_report_id = p_report_id AND i.section = 'safety' AND n.section = 'safety'
    AND (i.element_id = n.element_id OR i.label = n.label);

  INSERT INTO public.service_report_items
    (service_report_id, organization_id, element_id, section, section_label, label, result,
     value_numeric, unit, is_extra, sort_order)
  SELECT p_report_id, v_report_org, n.element_id, n.section, n.section_label, n.label, n.result,
         n.value_numeric, n.unit, n.is_extra, n.sort_order
  FROM pg_temp.sr_rpc_items n
  WHERE n.section <> 'safety'
     OR NOT EXISTS (SELECT 1 FROM public.service_report_items i
                     WHERE i.service_report_id = p_report_id AND i.section = 'safety'
                       AND (i.element_id = n.element_id OR i.label = n.label))
  ORDER BY n.ord;

  SELECT count(*) INTO v_count FROM public.service_report_items WHERE service_report_id = p_report_id;
  TRUNCATE pg_temp.sr_rpc_items;
  RETURN v_count;
END
$fn$;

REVOKE ALL ON FUNCTION public.sr_items_keep_safety() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_service_report_items(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_service_report_items(uuid, jsonb) TO authenticated, service_role;

-- 7. Laser: same elements, sections with today's titles.
INSERT INTO public.sr_template_sections (template_id, section_key, label, sort_order)
SELECT t.id, v.key, v.label, v.ord
FROM public.sr_templates t
CROSS JOIN (VALUES
  ('electrical', 'Electrical Checklist', 10),
  ('mechanical', 'Mechanical & Optical', 20),
  ('aesthetic', 'Aesthetic Condition', 30),
  ('safety', 'Electrical Safety', 40)
) AS v(key, label, ord)
WHERE t.slug = 'laser-pm-default';

-- 8. Starter templates (editable defaults).
INSERT INTO public.sr_elements (slug, label, section, input_kind, unit, spec_hint, is_active, sort_hint, equipment_type)
SELECT DISTINCT ON (s.element_slug)
  s.element_slug, s.element_label, s.section_key, s.input_kind, s.unit, s.spec_hint, true, s.element_order,
  s.element_equipment_type
FROM sr_seed_000945 s
WHERE NOT EXISTS (SELECT 1 FROM public.sr_elements e WHERE e.slug = s.element_slug)
ORDER BY s.element_slug, s.template_slug;

INSERT INTO public.sr_templates (slug, name, equipment_type, status, is_default, notes, editable_default)
SELECT DISTINCT s.template_slug, s.template_name, s.equipment_type, 'published', true,
  'Starter checklist (editable default). Techs can remove lines and add sections or items per report.', true
FROM sr_seed_000945 s;

INSERT INTO public.sr_template_sections (template_id, section_key, label, sort_order)
SELECT DISTINCT t.id, s.section_key, s.section_label, s.section_order
FROM sr_seed_000945 s
JOIN public.sr_templates t ON t.slug = s.template_slug;

INSERT INTO public.sr_template_elements (template_id, element_id, sort_order)
SELECT t.id, e.id, s.section_order * 100 + s.element_order
FROM sr_seed_000945 s
JOIN public.sr_templates t ON t.slug = s.template_slug
JOIN public.sr_elements e ON e.slug = s.element_slug;

DO $$
BEGIN
  IF EXISTS (
    (SELECT element_id, sort_order FROM sr_laser_before_000945
     EXCEPT SELECT te.element_id, te.sort_order FROM public.sr_template_elements te
       JOIN public.sr_templates t ON t.id = te.template_id WHERE t.slug = 'laser-pm-default')
    UNION ALL
    (SELECT te.element_id, te.sort_order FROM public.sr_template_elements te
       JOIN public.sr_templates t ON t.id = te.template_id WHERE t.slug = 'laser-pm-default'
     EXCEPT SELECT element_id, sort_order FROM sr_laser_before_000945)
  ) THEN
    RAISE EXCEPTION '000945 check: laser-pm-default elements changed';
  END IF;
  IF (SELECT count(*) FROM public.sr_templates WHERE editable_default) <> 12 THEN
    RAISE EXCEPTION '000945 check: expected 12 starter templates';
  END IF;
  IF (SELECT count(*) FROM public.sr_template_elements te JOIN public.sr_templates t ON t.id = te.template_id
       WHERE t.editable_default) <> (SELECT count(*) FROM sr_seed_000945) THEN
    RAISE EXCEPTION '000945 check: starter template element count differs from the seed';
  END IF;
END $$;

COMMIT;
