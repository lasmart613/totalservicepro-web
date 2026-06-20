-- Migration: Align marketplace tables + RLS + Storage (idempotent/hardened version)
-- Run this in Supabase SQL Editor.
--
-- PREREQUISITES (important!):
-- 1. In Supabase Dashboard > Storage, CREATE the bucket named exactly: marketplace-images
--    (You can set it to Public for easy getPublicUrl, or keep private and rely on policies).
-- 2. Preferably run after the 20260611 and 20260613 marketplace migrations.
-- 3. Use the service_role key or the SQL editor (admin privileges) so policies and storage work.
--
-- This script is made idempotent: drops policies before re-creating them.
-- Tables use IF NOT EXISTS.
-- Includes defensive checks for the storage bucket.

-- =====================================================
-- 1. marketplace_listings (Parts + Used Systems + general)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid REFERENCES auth.users(id) ON DELETE SET NULL NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  organization_id bigint REFERENCES public.organizations(id) ON DELETE SET NULL,
  listing_type text NOT NULL DEFAULT 'other', -- 'part' | 'used' | 'other'
  title text,
  description text,
  manufacturer text,
  model text,
  serial_number text,
  condition text,
  price numeric,
  quantity integer DEFAULT 1,
  year_manufactured integer,
  images jsonb DEFAULT '[]'::jsonb,
  details jsonb DEFAULT '{}'::jsonb,          -- rich fields: shot_counts, performance_data, etc. (use this instead of top-level columns for model-specific data)
  status text DEFAULT 'active',                -- active, sold, expired, removed
  notes text,                                  -- additional notes / reason for selling for listings
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;

-- DEFENSIVE FIX: Add columns if table existed from partial/previous migration (this fixes "column created_by does not exist")
ALTER TABLE IF EXISTS public.marketplace_listings
  ADD COLUMN IF NOT EXISTS seller_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_id bigint REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS listing_type text,
  ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS details jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS year_manufactured integer,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Fill defaults for any existing rows (safe)
UPDATE public.marketplace_listings SET listing_type = COALESCE(listing_type, 'other') WHERE listing_type IS NULL;
UPDATE public.marketplace_listings SET status = COALESCE(status, 'active') WHERE status IS NULL;

-- Drop old policies first (idempotent)
DROP POLICY IF EXISTS "Owners manage own listings" ON public.marketplace_listings;
DROP POLICY IF EXISTS "Authenticated can view active listings" ON public.marketplace_listings;

-- Owners (seller_id or created_by) can fully manage their own listings
CREATE POLICY "Owners manage own listings" ON public.marketplace_listings
  FOR ALL
  USING (seller_id = auth.uid() OR created_by = auth.uid())
  WITH CHECK (seller_id = auth.uid() OR created_by = auth.uid());

-- FSEs, service companies, and any authenticated users can browse active listings
CREATE POLICY "Authenticated can view active listings" ON public.marketplace_listings
  FOR SELECT TO authenticated
  USING (status = 'active');

