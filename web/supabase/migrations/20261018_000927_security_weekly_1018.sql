SET LOCAL lock_timeout = '5s';

-- 000927: weekly security review 2026-10-18.
--
--   HIGH 1  logos bucket writes. Live INSERT/UPDATE policies
--           ("Allow authenticated logo uploads" / "Allow authenticated logo
--           updates") checked only bucket_id, so any signed-in user could
--           overwrite any org's logo object. Replaced by logos_admin_insert /
--           logos_admin_update / logos_admin_delete, gated on
--           public.logo_object_writable(name):
--             * first folder = an org id where the caller is owner /
--               company_admin / admin, or an org that is a CRM customer
--               (organization_customers) of a shop the caller administers
--               (Directory "Add customer" uploads to logos/{customerId}/);
--             * first folder = the caller's own auth uid (onboarding uploads
--               logos/{uid}/onboard-logo-*, before the org row exists).
--           Live layout read 2026-10-18: 12 objects {orgId}/, 7 {uid}/,
--           2 legacy parts/{uid}/ (old part-photo fallback, no longer
--           written to logos). Reads (logos_member_read) are unchanged.
--           Server-side type check: storage.buckets.allowed_mime_types for
--           logos = png / jpeg / webp (live value was NULL = any type, so an
--           SVG with script could be uploaded straight to the API). 0 SVG
--           objects and 0 SVG organizations.logo_url live (2026-10-18).
--   MEDIUM 3 public.ai_usage_reserve / ai_usage_release: atomic daily cap
--           for grok-assistant (advisory xact lock per user+type, count,
--           insert reservation row). service_role EXECUTE only.
--   LOW     organization_memberships_delete_own dropped. Leaving an org goes
--           through public.leave_organization (SECURITY DEFINER, live) and
--           server routes use the service role; nothing in the app deletes
--           memberships with a user JWT.
--
-- Replaced live objects (read 2026-10-18), restored verbatim by the rollback.
-- Policy fingerprint = md5(coalesce(qual,'') || '|' || coalesce(with_check,'')):
--   storage.objects "Allow authenticated logo uploads"  (INSERT)  1eb717041618acedadfe689193b91c26
--   storage.objects "Allow authenticated logo updates"  (UPDATE)  1734a127a8a762408f2f9f4baad62c24
--   public.organization_memberships organization_memberships_delete_own  c07f80daae380e196fa5f31dcd38357a
--   storage.buckets 'logos' allowed_mime_types NULL (rollback restores NULL)
-- Repo-only names logos_auth_upload/update/delete (20260821) are not live;
-- if present they must be the bucket-only form and are dropped too.
-- Idempotent (safe to re-run).
-- Rollback: 20261018_000927_security_weekly_1018_rollback.sql
-- Proof: web/supabase/tests/20261018_security_weekly_1018.sql

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL
     OR to_regclass('public.organization_memberships') IS NULL
     OR to_regclass('public.organization_customers') IS NULL
     OR to_regclass('public.api_usage') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                    WHERE attrelid = 'public.api_usage'::regclass AND attname = 'tokens_used' AND NOT attisdropped) THEN
    RAISE EXCEPTION '000927: expected storage.objects, organization_memberships, organization_customers, api_usage';
  END IF;
END $$;

-- Drift guards: each replaced policy is absent or has the recorded live form.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT pol.polname::text AS name,
           md5(coalesce(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '') || '|' ||
               coalesce(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), '')) AS fp
    FROM pg_catalog.pg_policy pol
    WHERE pol.polrelid = 'storage.objects'::regclass
      AND pol.polname IN ('Allow authenticated logo uploads', 'Allow authenticated logo updates',
                          'logos_auth_upload', 'logos_auth_update', 'logos_auth_delete')
  LOOP
    IF NOT (
      (r.name IN ('Allow authenticated logo uploads', 'logos_auth_upload') AND r.fp = '1eb717041618acedadfe689193b91c26')
      OR (r.name IN ('Allow authenticated logo updates', 'logos_auth_update', 'logos_auth_delete') AND r.fp = '1734a127a8a762408f2f9f4baad62c24')
    ) THEN
      RAISE EXCEPTION '000927: storage.objects policy % differs from the recorded live form (%); refusing to replace', r.name, r.fp;
    END IF;
  END LOOP;

  FOR r IN
    SELECT pol.polname::text AS name,
           md5(coalesce(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '') || '|' ||
               coalesce(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), '')) AS fp
    FROM pg_catalog.pg_policy pol
    WHERE pol.polrelid = 'public.organization_memberships'::regclass
      AND pol.polname = 'organization_memberships_delete_own'
  LOOP
    IF r.fp <> 'c07f80daae380e196fa5f31dcd38357a' THEN
      RAISE EXCEPTION '000927: organization_memberships_delete_own differs from the recorded live form (%); refusing to drop', r.fp;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM storage.buckets b WHERE b.id = 'logos'
             AND b.allowed_mime_types IS NOT NULL
             AND b.allowed_mime_types <> ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]) THEN
    RAISE EXCEPTION '000927: logos bucket allowed_mime_types differs from the recorded live value (NULL); refusing to replace';
  END IF;

  -- New function names must be free or this migration's own (re-run).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname IN ('logo_object_writable', 'ai_usage_reserve', 'ai_usage_release')
               AND coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), '') NOT LIKE '000927:%') THEN
    RAISE EXCEPTION '000927: a function named logo_object_writable / ai_usage_reserve / ai_usage_release already exists and is not from 000927';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- HIGH 1: logos writes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.logo_object_writable(object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  parts text[];
  head text;
  org_id bigint;
BEGIN
  IF uid IS NULL OR object_name IS NULL OR btrim(object_name) = '' THEN
    RETURN false;
  END IF;
  IF position('..' in object_name) > 0 OR left(object_name, 1) = '/' THEN
    RETURN false;
  END IF;
  parts := storage.foldername(object_name);
  IF parts IS NULL OR array_length(parts, 1) IS NULL THEN
    RETURN false;   -- bucket root: never writable
  END IF;
  head := parts[1];

  -- Onboarding: the caller's own uid folder.
  IF head = uid::text THEN
    RETURN true;
  END IF;

  IF head !~ '^[0-9]{1,18}$' THEN
    RETURN false;
  END IF;
  org_id := head::bigint;

  IF EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.user_id = uid
      AND m.organization_id = org_id
      AND lower(btrim(coalesce(m.role, ''))) IN ('owner', 'company_admin', 'admin')
  ) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.organization_customers oc
    JOIN public.organization_memberships m
      ON m.organization_id = oc.service_organization_id
    WHERE oc.customer_organization_id = org_id
      AND m.user_id = uid
      AND lower(btrim(coalesce(m.role, ''))) IN ('owner', 'company_admin', 'admin')
  );
