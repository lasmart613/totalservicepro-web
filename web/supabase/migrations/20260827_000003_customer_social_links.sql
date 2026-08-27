-- Customer CRM social profile URLs on organizations.
-- Website stays on organizations.website. These columns are optional; the
-- app strips them and retries if an older DB has not applied this migration.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS x_url text,
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS facebook_url text,
  ADD COLUMN IF NOT EXISTS tiktok_url text,
  ADD COLUMN IF NOT EXISTS youtube_url text,
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS yelp_url text,
  ADD COLUMN IF NOT EXISTS threads_url text;

COMMENT ON COLUMN public.organizations.x_url IS
  'Customer X (Twitter) profile URL. App accepts @handles and stores the canonical URL.';
COMMENT ON COLUMN public.organizations.instagram_url IS
  'Customer Instagram profile URL.';
COMMENT ON COLUMN public.organizations.facebook_url IS
  'Customer Facebook page URL.';
COMMENT ON COLUMN public.organizations.tiktok_url IS
  'Customer TikTok profile URL.';
COMMENT ON COLUMN public.organizations.youtube_url IS
  'Customer YouTube channel URL.';
COMMENT ON COLUMN public.organizations.linkedin_url IS
  'Customer LinkedIn page URL (laser-clinic / practice).';
COMMENT ON COLUMN public.organizations.yelp_url IS
  'Customer Yelp business URL (laser-clinic / practice).';
COMMENT ON COLUMN public.organizations.threads_url IS
  'Customer Threads profile URL.';
