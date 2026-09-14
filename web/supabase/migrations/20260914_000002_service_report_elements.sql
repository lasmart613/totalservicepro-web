-- Service Report element library + device-type templates (MVP).
-- Seeds the laser PM form from today's CL_ELECTRICAL / MECHANICAL / AESTHETIC
-- plus Electrical Safety (ground resistance + leakage current).
--
-- APPLY ON LIVE SUPABASE (SQL Editor or CLI) after merge.
-- This repo does not auto-apply SQL. Do not wipe orgs or customer rows.
--
-- Soft beta / no paid ads. Make/model templates and manual→template pipeline
-- are out of scope; God UI for library publish is deferred.

-- ---------------------------------------------------------------------------
-- 1) Reusable element library
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sr_elements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  label text NOT NULL,
  section text NOT NULL CHECK (section IN ('electrical', 'mechanical', 'aesthetic', 'safety')),
  input_kind text NOT NULL DEFAULT 'pass_fail_na'
    CHECK (input_kind IN ('pass_fail_na', 'numeric')),
  unit text,
  spec_hint text,
  is_active boolean NOT NULL DEFAULT true,
  sort_hint integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sr_elements IS
  'Reusable Service Report checklist / safety elements. Platform catalog for MVP; one-off extras live on service_report_items.';

CREATE INDEX IF NOT EXISTS idx_sr_elements_section_sort
  ON public.sr_elements (section, sort_hint, label);

-- ---------------------------------------------------------------------------
-- 2) Device-type default templates (assembled from library elements)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sr_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  equipment_type text NOT NULL DEFAULT 'laser',
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  is_default boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sr_templates IS
  'Device-type Service Report forms. MVP seeds laser only; /reports/new falls back to laser.';

CREATE UNIQUE INDEX IF NOT EXISTS sr_templates_one_default_per_type
  ON public.sr_templates (equipment_type)
  WHERE is_default AND status = 'published';

CREATE INDEX IF NOT EXISTS idx_sr_templates_equipment_type
  ON public.sr_templates (equipment_type)
  WHERE status = 'published';

CREATE TABLE IF NOT EXISTS public.sr_template_elements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.sr_templates(id) ON DELETE CASCADE,
  element_id uuid NOT NULL REFERENCES public.sr_elements(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0,
  required boolean NOT NULL DEFAULT false,
  UNIQUE (template_id, element_id)
);

COMMENT ON TABLE public.sr_template_elements IS
  'Ordered library elements that make up a published SR template.';

CREATE INDEX IF NOT EXISTS idx_sr_template_elements_template
  ON public.sr_template_elements (template_id, sort_order);

-- ---------------------------------------------------------------------------
-- 3) Per-report answers (dual-write with legacy checklist_* JSON)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_report_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_report_id uuid NOT NULL REFERENCES public.service_reports(id) ON DELETE CASCADE,
  organization_id bigint REFERENCES public.organizations(id) ON DELETE SET NULL,
  element_id uuid REFERENCES public.sr_elements(id) ON DELETE SET NULL,
  section text NOT NULL CHECK (section IN ('electrical', 'mechanical', 'aesthetic', 'safety')),
  label text NOT NULL,
  result text,
  value_numeric numeric,
  unit text,
  is_extra boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.service_report_items IS
  'Normalized SR answers. is_extra marks library-or-custom items not on that device type default. Dual-written with checklist_* JSON so print/email keep working.';

COMMENT ON COLUMN public.service_report_items.is_extra IS
  'True when the tech added an item that is not on the device-type standard default SR.';

CREATE INDEX IF NOT EXISTS idx_service_report_items_report
  ON public.service_report_items (service_report_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_service_report_items_org
  ON public.service_report_items (organization_id)
  WHERE organization_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) Pointers on the existing report row (nullable; old rows stay valid)
-- ---------------------------------------------------------------------------
ALTER TABLE public.service_reports
  ADD COLUMN IF NOT EXISTS equipment_type text;