END;
$$;

COMMENT ON FUNCTION public.logo_object_writable(text) IS
  '000927: logos write check. {orgId}/ for an org the caller administers (owner/company_admin/admin) or a CRM customer of such a shop; {auth.uid()}/ for onboarding.';

REVOKE ALL ON FUNCTION public.logo_object_writable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logo_object_writable(text) TO authenticated;

DROP POLICY IF EXISTS "Allow authenticated logo uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated logo updates" ON storage.objects;
DROP POLICY IF EXISTS logos_auth_upload ON storage.objects;
DROP POLICY IF EXISTS logos_auth_update ON storage.objects;
DROP POLICY IF EXISTS logos_auth_delete ON storage.objects;
DROP POLICY IF EXISTS logos_admin_insert ON storage.objects;
DROP POLICY IF EXISTS logos_admin_update ON storage.objects;
DROP POLICY IF EXISTS logos_admin_delete ON storage.objects;

CREATE POLICY logos_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'logos' AND public.logo_object_writable(name));

CREATE POLICY logos_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'logos' AND public.logo_object_writable(name))
  WITH CHECK (bucket_id = 'logos' AND public.logo_object_writable(name));

CREATE POLICY logos_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'logos' AND public.logo_object_writable(name));

-- No SVG (or any non-raster type) through the Storage API.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
WHERE id = 'logos';

-- ---------------------------------------------------------------------------
-- MEDIUM 3: atomic grok-assistant daily cap
-- ---------------------------------------------------------------------------
-- Reserve one slot for (user, type) today (UTC). Serialised per user+type by
-- a transaction advisory lock, so concurrent calls cannot both pass the cap.
-- Returns {ok, used, limit, id}; used counts today's rows including the new
-- reservation. ok=false (no row written) when the cap is reached.
CREATE OR REPLACE FUNCTION public.ai_usage_reserve(p_user_id uuid, p_request_type text, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  day_start timestamp := date_trunc('day', now() AT TIME ZONE 'utc');
  n integer;
  new_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'ai_usage_reserve: user required' USING ERRCODE = '22023';
  END IF;
  IF p_request_type IS NULL OR p_request_type NOT IN ('grok_chat', 'grok_tts') THEN
    RAISE EXCEPTION 'ai_usage_reserve: unknown request type' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 0 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'ai_usage_reserve: bad limit' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('tsp.ai_usage:' || p_user_id::text || ':' || p_request_type, 0));

  SELECT count(*)::integer INTO n
  FROM public.api_usage u
  WHERE u.user_id = p_user_id
    AND u.request_type = p_request_type
    AND u.created_at >= day_start;

  IF n >= p_limit THEN
    RETURN jsonb_build_object('ok', false, 'used', n, 'limit', p_limit);
  END IF;

  INSERT INTO public.api_usage (id, user_id, request_type, tokens_used, created_at)
  VALUES (gen_random_uuid(), p_user_id, p_request_type, 0, now() AT TIME ZONE 'utc')
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('ok', true, 'used', n + 1, 'limit', p_limit, 'id', new_id);
END;
$$;

COMMENT ON FUNCTION public.ai_usage_reserve(uuid, text, integer) IS
  '000927: atomic daily AI cap. Reserve one api_usage row for (user, type) today (UTC) when under p_limit. service_role only.';

-- Refund a reservation whose upstream call failed. Only an unfinalised row
-- (tokens_used = 0) of that user is removed.
CREATE OR REPLACE FUNCTION public.ai_usage_release(p_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  k integer;
BEGIN
  DELETE FROM public.api_usage u
  WHERE u.id = p_id AND u.user_id = p_user_id AND u.tokens_used = 0;
  GET DIAGNOSTICS k = ROW_COUNT;
  RETURN k > 0;
END;
$$;

COMMENT ON FUNCTION public.ai_usage_release(uuid, uuid) IS
  '000927: refund an unfinalised ai_usage_reserve row (upstream failure). service_role only.';

REVOKE ALL ON FUNCTION public.ai_usage_reserve(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_usage_release(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_usage_reserve(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_usage_release(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- LOW: drop the direct self-delete of memberships
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS organization_memberships_delete_own ON public.organization_memberships;

SELECT '000927 ok' AS status;
