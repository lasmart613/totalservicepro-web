-- Cross-shop reads of jobs, equipment, photos, and logos.
--
-- Confirmed in this repo (live policies are the last migration that created them):
--   * equipment_authenticated_select is FOR SELECT TO authenticated USING (true),
--     so any signed-in user can read every shop's equipment row, including photo_url.
--   * equipment-photos is a public bucket and equipment_photos_public_read is
--     FOR SELECT TO public USING (bucket_id = 'equipment-photos'), so any signed-in
--     user can list and download every equipment photo.
--   * logos has the same shape (public bucket + SELECT using only bucket_id), so
--     any signed-in user can list every logo object.
--   * service_tickets has no membership policy in migrations. Client screens filter
--     by organization_id, which a direct PostgREST request skips.
--   * service_requests SELECT allows every authenticated user to read full rows
--     in status open/bidding, including images, equipment_id, serial_number, and
--     contacts. Open/bidding requests stay listable for the existing bid screen,
--     but only through a column list that omits those private fields.
--
-- Membership is organization_memberships.user_id = auth.uid(). Not user_profiles.email.
-- God access is unchanged: the service role bypasses RLS and is not granted here.
--
-- APPLY ON LIVE SUPABASE (SQL Editor or CLI). Safe to re-run. Does not wipe rows.

-- ---------------------------------------------------------------------------
-- 1) Membership predicate. Auth user id only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_member_of_org(org_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships m
      WHERE m.user_id = auth.uid()
        AND m.organization_id = org_id
    );
$$;

COMMENT ON FUNCTION public.auth_member_of_org(bigint) IS
  'True when auth.uid() has an organization_memberships row for org_id. Ignores user_profiles.email.';

REVOKE ALL ON FUNCTION public.auth_member_of_org(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_member_of_org(bigint) TO authenticated;

-- First folder, or the folder after "equipment/", when it is a numeric org id.
CREATE OR REPLACE FUNCTION public.storage_org_id_from_name(object_name text)
RETURNS bigint
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  parts text[];
  candidate text;
BEGIN
  IF object_name IS NULL OR btrim(object_name) = '' THEN
    RETURN NULL;
  END IF;
  parts := storage.foldername(object_name);
  IF parts IS NULL OR array_length(parts, 1) IS NULL THEN
    RETURN NULL;
  END IF;
  IF parts[1] = 'equipment' AND array_length(parts, 1) >= 2 THEN
    candidate := parts[2];
  ELSE
    candidate := parts[1];
  END IF;
  IF candidate ~ '^[0-9]+$' THEN
    RETURN candidate::bigint;
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.storage_org_id_from_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_org_id_from_name(text) TO authenticated;

-- Logo object: member, creator, CRM service shop, or the current file of a
-- directory / storefront listing. Does not allow listing every object in the bucket.
CREATE OR REPLACE FUNCTION public.logo_object_readable(object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id bigint;
  published boolean := false;
BEGIN
  org_id := public.storage_org_id_from_name(object_name);
  IF org_id IS NULL OR auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF public.auth_member_of_org(org_id) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = org_id
      AND o.created_by = auth.uid()
  ) THEN
    RETURN true;
  END IF;

  IF to_regclass('public.organization_customers') IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.organization_customers oc
    WHERE oc.customer_organization_id = org_id
      AND public.auth_member_of_org(oc.service_organization_id)
  ) THEN
    RETURN true;
  END IF;

  BEGIN
    EXECUTE
      'SELECT (COALESCE(o.list_in_directory, false) OR COALESCE(o.storefront_enabled, false))
         AND o.logo_url IS NOT NULL
         AND position($2 in o.logo_url) > 0
       FROM public.organizations o
       WHERE o.id = $1'
      INTO published
      USING org_id, object_name;
  EXCEPTION WHEN undefined_column THEN
    BEGIN
      EXECUTE
        'SELECT COALESCE(o.list_in_directory, false)
           AND o.logo_url IS NOT NULL
           AND position($2 in o.logo_url) > 0
         FROM public.organizations o
         WHERE o.id = $1'
        INTO published
        USING org_id, object_name;
    EXCEPTION WHEN undefined_column THEN
      published := false;
    END;
  END;

  RETURN COALESCE(published, false);
END;
$$;

COMMENT ON FUNCTION public.logo_object_readable(text) IS
  'Storage read for one logos object. Membership, CRM link, or the published directory/storefront file. Not user_profiles.email.';