-- =====================================================
-- 2. marketplace_requests (biddable service needs)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.marketplace_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  organization_id bigint REFERENCES public.organizations(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  manufacturer text,
  model text,
  serial_number text,
  urgency text DEFAULT 'Medium',
  preferred_date date,
  error_codes text,
  location_id uuid,
  location text,
  city text,
  state text,
  images jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'open',   -- open, bidding, awarded, closed
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.marketplace_requests ENABLE ROW LEVEL SECURITY;

-- DEFENSIVE: Add columns if table pre-existed without them
ALTER TABLE IF EXISTS public.marketplace_requests
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_id bigint REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE public.marketplace_requests SET status = COALESCE(status, 'open') WHERE status IS NULL;

DROP POLICY IF EXISTS "Owners manage own requests" ON public.marketplace_requests;
DROP POLICY IF EXISTS "Authenticated can view open requests" ON public.marketplace_requests;

CREATE POLICY "Owners manage own requests" ON public.marketplace_requests
  FOR ALL
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- FSEs / service companies / authenticated users can see open requests to bid on them
CREATE POLICY "Authenticated can view open requests" ON public.marketplace_requests
  FOR SELECT TO authenticated
  USING (status IN ('open', 'bidding'));

-- =====================================================
-- 3. bids (aligned to current code using bidder_id + price)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.marketplace_requests(id) ON DELETE CASCADE,
  bidder_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  bidder_org_id bigint REFERENCES public.organizations(id) ON DELETE SET NULL,
  price numeric,
  notes text,
  status text DEFAULT 'pending',   -- pending, accepted, rejected
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;

-- DEFENSIVE: Add columns if bids table pre-existed without them
ALTER TABLE IF EXISTS public.bids
  ADD COLUMN IF NOT EXISTS bidder_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bidder_org_id bigint REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS price numeric,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

DROP POLICY IF EXISTS "Bidders manage own bids" ON public.bids;
DROP POLICY IF EXISTS "Request owners view bids" ON public.bids;

-- The bidder can manage (create/update/delete) their own bids
CREATE POLICY "Bidders manage own bids" ON public.bids
  FOR ALL
  USING (bidder_id = auth.uid())
  WITH CHECK (bidder_id = auth.uid());

-- The owner of the request can see all bids on it
CREATE POLICY "Request owners view bids" ON public.bids
  FOR SELECT
  USING (
    request_id IN (
      SELECT id FROM public.marketplace_requests 
      WHERE created_by = auth.uid()
    )
  );

-- =====================================================
-- 4. Compatibility tables (marketplace_parts + view)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.marketplace_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  part_number text,
  description text,
  manufacturer text,
  model text,
  condition text,
  price numeric,
  quantity integer DEFAULT 1,
  images jsonb DEFAULT '[]',
  data jsonb DEFAULT '{}',
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.marketplace_parts ENABLE ROW LEVEL SECURITY;

-- DEFENSIVE
ALTER TABLE IF EXISTS public.marketplace_parts
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS data jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';

UPDATE public.marketplace_parts SET status = COALESCE(status, 'active') WHERE status IS NULL;

DROP POLICY IF EXISTS "Owners manage own parts" ON public.marketplace_parts;
DROP POLICY IF EXISTS "Authenticated view active parts" ON public.marketplace_parts;

CREATE POLICY "Owners manage own parts" ON public.marketplace_parts
  FOR ALL USING (created_by = auth.uid());

CREATE POLICY "Authenticated view active parts" ON public.marketplace_parts
  FOR SELECT TO authenticated USING (status = 'active');

-- Safety: remove old singular name if it was accidentally created (we standardized on plural)
-- It might exist as a table or as a view depending on previous migration attempts.
DROP VIEW IF EXISTS public.marketplace_listing;
DROP TABLE IF EXISTS public.marketplace_listing CASCADE;

-- =====================================================
-- Triggers for updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_marketplace_listings_updated_at ON public.marketplace_listings;
CREATE TRIGGER update_marketplace_listings_updated_at
  BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_marketplace_requests_updated_at ON public.marketplace_requests;
CREATE TRIGGER update_marketplace_requests_updated_at
  BEFORE UPDATE ON public.marketplace_requests
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_bids_updated_at ON public.bids;
CREATE TRIGGER update_bids_updated_at
  BEFORE UPDATE ON public.bids
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

-- =====================================================
-- 5. Storage policies for marketplace-images
-- =====================================================
-- These will only run if the bucket exists.
-- Make sure you created the bucket "marketplace-images" in the dashboard first.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'marketplace-images'
  ) THEN
    -- Uploads only allowed under the user's own folder
    DROP POLICY IF EXISTS "Authenticated users can upload listing images" ON storage.objects;
    CREATE POLICY "Authenticated users can upload listing images"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'marketplace-images' 
      AND (storage.foldername(name))[0] = auth.uid()::text
    );

    -- Anyone can read the images (required for getPublicUrl to work in the app)
    DROP POLICY IF EXISTS "Public can view listing images" ON storage.objects;
    CREATE POLICY "Public can view listing images"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'marketplace-images');

    -- Owners can update/delete their own images
    DROP POLICY IF EXISTS "Users can update own listing images" ON storage.objects;
    CREATE POLICY "Users can update own listing images"
    ON storage.objects FOR UPDATE TO authenticated
    USING (
      bucket_id = 'marketplace-images' 
      AND (storage.foldername(name))[0] = auth.uid()::text
    );

    DROP POLICY IF EXISTS "Users can delete own listing images" ON storage.objects;
    CREATE POLICY "Users can delete own listing images"
    ON storage.objects FOR DELETE TO authenticated
    USING (
      bucket_id = 'marketplace-images' 
      AND (storage.foldername(name))[0] = auth.uid()::text
    );

    RAISE NOTICE 'Storage policies for marketplace-images applied successfully.';
  ELSE
    RAISE NOTICE 'WARNING: Bucket "marketplace-images" does not exist yet.';
    RAISE NOTICE 'Please create it in the Supabase Dashboard > Storage first, then re-run this migration.';
  END IF;
END $$;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- =====================================================
-- Post-run verification suggestions (run these separately if you want to test)
-- =====================================================
-- SELECT * FROM pg_policies WHERE tablename IN ('marketplace_listings', 'marketplace_requests', 'bids');
-- SELECT * FROM storage.policies WHERE bucket_id = 'marketplace-images';

-- After running:
-- 1. Test posting a listing as a user → should succeed and appear in /marketplace/my-listings
-- 2. Log in as a different FSE/company user → should be able to see the listing
-- 3. Image upload should work and store under your-uuid/listings/...
-- 4. Bidding flow should work on requests.

-- =====================================================
-- If you previously ran only the small "notes" patch, you can now safely run this entire file.
-- It is idempotent and will ensure the full correct schema + RLS.
-- =====================================================