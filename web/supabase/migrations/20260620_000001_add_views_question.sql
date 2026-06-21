-- Add views counter to listings and question field to bids
-- Run this in Supabase SQL editor after the main marketplace migration.

-- 1. Add views column to marketplace_listings (for functional viewed counter)
ALTER TABLE IF EXISTS public.marketplace_listings
  ADD COLUMN IF NOT EXISTS views integer DEFAULT 0;

-- Backfill
UPDATE public.marketplace_listings SET views = COALESCE(views, 0) WHERE views IS NULL;

-- 2. Add question column to bids (for "question to the seller")
ALTER TABLE IF EXISTS public.bids
  ADD COLUMN IF NOT EXISTS question text;

-- Optional: also allow question on request bids if needed (already supports via notes or this)
-- No change to RLS needed; the existing policies allow the columns.

-- Verify (optional):
-- SELECT column_name, data_type FROM information_schema.columns 
-- WHERE table_name IN ('marketplace_listings', 'bids') AND column_name IN ('views', 'question');

-- Refresh PostgREST schema cache (safe in plain SQL)
NOTIFY pgrst, 'reload schema';
