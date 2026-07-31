-- Track test equipment ownership / assignment / org
ALTER TABLE public.test_equipment
  ADD COLUMN IF NOT EXISTS organization_id bigint;

ALTER TABLE public.test_equipment
  ADD COLUMN IF NOT EXISTS owned_by uuid;

ALTER TABLE public.test_equipment
  ADD COLUMN IF NOT EXISTS assigned_to_fse uuid;

COMMENT ON COLUMN public.test_equipment.organization_id IS 'Service company (or facility) that owns this asset';
COMMENT ON COLUMN public.test_equipment.owned_by IS 'User who owns/registers the asset (often admin or asset manager)';
COMMENT ON COLUMN public.test_equipment.assigned_to_fse IS 'FSE currently checked out with this equipment';

CREATE INDEX IF NOT EXISTS idx_test_equipment_org ON public.test_equipment (organization_id);
CREATE INDEX IF NOT EXISTS idx_test_equipment_assigned ON public.test_equipment (assigned_to_fse);
CREATE INDEX IF NOT EXISTS idx_test_equipment_owned_by ON public.test_equipment (owned_by);

-- Broader RLS: own rows, assigned rows, or same organization
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
