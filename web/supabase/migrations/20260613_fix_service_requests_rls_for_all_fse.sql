-- Fix RLS for service_requests so that ALL FSE / pro accounts (any authenticated role that the app treats as bidder)
-- can see open/bidding service needs posted by any owner/facility, regardless of organization.
-- This enables the marketplace vision: FSEs and service companies browse and bid privately on jobs.
-- Bids themselves remain private (only owner of request + bidder see via their policies).
--
-- Previous policy was too narrow on roles (missed company_admin etc) and used subquery that could hide rows
-- if profile.role not exact match or cache issues.
--
-- Also ensure title column (used for facility display when no org join) is selectable (code updated separately).
--
-- IMPORTANT: This must be run AFTER the corrected 20260611 migration (which now uses bigint for organization_id
-- to match the existing public.organizations.id column type, which is bigint not uuid).
-- If you saw the "foreign key ... uuid and bigint" error, re-run the fixed 20260611_...sql first (it uses
-- CREATE TABLE IF NOT EXISTS so it is safe to re-run), then run this file.

-- Drop the narrow pro view policy and replace with a simple one: any authenticated can read open/bidding needs.
-- (App code gates the "Respond/Bid" UI to isPro = fse/engineer/service_manager/company_admin etc.)
-- Use a guard so this file doesn't hard-fail if the table doesn't exist yet (run 20260611 first!).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'service_requests'
  ) THEN
    DROP POLICY IF EXISTS "Service pros can view open requests" ON public.service_requests;
  END IF;
END $$;

-- The CREATE POLICY below will only succeed if the table exists (from the 20260611 migration).
CREATE POLICY "Anyone authenticated can view open service needs (for bidding)" ON public.service_requests
  FOR SELECT TO authenticated
  USING (status IN ('open', 'bidding'));

-- Keep owners policy as-is for management (they see their own even if not open, can update etc.)
-- The FOR ALL on owners is scoped to their org via the subselect.

-- Optionally, if you want stricter (only known pro roles can see open), use this instead:
-- CREATE POLICY "Service pros can view open requests" ON public.service_requests
--   FOR SELECT TO authenticated
--   USING (
--     status IN ('open', 'bidding') AND
--     (SELECT role FROM public.user_profiles WHERE id = auth.uid()) IN ('fse','engineer','service_manager','company_admin','admin','dispatcher')
--   );

-- Make sure the table has the expected columns (title was in original 20260611 migration)
-- If any deploys missed columns, this is safe:
ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS title text;

-- Also ensure other marketplace columns from original migration exist (defensive, harmless if present)
ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text;

-- Refresh PostgREST schema cache so new policy takes effect immediately
NOTIFY pgrst, 'reload schema';

-- After running this in Supabase SQL editor:
-- 1. Confirm no errors.
-- 2. Test: Post a need as Owner (with facility name), log out, log in as FSE (or company_admin), go to /marketplace -- should see it with real facility name (not Anonymous).
-- 3. FSE should be able to open bid form (if role matches isPro).