REVOKE ALL ON FUNCTION public.logo_object_readable(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.logo_object_readable(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Equipment rows: members of customer_organization_id only.
-- ---------------------------------------------------------------------------
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS equipment_authenticated_select ON public.equipment;
DROP POLICY IF EXISTS equipment_member_select ON public.equipment;

CREATE POLICY equipment_member_select ON public.equipment
  FOR SELECT
  TO authenticated
  USING (public.auth_member_of_org(customer_organization_id));

-- ---------------------------------------------------------------------------
-- 3) Equipment photos: private bucket, member path only.
-- ---------------------------------------------------------------------------
UPDATE storage.buckets
SET public = false
WHERE id = 'equipment-photos';

DROP POLICY IF EXISTS equipment_photos_public_read ON storage.objects;
DROP POLICY IF EXISTS equipment_photos_auth_upload ON storage.objects;
DROP POLICY IF EXISTS equipment_photos_auth_update ON storage.objects;
DROP POLICY IF EXISTS equipment_photos_auth_delete ON storage.objects;
DROP POLICY IF EXISTS equipment_photos_member_read ON storage.objects;
DROP POLICY IF EXISTS equipment_photos_member_insert ON storage.objects;
DROP POLICY IF EXISTS equipment_photos_member_update ON storage.objects;
DROP POLICY IF EXISTS equipment_photos_member_delete ON storage.objects;

CREATE POLICY equipment_photos_member_read ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'equipment-photos'
    AND public.auth_member_of_org(public.storage_org_id_from_name(name))
  );

CREATE POLICY equipment_photos_member_insert ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'equipment-photos'
    AND public.auth_member_of_org(public.storage_org_id_from_name(name))
  );

CREATE POLICY equipment_photos_member_update ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'equipment-photos'
    AND public.auth_member_of_org(public.storage_org_id_from_name(name))
  )
  WITH CHECK (
    bucket_id = 'equipment-photos'
    AND public.auth_member_of_org(public.storage_org_id_from_name(name))
  );

CREATE POLICY equipment_photos_member_delete ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'equipment-photos'
    AND public.auth_member_of_org(public.storage_org_id_from_name(name))
  );

-- ---------------------------------------------------------------------------
-- 4) Logos: stop listing the whole bucket. Published directory/storefront
--    files stay readable by signed-in users. The bucket stays public so
--    existing onboarding, email, and storefront image URLs keep resolving.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS logos_public_read ON storage.objects;
DROP POLICY IF EXISTS logos_member_read ON storage.objects;

CREATE POLICY logos_member_read ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'logos'
    AND public.logo_object_readable(name)
  );

-- ---------------------------------------------------------------------------
-- 5) Jobs (service_tickets): members of organization_id only.
--    Replaces whatever select policy is live, including a missing one.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.service_tickets') IS NULL THEN
    RAISE NOTICE 'service_tickets missing, skip job policies';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.service_tickets ENABLE ROW LEVEL SECURITY';

  FOR r IN
    SELECT pol.polname
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'service_tickets'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.service_tickets', r.polname);
  END LOOP;

  EXECUTE $policy$
    CREATE POLICY service_tickets_member_select ON public.service_tickets
      FOR SELECT TO authenticated
      USING (public.auth_member_of_org(organization_id))
  $policy$;

  EXECUTE $policy$
    CREATE POLICY service_tickets_member_insert ON public.service_tickets
      FOR INSERT TO authenticated
      WITH CHECK (public.auth_member_of_org(organization_id))
  $policy$;

  EXECUTE $policy$
    CREATE POLICY service_tickets_member_update ON public.service_tickets
      FOR UPDATE TO authenticated
      USING (public.auth_member_of_org(organization_id))
      WITH CHECK (public.auth_member_of_org(organization_id))
  $policy$;

  EXECUTE $policy$
    CREATE POLICY service_tickets_member_delete ON public.service_tickets
      FOR DELETE TO authenticated
      USING (public.auth_member_of_org(organization_id))
  $policy$;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Service requests: full rows for members, posters, and the winning bidder.
