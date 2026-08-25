-- Customer-facing sell price on the catalog part.
-- Vendor unit_cost stays internal cost from each supplier.

ALTER TABLE public.parts_catalog
  ADD COLUMN IF NOT EXISTS sale_price numeric(12,2);

COMMENT ON COLUMN public.parts_catalog.sale_price IS
  'Displayed sell price. part_vendors.unit_cost is what you pay the vendor.';
