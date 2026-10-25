-- Rollback for 20261025_000945_service_report_type_templates.sql.
--
-- Restores the 000002 shape exactly: legacy section CHECKs, one default per
-- type, published-only policies, the anon SELECT / authenticated
-- SELECT,INSERT,UPDATE,DELETE grants, and drops the 000945 columns, table,
-- safety trigger, replace_service_report_items RPC and starter seed. laser-pm-default and the 27 pre-000945 elements are left untouched.
--
-- Refuses (drift guard) rather than lose data when reports already use the
-- new shape: any service_report_items row with a non-legacy section or a
-- section_label, any service_reports.checklist_sections value, any item that
-- points at a starter element, or any org-specific / manufacturer / model
-- template. Bookkeeping: delete version 20261025_000945 from
-- supabase_migrations.schema_migrations after it commits.
-- APPLY ON LIVE SUPABASE only after Larry's yes.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.sr_template_sections') IS NULL THEN
    RAISE EXCEPTION '000945 rollback drift: sr_template_sections is missing (000945 not applied?)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.service_report_items
              WHERE section NOT IN ('electrical', 'mechanical', 'aesthetic', 'safety') OR section_label IS NOT NULL) THEN
    RAISE EXCEPTION '000945 rollback drift: report items use template / custom sections; refusing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.service_reports WHERE checklist_sections IS NOT NULL) THEN
    RAISE EXCEPTION '000945 rollback drift: service_reports.checklist_sections has data; refusing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sr_templates
              WHERE organization_id IS NOT NULL OR manufacturer IS NOT NULL OR model IS NOT NULL) THEN
    RAISE EXCEPTION '000945 rollback drift: org / manufacturer / model templates exist; refusing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sr_templates WHERE NOT editable_default AND slug <> 'laser-pm-default' AND is_default AND status = 'published') THEN
    RAISE EXCEPTION '000945 rollback drift: an unknown default template exists; refusing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.service_report_items i
    JOIN public.sr_elements e ON e.id = i.element_id
    WHERE e.equipment_type IS NOT NULL OR e.slug = 'battery-backup'
  ) THEN
    RAISE EXCEPTION '000945 rollback drift: report items reference starter elements; refusing';
  END IF;
END $$;

-- Safety trigger and atomic-save RPC first (so the deletes below are plain).
DROP TRIGGER sr_items_keep_safety ON public.service_report_items;
DROP FUNCTION public.replace_service_report_items(uuid, jsonb);
DROP FUNCTION public.sr_items_keep_safety();

-- Starter seed (template_elements / sections cascade with the template).
-- Elements 000945 created: type-scoped ones plus the shared battery-backup.
-- Pre-existing shared slugs (power-cord-plug, warning-labels, ...) stay.
DELETE FROM public.sr_templates WHERE editable_default;

DELETE FROM public.sr_elements e
WHERE (e.equipment_type IS NOT NULL OR e.slug = 'battery-backup')
  AND NOT EXISTS (SELECT 1 FROM public.sr_template_elements te WHERE te.element_id = e.id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sr_elements WHERE section NOT IN ('electrical', 'mechanical', 'aesthetic', 'safety')) THEN
    RAISE EXCEPTION '000945 rollback drift: non-legacy sr_elements remain; refusing';
  END IF;
END $$;

-- Policies.
DROP POLICY sr_template_sections_select ON public.sr_template_sections;
DROP POLICY sr_template_elements_select ON public.sr_template_elements;
CREATE POLICY sr_template_elements_select ON public.sr_template_elements
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sr_templates t
    WHERE t.id = sr_template_elements.template_id AND t.status = 'published'
  ));
DROP POLICY sr_templates_select ON public.sr_templates;
CREATE POLICY sr_templates_select ON public.sr_templates
  FOR SELECT TO authenticated
  USING (status = 'published');

-- Table, indexes, columns.
DROP TABLE public.sr_template_sections;
DROP INDEX public.idx_sr_elements_equipment_type;
DROP INDEX public.idx_sr_templates_org;
DROP INDEX public.sr_templates_one_default_per_scope;
CREATE UNIQUE INDEX sr_templates_one_default_per_type
  ON public.sr_templates (equipment_type)
  WHERE is_default AND status = 'published';

ALTER TABLE public.service_reports DROP COLUMN checklist_sections;
ALTER TABLE public.service_report_items DROP COLUMN section_label;
ALTER TABLE public.sr_templates
  DROP CONSTRAINT sr_templates_model_needs_manufacturer,
  DROP COLUMN editable_default,
  DROP COLUMN organization_id,
  DROP COLUMN model,
  DROP COLUMN manufacturer;
ALTER TABLE public.sr_elements DROP COLUMN equipment_type;

ALTER TABLE public.service_report_items DROP CONSTRAINT service_report_items_section_check;
ALTER TABLE public.service_report_items
  ADD CONSTRAINT service_report_items_section_check
  CHECK (section IN ('electrical', 'mechanical', 'aesthetic', 'safety'));
ALTER TABLE public.sr_elements DROP CONSTRAINT sr_elements_section_check;
ALTER TABLE public.sr_elements
  ADD CONSTRAINT sr_elements_section_check
  CHECK (section IN ('electrical', 'mechanical', 'aesthetic', 'safety'));

-- Grants back to the 000002 state.
GRANT SELECT ON public.sr_elements, public.sr_templates, public.sr_template_elements TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sr_elements, public.sr_templates, public.sr_template_elements TO authenticated;

COMMIT;