ALTER TABLE public.service_reports
  ADD COLUMN IF NOT EXISTS sr_template_id uuid REFERENCES public.sr_templates(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.service_reports.equipment_type IS
  'Device-type room used to pick the default SR template (laser fallback). Same values as manuals / tickets.';

COMMENT ON COLUMN public.service_reports.sr_template_id IS
  'Published template assembled onto this report. Null on legacy reports.';

-- ---------------------------------------------------------------------------
-- 5) RLS — catalog is read-only for authenticated; items follow the parent report
-- ---------------------------------------------------------------------------
ALTER TABLE public.sr_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sr_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sr_template_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_report_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sr_elements_select ON public.sr_elements;
CREATE POLICY sr_elements_select
  ON public.sr_elements
  FOR SELECT
  TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS sr_templates_select ON public.sr_templates;
CREATE POLICY sr_templates_select
  ON public.sr_templates
  FOR SELECT
  TO authenticated
  USING (status = 'published');

DROP POLICY IF EXISTS sr_template_elements_select ON public.sr_template_elements;
CREATE POLICY sr_template_elements_select
  ON public.sr_template_elements
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sr_templates t
      WHERE t.id = sr_template_elements.template_id
        AND t.status = 'published'
    )
  );

DROP POLICY IF EXISTS service_report_items_select ON public.service_report_items;
CREATE POLICY service_report_items_select
  ON public.service_report_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.service_reports r
      WHERE r.id = service_report_items.service_report_id
        AND public.can_view_service_report_for_history(r)
    )
  );

DROP POLICY IF EXISTS service_report_items_insert ON public.service_report_items;
CREATE POLICY service_report_items_insert
  ON public.service_report_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.service_reports r
      WHERE r.id = service_report_items.service_report_id
        AND r.organization_id IS NOT NULL
        AND r.organization_id = public.get_my_org_id()
    )
  );

DROP POLICY IF EXISTS service_report_items_update ON public.service_report_items;
CREATE POLICY service_report_items_update
  ON public.service_report_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.service_reports r
      WHERE r.id = service_report_items.service_report_id
        AND r.organization_id IS NOT NULL
        AND r.organization_id = public.get_my_org_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.service_reports r
      WHERE r.id = service_report_items.service_report_id
        AND r.organization_id IS NOT NULL
        AND r.organization_id = public.get_my_org_id()
    )
  );

DROP POLICY IF EXISTS service_report_items_delete ON public.service_report_items;
CREATE POLICY service_report_items_delete
  ON public.service_report_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.service_reports r
      WHERE r.id = service_report_items.service_report_id
        AND r.organization_id IS NOT NULL
        AND r.organization_id = public.get_my_org_id()
    )
  );

