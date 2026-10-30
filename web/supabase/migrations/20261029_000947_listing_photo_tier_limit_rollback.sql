-- Rollback 000947.
DROP TRIGGER IF EXISTS marketplace_listings_photo_limit ON public.marketplace_listings;
DROP FUNCTION IF EXISTS public.enforce_listing_photo_limit();
DROP FUNCTION IF EXISTS public.listing_photo_count(jsonb);
