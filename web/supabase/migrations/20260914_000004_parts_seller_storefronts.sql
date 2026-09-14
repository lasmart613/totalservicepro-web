-- Optional public storefronts for Premium / Team parts suppliers.
-- Soft beta: no paid ads. App gates enable + bulk upload to paid supplier orgs.
--
-- LIVE SQL (Supabase SQL editor after merge):
--   Run this file as-is. Safe to re-run (IF NOT EXISTS / IF NOT EXISTS index).
--   Then confirm Luxor Photonix (or another Premium/Team parts_supplier):
--     select id, name, type, is_premium, subscription_tier, plan,
--            storefront_enabled, storefront_slug, storefront_bio
--     from organizations
--     where name ilike '%luxor%';
--   Seller UI: /marketplace/storefront  Public page: /marketplace/sellers/{slug}

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS storefront_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS storefront_slug text,
  ADD COLUMN IF NOT EXISTS storefront_bio text;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_storefront_slug_uidx
  ON public.organizations (lower(storefront_slug))
  WHERE storefront_slug IS NOT NULL AND btrim(storefront_slug) <> '';

COMMENT ON COLUMN public.organizations.storefront_enabled IS
  'Optional public marketplace storefront. Premium/Team parts suppliers only; gated in the app.';
COMMENT ON COLUMN public.organizations.storefront_slug IS
  'Public URL slug for /marketplace/sellers/{slug}. Unique when set.';
COMMENT ON COLUMN public.organizations.storefront_bio IS
  'Short public about text on the seller storefront.';

NOTIFY pgrst, 'reload schema';