--    Open/bidding rows for everyone else are the existing bid list, via a
--    view that does not include equipment, photos, serials, contacts, or logos.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_owns_service_request(req_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.service_requests sr
    WHERE sr.id = req_id
      AND (
        sr.created_by = auth.uid()
        OR sr.posted_by = auth.uid()
        OR public.auth_member_of_org(sr.organization_id)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.user_owns_service_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_owns_service_request(uuid) TO authenticated;

DROP POLICY IF EXISTS "Authenticated can view open service_requests" ON public.service_requests;
DROP POLICY IF EXISTS "Members read own service_requests" ON public.service_requests;

CREATE POLICY "Members read own service_requests"
  ON public.service_requests
  FOR SELECT
  TO authenticated
  USING (
    public.auth_member_of_org(organization_id)
    OR created_by = auth.uid()
    OR posted_by = auth.uid()
    OR public.user_is_winning_bidder(id)
  );

DROP POLICY IF EXISTS "Owners manage own service_requests" ON public.service_requests;

CREATE POLICY "Owners manage own service_requests"
  ON public.service_requests
  FOR ALL
  TO authenticated
  USING (
    public.auth_member_of_org(organization_id)
    OR created_by = auth.uid()
    OR posted_by = auth.uid()
  )
  WITH CHECK (
    public.auth_member_of_org(organization_id)
    OR created_by = auth.uid()
    OR posted_by = auth.uid()
  );

DO $$
DECLARE
  cols text;
  wanted text[] := ARRAY[
    'id',
    'title',
    'description',
    'status',
    'urgency',
    'manufacturer',
    'model',
    'service_type',
    'city',
    'state',
    'location',
    'category',
    'created_at',
    'budget_max',
    'organization_id'
  ];
BEGIN
  IF to_regclass('public.service_requests') IS NULL THEN
    RAISE NOTICE 'service_requests missing, skip open list view';
    RETURN;
  END IF;

  SELECT string_agg(quote_ident(c.col), ', ' ORDER BY c.ord)
  INTO cols
  FROM (
    SELECT wanted[i] AS col, i AS ord
    FROM generate_subscripts(wanted, 1) AS i
  ) c
  WHERE EXISTS (
    SELECT 1
    FROM information_schema.columns ic
    WHERE ic.table_schema = 'public'
      AND ic.table_name = 'service_requests'
      AND ic.column_name = c.col
  );

  IF cols IS NULL THEN
    RAISE NOTICE 'service_requests has none of the bid-list columns';
    RETURN;
  END IF;

  EXECUTE 'DROP VIEW IF EXISTS public.open_service_requests';
  EXECUTE format(
    'CREATE VIEW public.open_service_requests WITH (security_barrier = true, security_invoker = false) AS SELECT %s FROM public.service_requests WHERE status IN (''open'', ''bidding'')',
    cols
  );
  EXECUTE 'COMMENT ON VIEW public.open_service_requests IS ''Existing open/bidding service-request list for signed-in bidders. Omits equipment, photos, serials, contacts, and logos.''';
  EXECUTE 'REVOKE ALL ON public.open_service_requests FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON public.open_service_requests FROM anon';
  EXECUTE 'GRANT SELECT ON public.open_service_requests TO authenticated';
END $$;

-- ---------------------------------------------------------------------------
-- 7) Organization rows: drop a select-all policy if one is live, then allow
--    members, the creator, CRM-linked service shops, and published directory
--    or storefront listings. Unrelated unpublished orgs return no row.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  qual text;
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY';

  EXECUTE 'DROP POLICY IF EXISTS organizations_member_select ON public.organizations';
  EXECUTE 'DROP POLICY IF EXISTS organizations_published_select ON public.organizations';
  EXECUTE 'DROP POLICY IF EXISTS organizations_storefront_select ON public.organizations';
  EXECUTE 'DROP POLICY IF EXISTS organizations_crm_customer_select ON public.organizations';

  FOR r IN
    SELECT pol.polname AS name, pol.polcmd AS cmd, pg_get_expr(pol.polqual, pol.polrelid) AS qual
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'organizations'
      AND pol.polcmd IN ('r', '*')
  LOOP
    qual := COALESCE(r.qual, 'true');
    IF r.cmd = '*' AND qual IN ('true', '(true)') THEN
      -- A select-all-via-FOR-ALL policy would keep the logo read. Drop it and
      -- put back write-only copies so inserts and updates behave as before.
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.organizations', r.name);
      EXECUTE 'DROP POLICY IF EXISTS organizations_legacy_insert ON public.organizations';
      EXECUTE 'DROP POLICY IF EXISTS organizations_legacy_update ON public.organizations';
      EXECUTE 'DROP POLICY IF EXISTS organizations_legacy_delete ON public.organizations';
      EXECUTE 'CREATE POLICY organizations_legacy_insert ON public.organizations FOR INSERT TO authenticated WITH CHECK (true)';
      EXECUTE 'CREATE POLICY organizations_legacy_update ON public.organizations FOR UPDATE TO authenticated USING (true) WITH CHECK (true)';
      EXECUTE 'CREATE POLICY organizations_legacy_delete ON public.organizations FOR DELETE TO authenticated USING (true)';
    ELSIF r.cmd = 'r' AND (
      qual IN ('true', '(true)')
      OR qual !~ 'auth_member_of_org|organization_memberships|list_in_directory|storefront_enabled|organization_customers'
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.organizations', r.name);
    END IF;
  END LOOP;

  EXECUTE $policy$
    CREATE POLICY organizations_member_select ON public.organizations
      FOR SELECT TO authenticated
      USING (public.auth_member_of_org(id) OR created_by = auth.uid())
  $policy$;

  IF to_regclass('public.organization_customers') IS NOT NULL THEN
    EXECUTE $policy$
      CREATE POLICY organizations_crm_customer_select ON public.organizations
        FOR SELECT TO authenticated
        USING (
          EXISTS (
            SELECT 1
            FROM public.organization_customers oc
            WHERE oc.customer_organization_id = organizations.id
              AND public.auth_member_of_org(oc.service_organization_id)
          )
        )
    $policy$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'list_in_directory'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY organizations_published_select ON public.organizations
        FOR SELECT TO authenticated
        USING (COALESCE(list_in_directory, false) = true)
    $policy$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'storefront_enabled'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY organizations_storefront_select ON public.organizations
        FOR SELECT TO authenticated
        USING (COALESCE(storefront_enabled, false) = true)
    $policy$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.open_service_requests') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW public.open_service_requests SET (security_invoker = false)';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
