INSERT INTO storage.buckets (id, name, public)
VALUES ('equipment-photos', 'equipment-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS equipment_photos_auth_upload ON storage.objects;
CREATE POLICY equipment_photos_auth_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'equipment-photos');

DROP POLICY IF EXISTS equipment_photos_auth_update ON storage.objects;
CREATE POLICY equipment_photos_auth_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'equipment-photos');

DROP POLICY IF EXISTS equipment_photos_public_read ON storage.objects;
CREATE POLICY equipment_photos_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'equipment-photos');

DROP POLICY IF EXISTS equipment_photos_auth_delete ON storage.objects;
CREATE POLICY equipment_photos_auth_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'equipment-photos');

ALTER TABLE public.bids ADD COLUMN IF NOT EXISTS labor_amount numeric;
ALTER TABLE public.bids ADD COLUMN IF NOT EXISTS parts_amount numeric;
ALTER TABLE public.bids ADD COLUMN IF NOT EXISTS travel_amount numeric;
ALTER TABLE public.bids ADD COLUMN IF NOT EXISTS per_diem_amount numeric;
ALTER TABLE public.bids ADD COLUMN IF NOT EXISTS other_amount numeric;
ALTER TABLE public.bids ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD';

SELECT 'ok' AS status;