GRANT SELECT ON public.sr_elements TO authenticated;
GRANT SELECT ON public.sr_templates TO authenticated;
GRANT SELECT ON public.sr_template_elements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_report_items TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Seed laser PM from current Android / web CL_* + safety (idempotent)
-- ---------------------------------------------------------------------------
INSERT INTO public.sr_elements (slug, label, section, input_kind, unit, spec_hint, sort_hint)
VALUES
  ('power-cord-plug', 'Power Cord & Plug integrity', 'electrical', 'pass_fail_na', NULL, NULL, 10),
  ('foot-pedal-strain-relief', 'Foot Pedal & Strain Relief function', 'electrical', 'pass_fail_na', NULL, NULL, 20),
  ('circuit-breaker', 'Circuit Breaker function', 'electrical', 'pass_fail_na', NULL, NULL, 30),
  ('key-switch', 'Key Switch test', 'electrical', 'pass_fail_na', NULL, NULL, 40),
  ('e-stop', 'E-Stop Button operates properly', 'electrical', 'pass_fail_na', NULL, NULL, 50),
  ('display', 'Display functioning properly', 'electrical', 'pass_fail_na', NULL, NULL, 60),
  ('supplies-voltage', 'High/Low Supplies correct voltage', 'electrical', 'pass_fail_na', NULL, NULL, 70),
  ('faults-errors', 'Faults/Errors documented & cleared', 'electrical', 'pass_fail_na', NULL, NULL, 80),
  ('aiming-beam', 'Aiming Beam brightness', 'mechanical', 'pass_fail_na', NULL, NULL, 10),
  ('wheels-castors', 'Wheels & Castors integrity', 'mechanical', 'pass_fail_na', NULL, NULL, 20),
  ('optics', 'Optics inspected & cleaned', 'mechanical', 'pass_fail_na', NULL, NULL, 30),
  ('alignment', 'Full Alignment Check', 'mechanical', 'pass_fail_na', NULL, NULL, 40),
  ('coolant', 'Coolant flushed & topped off', 'mechanical', 'pass_fail_na', NULL, NULL, 50),
  ('filters', 'DI & Coolant Filters changed', 'mechanical', 'pass_fail_na', NULL, NULL, 60),
  ('interior-dust', 'Interior dust & pollutant free', 'mechanical', 'pass_fail_na', NULL, NULL, 70),
  ('servos-gears', 'Servos/Gears/Solenoids to spec', 'mechanical', 'pass_fail_na', NULL, NULL, 80),
  ('skins', 'Condition of Skins', 'aesthetic', 'pass_fail_na', NULL, NULL, 10),
  ('foot-pedal-inspection', 'Foot Pedal inspection', 'aesthetic', 'pass_fail_na', NULL, NULL, 20),
  ('screen', 'Screen condition', 'aesthetic', 'pass_fail_na', NULL, NULL, 30),
  ('control-panel', 'Control Panel condition', 'aesthetic', 'pass_fail_na', NULL, NULL, 40),
  ('accessory-cables', 'Accessory Cables', 'aesthetic', 'pass_fail_na', NULL, NULL, 50),
  ('accessories', 'Accessories of the Unit', 'aesthetic', 'pass_fail_na', NULL, NULL, 60),
  ('ground-resistance', 'Ground Resistance', 'safety', 'numeric', 'Ω', 'spec ≤ 0.2Ω', 10),
  ('leakage-current', 'Leakage Current', 'safety', 'numeric', 'µA', 'spec ≤ 300µA', 20),
  -- Library-only extras (not on the laser default form). Techs add these as is_extra.
  ('door-interlock', 'Door / room interlock function', 'electrical', 'pass_fail_na', NULL, NULL, 200),
  ('fiber-handpiece', 'Delivery fiber / handpiece inspection', 'mechanical', 'pass_fail_na', NULL, NULL, 200),
  ('warning-labels', 'Warning labels present & legible', 'aesthetic', 'pass_fail_na', NULL, NULL, 200)
ON CONFLICT (slug) DO UPDATE
SET
  label = EXCLUDED.label,
  section = EXCLUDED.section,
  input_kind = EXCLUDED.input_kind,
  unit = EXCLUDED.unit,
  spec_hint = EXCLUDED.spec_hint,
  sort_hint = EXCLUDED.sort_hint,
  is_active = true,
  updated_at = now();

INSERT INTO public.sr_templates (slug, name, equipment_type, status, is_default, notes)
VALUES (
  'laser-pm-default',
  'Laser PM',
  'laser',
  'published',
  true,
  'MVP seed from existing CL_ELECTRICAL / CL_MECHANICAL / CL_AESTHETIC plus Electrical Safety. Prefer PM form from manuals later.'
)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  equipment_type = EXCLUDED.equipment_type,
  status = EXCLUDED.status,
  is_default = EXCLUDED.is_default,
  notes = EXCLUDED.notes,
  updated_at = now();

INSERT INTO public.sr_template_elements (template_id, element_id, sort_order, required)
SELECT
  t.id,
  e.id,
  CASE e.section
    WHEN 'electrical' THEN 100 + e.sort_hint
    WHEN 'mechanical' THEN 200 + e.sort_hint
    WHEN 'aesthetic' THEN 300 + e.sort_hint
    WHEN 'safety' THEN 400 + e.sort_hint
    ELSE 500 + e.sort_hint
  END,
  false
FROM public.sr_templates t
JOIN public.sr_elements e ON e.slug IN (
  'power-cord-plug',
  'foot-pedal-strain-relief',
  'circuit-breaker',
  'key-switch',
  'e-stop',
  'display',
  'supplies-voltage',
  'faults-errors',
  'aiming-beam',
  'wheels-castors',
  'optics',
  'alignment',
  'coolant',
  'filters',
  'interior-dust',
  'servos-gears',
  'skins',
  'foot-pedal-inspection',
  'screen',
  'control-panel',
  'accessory-cables',
  'accessories',
  'ground-resistance',
  'leakage-current'
)
WHERE t.slug = 'laser-pm-default'
ON CONFLICT (template_id, element_id) DO UPDATE
SET sort_order = EXCLUDED.sort_order;

SELECT 'ok' AS service_report_elements_mvp;
