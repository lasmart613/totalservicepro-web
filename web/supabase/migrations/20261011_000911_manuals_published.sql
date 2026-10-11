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
--   * REVOKE UPDATE (published) is recorded below, but it is a no-op while
--     anon or authenticated holds table-level UPDATE. A table grant covers
--     every column, so revoking the column privilege does not take it away.
--   * manuals_guard_published is the real guard. It rejects a published
--     change from every role except service_role, a superuser, and the
--     table owner. God is not a database role. The God toggle checks the
--     allowlist in the app, then updates with the service role.
-- service_role has BYPASSRLS, so edge functions and the search API filter
-- published in code. search_manual_catalog is SECURITY DEFINER and filters
-- here, because it would otherwise ignore the new SELECT policies.
--
-- Deploy order: user-JWT reads hide unpublished as soon as this file commits.
-- Readers retry without the filter only when Postgres reports undefined_column
-- (42703) for published. 42702, 42501, and any other error are not a missing
-- column and do not drop the filter. Apply this file before expecting
-- unpublished rows to disappear. Redeploy get-manual-url and grok-assistant
-- after it, or those service-role readers still see unpublished rows.
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

-- REVOKE UPDATE (published) does not stick while table-level UPDATE remains,
-- so this trigger is the guard. service_role, superusers, and the table
-- owner may change the column. Everyone else (authenticated, anon, and any
-- other non-God role) may insert the default true and may update other
-- columns, but cannot change published.
CREATE OR REPLACE FUNCTION public.manuals_guard_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  privileged boolean;
BEGIN
  SELECT
    r.rolsuper
    OR r.rolname = 'service_role'
    OR r.oid = c.relowner
  INTO privileged
  FROM pg_roles AS r
  JOIN pg_class AS c ON c.relname = 'manuals'
  JOIN pg_namespace AS n ON n.oid = c.relnamespace AND n.nspname = 'public'
  WHERE r.rolname = current_user;

  IF COALESCE(privileged, false) THEN
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
  'BEFORE INSERT OR UPDATE, SECURITY INVOKER. The real guard for manuals.published: REVOKE UPDATE (published) is a no-op while a role holds table-level UPDATE. service_role, superusers, and the table owner can change the column. Every other role cannot.';

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
