-- 000950: blank equipment serials are stored as NULL and don't collide.
-- Before: serial_number NOT NULL + UNIQUE (customer_organization_id, serial_number),
-- so a second no-serial unit for the same clinic failed with 409.
BEGIN;
ALTER TABLE public.equipment ALTER COLUMN serial_number DROP NOT NULL;
-- Normalise existing blanks to NULL.
UPDATE public.equipment SET serial_number = NULL
  WHERE serial_number IS NOT NULL AND btrim(serial_number) = '';
ALTER TABLE public.equipment DROP CONSTRAINT IF EXISTS equipment_unique_sn_per_customer;
DROP INDEX IF EXISTS public.equipment_unique_sn_per_customer;
CREATE UNIQUE INDEX equipment_unique_sn_per_customer
  ON public.equipment (customer_organization_id, serial_number)
  WHERE serial_number IS NOT NULL AND btrim(serial_number) <> '';
COMMIT;
NOTIFY pgrst, 'reload schema';
