-- Persist Stripe Product + Price ids for marketplace parts (existing RepairPlanet Stripe).
-- IDs are also mirrored into details JSON so checkout still works if this migration
-- has not been applied yet.

ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS stripe_product_id text,
  ADD COLUMN IF NOT EXISTS stripe_price_id text;

NOTIFY pgrst, 'reload schema';
