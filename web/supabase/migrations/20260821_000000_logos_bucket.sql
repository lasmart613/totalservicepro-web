-- Ensure the public `logos` bucket used by Company Profile, onboarding,
-- and Directory Add Customer (organizations.logo_url).
--
-- Production already uploads to this bucket from Company Profile. This
-- migration is idempotent. If the PR cannot apply it automatically:
--
--   1. Supabase Dashboard → SQL Editor → paste this file → Run
--   2. Or Storage → New bucket named exactly `logos`, Public = ON
--
-- `organizations.logo_url` already exists — no column change, no data wipe.

INSERT INTO storage.buckets (id, name, public)
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS logos_auth_upload ON storage.objects;
CREATE POLICY logos_auth_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'logos');

DROP POLICY IF EXISTS logos_auth_update ON storage.objects;
CREATE POLICY logos_auth_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'logos');

DROP POLICY IF EXISTS logos_public_read ON storage.objects;
CREATE POLICY logos_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'logos');

DROP POLICY IF EXISTS logos_auth_delete ON storage.objects;
CREATE POLICY logos_auth_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'logos');

SELECT 'ok' AS status;
