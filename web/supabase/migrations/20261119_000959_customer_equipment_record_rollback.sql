-- Rollback 000959. Drops only the three columns that file added.
-- Does not drop public.equipment, location_id, or any ticket / report link.
-- Repo only. Do not run against a live database from the pull request.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.equipment DROP COLUMN IF EXISTS removed_at;
ALTER TABLE public.equipment DROP COLUMN IF EXISTS warranty_or_contract;
ALTER TABLE public.equipment DROP COLUMN IF EXISTS install_date;

COMMIT;
NOTIFY pgrst, 'reload schema';
