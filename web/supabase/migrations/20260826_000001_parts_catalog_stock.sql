-- Shop stock flags on a catalog part.
ALTER TABLE public.parts_catalog
  ADD COLUMN IF NOT EXISTS in_stock boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quantity_on_hand integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.parts_catalog.in_stock IS
  'Whether this shop currently has the part in stock.';
COMMENT ON COLUMN public.parts_catalog.quantity_on_hand IS
  'Units currently on hand. Independent of vendor cost.';
