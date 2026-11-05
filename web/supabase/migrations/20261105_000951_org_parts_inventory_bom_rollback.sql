-- Rollback for 20261105_000951_org_parts_inventory_bom.sql
-- Removes the new tables and the Mini GentleYAG seed rows this migration inserted.
-- Does not drop legacy parts_catalog.sale_price or part_vendors.unit_cost.

BEGIN;

DROP TABLE IF EXISTS public.manual_bom_sweep;
DROP TABLE IF EXISTS public.device_bom;
DROP TABLE IF EXISTS public.organization_parts;
DROP TABLE IF EXISTS public.part_catalog_availability;

DROP TRIGGER IF EXISTS parts_catalog_set_mpn ON public.parts_catalog;
DROP FUNCTION IF EXISTS public.parts_catalog_set_mpn();

DELETE FROM public.parts_catalog
 WHERE specs->>'seed' = '000951-vpyag';

ALTER TABLE public.parts_catalog DROP COLUMN IF EXISTS specs;
ALTER TABLE public.parts_catalog DROP COLUMN IF EXISTS mpn_normalized;
DROP INDEX IF EXISTS public.parts_catalog_brand_mpn_uidx;
DROP INDEX IF EXISTS public.parts_catalog_brand_mpn_idx;

DROP FUNCTION IF EXISTS public.normalize_mpn(text);

COMMIT;

NOTIFY pgrst, 'reload schema';
