-- Rollback for 000936. Exact: drops only what 000936 created (COMMENT '000936...'
-- markers are checked first) and leaves organization_manuals data as is.
-- WARNING: drops the manual_library_events ledger (adds/removes/reads). Export it
-- first if you need the audit trail. After rollback the web/edge code keeps
-- working: the RPC calls fail soft (Remove falls back to a plain delete, the
-- held-slot count reads as 0, page/url reports are dropped).
-- Re-runnable.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.manual_library_events') IS NOT NULL
     AND coalesce(obj_description(to_regclass('public.manual_library_events'), 'pg_class'), '') NOT LIKE '000936%' THEN
    RAISE EXCEPTION '000936 rollback: public.manual_library_events was not created by 000936';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('manual_library_remove','manual_library_status','manual_record_access',
                        'manual_record_url_issued','manual_slots_held','manual_refund_check',
                        'manual_library_log_add','manual_library_log_delete',
                        'manual_library_guard_insert','manual_slot_is_held',
                        'manual_page_count_guard','manual_page_count_from_index')
      AND coalesce(obj_description(p.oid, 'pg_proc'), '') NOT LIKE '000936%') THEN
    RAISE EXCEPTION '000936 rollback: a manual library function was not created by 000936';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.organization_manuals'::regclass AND attname = 'source' AND NOT attisdropped)
     AND coalesce(col_description('public.organization_manuals'::regclass,
           (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.organization_manuals'::regclass AND attname = 'source')), '')
         NOT LIKE '000936%' THEN
    RAISE EXCEPTION '000936 rollback: organization_manuals.source was not created by 000936';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.manuals'::regclass AND attname = 'page_count' AND NOT attisdropped)
     AND coalesce(col_description('public.manuals'::regclass,
           (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.manuals'::regclass AND attname = 'page_count')), '')
         NOT LIKE '000936%' THEN
    RAISE EXCEPTION '000936 rollback: manuals.page_count was not created by 000936';
  END IF;
END $$;

DROP TRIGGER IF EXISTS manuals_page_count_guard ON public.manuals;
DO $$ BEGIN
  IF to_regclass('public.manual_search_index') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS manual_search_index_page_count ON public.manual_search_index';
  END IF;
END $$;
DROP TRIGGER IF EXISTS organization_manuals_log_add ON public.organization_manuals;
DROP TRIGGER IF EXISTS organization_manuals_log_delete ON public.organization_manuals;
DROP TRIGGER IF EXISTS organization_manuals_guard_insert ON public.organization_manuals;

DROP FUNCTION IF EXISTS public.manual_library_remove(bigint, text);
DROP FUNCTION IF EXISTS public.manual_library_status(bigint);
DROP FUNCTION IF EXISTS public.manual_record_access(bigint, text, integer[], integer, text);
DROP FUNCTION IF EXISTS public.manual_record_url_issued(bigint, bigint, uuid, text);
DROP FUNCTION IF EXISTS public.manual_slots_held(bigint);
DROP FUNCTION IF EXISTS public.manual_refund_check(bigint, bigint, timestamptz, bigint);
DROP FUNCTION IF EXISTS public.manual_slot_is_held(bigint, bigint);
DROP FUNCTION IF EXISTS public.manual_library_guard_insert();
DROP FUNCTION IF EXISTS public.manual_page_count_guard();
DROP FUNCTION IF EXISTS public.manual_page_count_from_index();
DROP FUNCTION IF EXISTS public.manual_library_log_add();
DROP FUNCTION IF EXISTS public.manual_library_log_delete();

ALTER TABLE public.manuals DROP CONSTRAINT IF EXISTS manuals_page_count_check;
ALTER TABLE public.manuals DROP COLUMN IF EXISTS page_count;  -- backfilled values are derived; nothing lost
ALTER TABLE public.organization_manuals DROP CONSTRAINT IF EXISTS organization_manuals_source_check;
ALTER TABLE public.organization_manuals DROP COLUMN IF EXISTS source;

DROP TABLE IF EXISTS public.manual_library_events;

-- Restore the prod ACL 000936 checked before revoking (anon=rm, authenticated=arwdm).
-- WARNING: this re-opens direct client INSERT (the QA #332 MEDIUM).
GRANT MAINTAIN ON TABLE public.organization_manuals TO anon;
GRANT INSERT, UPDATE, MAINTAIN ON TABLE public.organization_manuals TO authenticated;

COMMIT;
