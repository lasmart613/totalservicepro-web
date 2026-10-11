-- Hide a manual from the library, search, and AI assistant without deleting it.
--
-- public.manuals.published boolean NOT NULL DEFAULT true.
-- Adding a NOT NULL column with a constant default is metadata-only on PG11+.
-- Existing rows become published. The add is metadata-only: no table rewrite and no new index.
--
-- 000911 is the next free number after 000910 on main. 000909 and 000910 exist.
--
-- Live RLS (read 2026-10-11 on yljztfajyvjzqikxdddf) is SELECT only:
--   "Anyone can read manuals"          PUBLIC          USING (true)
--   "Authenticated can read manuals"   authenticated   USING (true)
--   "Authenticated can view manuals"   authenticated   USING (true)
-- There is no INSERT/UPDATE/DELETE policy, so a signed-in client cannot
-- update a row today even though authenticated has table UPDATE. This file
-- still blocks the column:
--   * SELECT policies require published = true (user JWT / anon).
--   * UPDATE (published) is revoked from anon and authenticated.
--   * manuals_guard_published rejects a change from those roles if a later
--     policy or grant lets a client write the table.
-- service_role and the table owner (postgres, SQL editor, migration role)
-- bypass the guard. God is not a database role. The God toggle checks the
-- allowlist in the app, then updates with the service role.
-- service_role has BYPASSRLS, so edge functions and the search API filter
-- published in code. search_manual_catalog is SECURITY DEFINER and filters
-- here, because it would otherwise ignore the new SELECT policies.
--
-- Deploy order: this migration can land before the app code. User-JWT reads
-- hide unpublished as soon as it commits. The app tolerates a missing
-- column (retries without the filter, treats a missing flag as published),
-- so a web deploy that arrives first keeps the library up. Apply this file
-- before expecting unpublished rows to disappear. Redeploy get-manual-url
-- and grok-assistant after it, or those service-role readers still see
-- unpublished rows.
--
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- The migration runner applies this file as one transaction. Safe to re-run.
-- Do not apply from the app deploy.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.manuals
  ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT true;

ALTER TABLE public.manuals ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.manuals.published IS
  'False hides the row from library lists, search, and the AI assistant. God and service_role still see it. Clients cannot change it.';

-- Replace every SELECT policy. A leftover USING (true) policy would keep
-- unpublished rows visible to anon/authenticated.
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
  USING (published = true);

CREATE POLICY "Authenticated can read manuals"
  ON public.manuals
  FOR SELECT
  TO authenticated
  USING (published = true);

CREATE POLICY "Authenticated can view manuals"
  ON public.manuals
  FOR SELECT
  TO authenticated
  USING (published = true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE UPDATE (published) ON TABLE public.manuals FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE UPDATE (published) ON TABLE public.manuals FROM authenticated;
  END IF;
END $$;

-- Same shape as user_profiles_guard_identity: only anon/authenticated are
-- policed. service_role, postgres, and SECURITY DEFINER owners return NEW.
CREATE OR REPLACE FUNCTION public.manuals_guard_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.published IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'published cannot be changed'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.published IS DISTINCT FROM OLD.published THEN
    RAISE EXCEPTION 'published cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.manuals_guard_published() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT EXECUTE ON FUNCTION public.manuals_guard_published() TO anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.manuals_guard_published() TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.manuals_guard_published() TO service_role;
  END IF;
END $$;

COMMENT ON FUNCTION public.manuals_guard_published() IS
  'BEFORE INSERT OR UPDATE, SECURITY INVOKER. anon and authenticated cannot set or change manuals.published. service_role and the table owner can.';

DROP TRIGGER IF EXISTS manuals_guard_published ON public.manuals;
CREATE TRIGGER manuals_guard_published
  BEFORE INSERT OR UPDATE ON public.manuals
  FOR EACH ROW
  EXECUTE FUNCTION public.manuals_guard_published();

-- SECURITY DEFINER bypasses the SELECT policies above.
CREATE OR REPLACE FUNCTION public.search_manual_catalog(q text)
RETURNS TABLE(manual_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.manual_id
  FROM public.manual_search_index i
  JOIN public.manuals m ON m.id = i.manual_id
  WHERE m.published = true
    AND nullif(btrim(q), '') IS NOT NULL
    AND char_length(btrim(q)) >= 2
    AND (
      i.search_tsv @@ plainto_tsquery('simple', q)
      OR i.search_text ILIKE '%' || replace(replace(btrim(q), '%', ''), '_', '') || '%'
    );
$$;

COMMENT ON FUNCTION public.search_manual_catalog(text) IS
  'Returns catalog ids (bigint) whose indexed PDF body matches q and whose manual is published. Does not return search_text. Does not filter by ownership.';

NOTIFY pgrst, 'reload schema';
