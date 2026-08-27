-- Shop-scoped test equipment (meters / analyzers) + assign-to-FSE.
-- Idempotent: live may already have public.test_equipment from earlier apps.
-- Do not fail the product if this file has not been applied yet — the web
-- client omits missing columns / treats a missing table as unavailable.

CREATE TABLE IF NOT EXISTS public.test_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  make text,
  model text,
  serial_number text,
  asset_tag text,
  cal_date date,
  cal_due date,
  cal_lab text,
  notes text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.test_equipment ADD COLUMN IF NOT EXISTS organization_id bigint;
ALTER TABLE public.test_equipment ADD COLUMN IF NOT EXISTS owned_by uuid;
ALTER TABLE public.test_equipment ADD COLUMN IF NOT EXISTS assigned_to_fse uuid;

COMMENT ON TABLE public.test_equipment IS 'Company test gear (meters, analyzers). Shop-scoped via organization_id; assign to an FSE via assigned_to_fse.';
COMMENT ON COLUMN public.test_equipment.organization_id IS 'Service company that owns this asset';
COMMENT ON COLUMN public.test_equipment.owned_by IS 'User who registered the asset';
COMMENT ON COLUMN public.test_equipment.assigned_to_fse IS 'FSE / technician currently checked out with this equipment (user_profiles.id)';

CREATE INDEX IF NOT EXISTS idx_test_equipment_org ON public.test_equipment (organization_id);
CREATE INDEX IF NOT EXISTS idx_test_equipment_assigned ON public.test_equipment (assigned_to_fse);
CREATE INDEX IF NOT EXISTS idx_test_equipment_owned_by ON public.test_equipment (owned_by);

ALTER TABLE public.test_equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own test equipment" ON public.test_equipment;
DROP POLICY IF EXISTS test_equipment_select ON public.test_equipment;
DROP POLICY IF EXISTS test_equipment_insert ON public.test_equipment;
DROP POLICY IF EXISTS test_equipment_update ON public.test_equipment;
DROP POLICY IF EXISTS test_equipment_delete ON public.test_equipment;

CREATE POLICY test_equipment_select ON public.test_equipment
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR owned_by = auth.uid()
    OR assigned_to_fse = auth.uid()
    OR organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY test_equipment_insert ON public.test_equipment
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR owned_by = auth.uid()
    OR organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY test_equipment_update ON public.test_equipment
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR owned_by = auth.uid()
    OR organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR owned_by = auth.uid()
    OR assigned_to_fse = auth.uid()
    OR organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY test_equipment_delete ON public.test_equipment
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR owned_by = auth.uid()
    OR organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

SELECT 'ok' AS status;
