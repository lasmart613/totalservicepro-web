-- Add equipment type if the first clinic_service_leads migration already ran.
ALTER TABLE public.clinic_service_leads
  ADD COLUMN IF NOT EXISTS equipment_type text,
  ADD COLUMN IF NOT EXISTS equipment_type_other text;

COMMENT ON COLUMN public.clinic_service_leads.equipment_type IS
  'laser | lithotriptor | c_arm | other. Near-term RepairPlanet categories.';
