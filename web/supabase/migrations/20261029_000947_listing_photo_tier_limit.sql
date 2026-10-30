-- 000947: listing photo cap by plan (Free 1, paid 8). NOT APPLIED — needs Larry's OK.
-- Mirrors lib/marketplace/storefront.ts listingPhotoLimit. Covers the direct
-- client insert on /marketplace/list and every server path. Existing over-cap
-- listings are grandfathered: an update that does not add photos is allowed.
-- No rows are changed by this migration.

CREATE OR REPLACE FUNCTION public.listing_photo_count(p_row jsonb)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(
    COALESCE((SELECT count(*)::int FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(p_row->'images') = 'array' THEN p_row->'images' ELSE '[]'::jsonb END) e
      WHERE btrim(e) <> ''), 0),
    COALESCE((SELECT count(*)::int FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(p_row->'photos') = 'array' THEN p_row->'photos' ELSE '[]'::jsonb END) e
      WHERE btrim(e) <> ''), 0)
  );
$$;

CREATE OR REPLACE FUNCTION public.enforce_listing_photo_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new int := public.listing_photo_count(to_jsonb(NEW));
  v_old int := 0;
  v_limit int := 1;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old := public.listing_photo_count(to_jsonb(OLD));
    IF v_new <= v_old THEN
      RETURN NEW; -- grandfathered or shrinking
    END IF;
  END IF;
  IF NEW.organization_id IS NOT NULL AND public.org_is_paid_entitled(NEW.organization_id::bigint) THEN
    v_limit := 8;
  END IF;
  IF v_new > v_limit THEN
    RAISE EXCEPTION 'Listings on this plan can have % photo(s). Upgrade to add up to 8.', v_limit
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_listing_photo_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS marketplace_listings_photo_limit ON public.marketplace_listings;
CREATE TRIGGER marketplace_listings_photo_limit
  BEFORE INSERT OR UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_listing_photo_limit();
