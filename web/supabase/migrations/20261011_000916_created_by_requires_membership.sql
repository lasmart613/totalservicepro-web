-- organizations.created_by grants access only with a current membership.
--
-- A tech who added a customer from a service report is that clinic's
-- organizations.created_by. Removing the tech deletes the membership but not
-- created_by (clients can't change it), and user_owns_or_created_org() passed
-- on created_by alone. That kept the removed tech's read/write on the clinic's
-- equipment, contacts and locations, report history reads, and SELECT, UPDATE
-- and DELETE on the clinic row itself (organizations policies test created_by
-- directly). They could also self-insert a founder membership into the clinic
-- (membership_insert_allowed) and point their profile at it.
--
-- New rule, public.org_creator_access(org, created_by, created_at): the caller
-- is created_by AND one of
--   (a) an active member of that org (founders, clinic owners), or
--   (b) an active member (is_active_org_member) of a service org that serves
--       it (organization_customers.service_organization_id), or
--   (c) the org is brand new and unclaimed: under 24h old, no
--       organization_customers link and no members yet. Needed for
--       INSERT ... RETURNING and the onboarding writes that run before the
--       founder membership exists. org_unclaimed_new() is that test.
-- created_by can't simply be dropped: (c) is used by every signup and every new
-- customer insert (the link is written right after the org).
--
-- Changed (every place created_by grants org access):
--   user_owns_or_created_org(bigint)  created_by branch -> org_creator_access.
--     Feeds equipment_facility_manage, equipment_service_org_manage,
--     contacts_service_company_linked_manage,
--     locations_service_company_linked_manage, and
--     can_view_service_report_for_history (service_reports_equipment_history_
--     select, service_report_items_select).
--   organizations policies organizations_member_select (SELECT),
--     "Users can update their own organizations" (UPDATE),
--     "Users can delete their own organizations" (DELETE): created_by = uid ->
--     org_creator_access(id, created_by, created_at). The row's own columns are
--     passed, so INSERT ... RETURNING still sees the new row.
--   membership_insert_allowed(...)  founder branch only for an unclaimed new
--     org (c). The app writes memberships with the service role; the founder
--     route gets the same check in code.
--   profile_org_change_allowed(bigint)  created_by branch -> org_creator_access.
--   logo_object_readable(text)  created_by branch -> org_creator_access.
--
-- Reviewed, unchanged (created_by there is not organizations.created_by
-- standing in for membership):
--   organizations INSERT policies (created_by must be the caller);
--   set_organization_created_by, organizations_guard_privilege,
--     guard_tenant_owner_cols, user_profiles_guard_identity_enforce
--     (created_by is set once and can't change);
--   customer_org_link_allowed (needs the caller to be an active member of the
--     service org and the creator a member of it);
--   remove_organization_member, user_profiles_sync_membership,
--     purchase_orders_guard_supplier (founder protection / actor checks);
--   service_reports select/update/insert (created_by already requires
--     is_active_org_member);
--   service_estimates / service_invoices (created_by only when organization_id
--     IS NULL: personal drafts);
--   marketplace_listings, marketplace_parts, marketplace_requests, bids,
--     parts_catalog, part_vendors, service_requests, user_owns_service_request
--     (the author's own marketplace rows, not org access).
--
-- Backfill: customer orgs with no link and no members, whose creator belongs to
-- exactly one service company, get an organization_customers link to it
-- (notes = 'backfill 000916'). Live 2026-10-11: 3 rows (77 -> 4, 2656 -> 2639,
-- 2667 -> 2639); without them those two current admins would lose the 3 orgs.
-- Dry run: web/supabase/oneoff/20261011_created_by_membership_dry_run.sql
-- (78 auth users: 0 gains, 0 losses with the backfill).
--
-- APPLY ON LIVE SUPABASE after review, with or before the app deploy (the
-- founder route change is independent). One transaction. Safe to re-run.
-- Rollback: 20261011_000916_created_by_requires_membership_rollback.sql.

SET LOCAL lock_timeout = '5s';

-- (c) Brand-new, unclaimed org.
CREATE OR REPLACE FUNCTION public.org_unclaimed_new(p_org bigint, p_created_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_org IS NOT NULL
    AND p_created_at IS NOT NULL
    AND p_created_at > now() - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_customers oc
      WHERE oc.customer_organization_id = p_org
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.organization_id = p_org
    );
$function$;

-- created_by counts only with (a), (b) or (c).
CREATE OR REPLACE FUNCTION public.org_creator_access(p_org bigint, p_created_by uuid, p_created_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_org IS NOT NULL
    AND p_created_by IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND p_created_by = auth.uid()
    AND (
      public.is_active_org_member(p_org)
      OR EXISTS (
        SELECT 1 FROM public.organization_customers oc
        WHERE oc.customer_organization_id = p_org
          AND public.is_active_org_member(oc.service_organization_id)
      )
      OR public.org_unclaimed_new(p_org, p_created_at)
    );
$function$;

REVOKE ALL ON FUNCTION public.org_unclaimed_new(bigint, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_unclaimed_new(bigint, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.org_creator_access(bigint, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_creator_access(bigint, uuid, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_owns_or_created_org(org_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
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
          AND public.org_creator_access(o.id, o.created_by, o.created_at)
      )
    );
$function$;

ALTER POLICY organizations_member_select ON public.organizations
  USING (public.auth_member_of_org(id) OR public.org_creator_access(id, created_by, created_at));

ALTER POLICY "Users can update their own organizations" ON public.organizations
  USING (public.org_creator_access(id, created_by, created_at));

ALTER POLICY "Users can delete their own organizations" ON public.organizations
  USING (public.org_creator_access(id, created_by, created_at));

CREATE OR REPLACE FUNCTION public.membership_insert_allowed(p_user_id uuid, p_organization_id bigint, p_role text, p_is_home boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_user_id IS NOT DISTINCT FROM auth.uid()
    AND (
      (
        -- Founder of a brand-new org only: a creator can't join a customer
        -- org that a shop already serves or that already has members.
        EXISTS (
          SELECT 1 FROM public.organizations o
          WHERE o.id = p_organization_id
            AND o.created_by = auth.uid()
            AND public.org_unclaimed_new(o.id, o.created_at)
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
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
  SELECT p_org IS NULL
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = p_org
        AND public.org_creator_access(o.id, o.created_by, o.created_at)
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
STABLE
SECURITY DEFINER
SET search_path = ''
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
      AND public.org_creator_access(o.id, o.created_by, o.created_at)
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

-- Backfill: tie unlinked, memberless customer orgs to their creator's only
-- service company, so (b) keeps that creator's access.
INSERT INTO public.organization_customers (service_organization_id, customer_organization_id, created_by, notes)
SELECT s.service_organization_id, o.id, o.created_by, 'backfill 000916'
FROM public.organizations o
CROSS JOIN LATERAL (
  SELECT min(m.organization_id) AS service_organization_id, count(*) AS n
  FROM public.organization_memberships m
  JOIN public.organizations so ON so.id = m.organization_id AND so.type = 'service_company'
  WHERE m.user_id = o.created_by
) s
WHERE o.type = 'customer'
  AND o.created_by IS NOT NULL
  AND s.n = 1
  AND NOT EXISTS (SELECT 1 FROM public.organization_customers oc WHERE oc.customer_organization_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.organization_id = o.id)
ON CONFLICT (service_organization_id, customer_organization_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
