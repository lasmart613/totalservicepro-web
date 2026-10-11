-- Rollback for 20261011_000916_created_by_requires_membership.sql.
-- Restores the live definitions as of 2026-10-11 (pg_get_functiondef and
-- pg_policies on project yljztfajyvjzqikxdddf, before 000916), drops the new
-- helpers and removes the backfilled organization_customers links.
-- Rolling back reopens the removed-tech access hole.

SET LOCAL lock_timeout = '5s';

ALTER POLICY organizations_member_select ON public.organizations
  USING (public.auth_member_of_org(id) OR (created_by = auth.uid()));

ALTER POLICY "Users can update their own organizations" ON public.organizations
  USING (created_by = auth.uid());

ALTER POLICY "Users can delete their own organizations" ON public.organizations
  USING (created_by = auth.uid());

CREATE OR REPLACE FUNCTION public.user_owns_or_created_org(org_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    org_id IS NOT NULL
    AND (
      (
        org_id = public.get_my_org_id()
        AND public.is_active_org_member(org_id)
      )
      OR EXISTS (
        SELECT 1
        FROM public.organizations o
        WHERE o.id = org_id
          AND o.created_by = auth.uid()
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.membership_insert_allowed(p_user_id uuid, p_organization_id bigint, p_role text, p_is_home boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_user_id IS NOT DISTINCT FROM auth.uid()
    AND (
      (
        EXISTS (
          SELECT 1 FROM public.organizations o
          WHERE o.id = p_organization_id AND o.created_by = auth.uid()
        )
        AND lower(btrim(coalesce(p_role, ''))) IN (
          public.founder_role_for_org(p_organization_id),
          'fse', 'engineer', 'technician'
        )
        AND lower(btrim(coalesce(p_role, ''))) <> 'admin'
      )
      OR (
        COALESCE(p_is_home, false) = false
        AND lower(btrim(coalesce(p_role, ''))) <> 'admin'
        AND EXISTS (
          SELECT 1 FROM public.engineer_invitations i
          WHERE i.organization_id = p_organization_id
            AND public.auth_login_email() IS NOT NULL
            AND lower(btrim(i.email)) = public.auth_login_email()
            AND public.invitation_is_open(i.accepted, i.expires_at, i.created_at)
            AND lower(btrim(coalesce(p_role, ''))) = public.profile_role_from_membership(
              coalesce(NULLIF(TRIM(i.role), ''), 'fse')
            )
        )
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.profile_org_change_allowed(p_org bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET row_security TO 'off'
AS $function$
  SELECT p_org IS NULL
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = p_org AND o.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = auth.uid() AND m.organization_id = p_org
    )
    OR EXISTS (
      SELECT 1 FROM public.engineer_invitations i
      WHERE i.organization_id = p_org
        AND public.auth_login_email() IS NOT NULL
        AND lower(btrim(i.email)) = public.auth_login_email()
        AND public.invitation_is_open(i.accepted, i.expires_at, i.created_at)
    );
$function$;

CREATE OR REPLACE FUNCTION public.logo_object_readable(object_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

DROP FUNCTION IF EXISTS public.org_creator_access(bigint, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.org_unclaimed_new(bigint, timestamptz);

DELETE FROM public.organization_customers WHERE notes = 'backfill 000916';

NOTIFY pgrst, 'reload schema';
