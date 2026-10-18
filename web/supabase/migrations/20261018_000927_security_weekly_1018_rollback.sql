SET LOCAL lock_timeout = '5s';

-- Rollback for 20261018_000927_security_weekly_1018.sql. Restores the live
-- policies read on 2026-10-18 verbatim and removes the 000927 objects.
-- Reservation rows already written to api_usage are ordinary usage rows and
-- are kept (they count toward the old cap exactly like logUsage rows).

DROP POLICY IF EXISTS logos_admin_insert ON storage.objects;
DROP POLICY IF EXISTS logos_admin_update ON storage.objects;
DROP POLICY IF EXISTS logos_admin_delete ON storage.objects;

DROP POLICY IF EXISTS "Allow authenticated logo uploads" ON storage.objects;
CREATE POLICY "Allow authenticated logo uploads" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'logos'::text);

DROP POLICY IF EXISTS "Allow authenticated logo updates" ON storage.objects;
CREATE POLICY "Allow authenticated logo updates" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'logos'::text);

UPDATE storage.buckets SET allowed_mime_types = NULL WHERE id = 'logos';

DROP FUNCTION IF EXISTS public.logo_object_writable(text);
DROP FUNCTION IF EXISTS public.ai_usage_reserve(uuid, text, integer);
DROP FUNCTION IF EXISTS public.ai_usage_release(uuid, uuid);

DROP POLICY IF EXISTS organization_memberships_delete_own ON public.organization_memberships;
CREATE POLICY organization_memberships_delete_own ON public.organization_memberships
  FOR DELETE TO authenticated
  USING ((user_id = auth.uid()) AND (is_home = false));

SELECT '000927 rollback ok' AS status;
