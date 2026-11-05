-- Rollback 000950. Fails if two non-NULL rows now collide; NULLs go back to ''
-- only where that keeps (customer, '') unique (others get a placeholder).
BEGIN;
DROP INDEX IF EXISTS public.equipment_unique_sn_per_customer;
UPDATE public.equipment e SET serial_number = CASE
    WHEN e.id = (SELECT min(x.id) FROM public.equipment x
                 WHERE x.customer_organization_id IS NOT DISTINCT FROM e.customer_organization_id
                   AND x.serial_number IS NULL) THEN ''
    ELSE 'NO-SN-' || e.id END
  WHERE e.serial_number IS NULL;
ALTER TABLE public.equipment ALTER COLUMN serial_number SET NOT NULL;
ALTER TABLE public.equipment ADD CONSTRAINT equipment_unique_sn_per_customer
  UNIQUE (customer_organization_id, serial_number);
COMMIT;
NOTIFY pgrst, 'reload schema';
