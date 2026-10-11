-- Rollback for 20261011_000911_manuals_published.sql.
-- Restores the previous search function and SELECT policies before dropping
-- the column. A function or policy that still references published would
-- block the drop.
--
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- The migration runner applies this file as one transaction. Safe to re-run.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.search_manual_catalog(q text)
RETURNS TABLE(manual_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.manual_id
  FROM public.manual_search_index i
  WHERE nullif(btrim(q), '') IS NOT NULL
    AND char_length(btrim(q)) >= 2
    AND (
      i.search_tsv @@ plainto_tsquery('simple', q)
      OR i.search_text ILIKE '%' || replace(replace(btrim(q), '%', ''), '_', '') || '%'
    );
$$;

COMMENT ON FUNCTION public.search_manual_catalog(text) IS
  'Returns catalog ids (bigint) whose indexed PDF body matches q. Does not return search_text. Does not filter by ownership.';

DROP TRIGGER IF EXISTS manuals_guard_published ON public.manuals;
DROP FUNCTION IF EXISTS public.manuals_guard_published();

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT p.polname
    FROM pg_policy AS p
    JOIN pg_class AS c ON c.oid = p.polrelid
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'manuals'
      AND p.polcmd = 'r'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.manuals', pol.polname);
  END LOOP;
END $$;

CREATE POLICY "Anyone can read manuals"
  ON public.manuals
  FOR SELECT
  USING (true);

CREATE POLICY "Authenticated can read manuals"
  ON public.manuals
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can view manuals"
  ON public.manuals
  FOR SELECT
  TO authenticated
  USING (true);

ALTER TABLE public.manuals DROP COLUMN IF EXISTS published;

NOTIFY pgrst, 'reload schema';
