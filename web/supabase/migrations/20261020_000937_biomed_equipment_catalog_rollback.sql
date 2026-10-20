-- Rollback for 20261020_000937_biomed_equipment_catalog.sql. Exact inverse:
--   * drops equipment.equipment_type (with its CHECK and column grants);
--     any types users saved after apply are lost (manufacturer/model text stays).
--   * deletes laser_models rows with description = '000937 biomed seed'.
--   * deletes manufacturers with category = '000937 biomed seed'. Refuses if a
--     non-seed model now hangs off one of them (FK is ON DELETE CASCADE, so a
--     delete would take user data with it).
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.laser_models l
               JOIN public.manufacturers m ON m.id = l.manufacturer_id
              WHERE m.category = '000937 biomed seed'
                AND l.description IS DISTINCT FROM '000937 biomed seed') THEN
    RAISE EXCEPTION '000937 rollback: a non-seed model belongs to a seeded manufacturer; resolve by hand';
  END IF;
END
$guard$;

ALTER TABLE public.equipment DROP CONSTRAINT IF EXISTS equipment_equipment_type_check;
ALTER TABLE public.equipment DROP COLUMN IF EXISTS equipment_type;

DELETE FROM public.laser_models WHERE description = '000937 biomed seed';
DELETE FROM public.manufacturers WHERE category = '000937 biomed seed';

COMMIT;
