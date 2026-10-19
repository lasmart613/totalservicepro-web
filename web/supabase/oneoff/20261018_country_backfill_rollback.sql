-- Rollback for 20261018_country_backfill.sql: puts back the backed-up
-- country / prospect_pool for every row under label 'country-backfill-1018'.
-- Rows edited by a user after the backfill (value no longer the backfill
-- value) are still restored to their pre-backfill value; check first with
-- the SELECT below if that matters. Backup rows are kept.
BEGIN;
SET LOCAL lock_timeout = '5s';

SELECT count(*) AS rows_to_restore FROM public.migration_backup
 WHERE label = 'country-backfill-1018' AND source_table = 'organizations';

UPDATE public.organizations o
   SET country = m.row_data->>'country',
       prospect_pool = m.row_data->>'prospect_pool'
  FROM public.migration_backup m
 WHERE m.label = 'country-backfill-1018' AND m.source_table = 'organizations'
   AND o.id = (m.row_data->>'id')::bigint;

COMMIT;
