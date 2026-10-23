-- Rollback for 000941. Exact: drops only what 000941 created (checks the
-- '000941' COMMENT markers first). WARNING: forgets every org's sending
-- domain row. The domains stay in the Resend account; remove them in the app
-- (Remove domain) or the Resend dashboard first if retiring the feature.
-- CRM email then falls back to "<Name> via RepairPlanet". Re-runnable.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.org_sending_domains') IS NOT NULL
     AND coalesce(obj_description(to_regclass('public.org_sending_domains'), 'pg_class'), '') NOT LIKE '000941%' THEN
    RAISE EXCEPTION '000941 rollback: public.org_sending_domains was not created by 000941';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'org_sending_domain_claim_verify'
      AND coalesce(obj_description(p.oid, 'pg_proc'), '') NOT LIKE '000941%') THEN
    RAISE EXCEPTION '000941 rollback: org_sending_domain_claim_verify was not created by 000941';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.org_sending_domain_claim_verify(bigint);
DROP TABLE IF EXISTS public.org_sending_domains;

COMMIT;
