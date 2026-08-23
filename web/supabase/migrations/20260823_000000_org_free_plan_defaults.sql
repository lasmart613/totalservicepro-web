-- Free Plan orgs must not default to paid. New inserts from signup now also
-- set is_premium = false. This only changes the column default; it does not
-- rewrite existing rows (a real premium org may only have is_premium = true).
--
-- APPLY ON LIVE SUPABASE (SQL Editor or CLI) if new orgs still come back
-- is_premium = true when the app insert omits the column.
-- This repo does not auto-apply SQL.

ALTER TABLE public.organizations
  ALTER COLUMN is_premium SET DEFAULT false;

NOTIFY pgrst, 'reload schema';
