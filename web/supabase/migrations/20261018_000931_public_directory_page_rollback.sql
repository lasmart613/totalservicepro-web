-- Rollback for 000931. Drops public.public_directory_page (it did not exist
-- before 000931). No data changes. Refuses to drop a same-named function that
-- 000931 did not create. After rollback, deploy the previous /api/directory
-- or the guest directory preview returns 503.
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'public_directory_page'
      AND coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), '') NOT LIKE '000931:%'
  ) THEN
    RAISE EXCEPTION '000931 rollback refused: public.public_directory_page was not created by 000931';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.public_directory_page(text[], integer, integer);
