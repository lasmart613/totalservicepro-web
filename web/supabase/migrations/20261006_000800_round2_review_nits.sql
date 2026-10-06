-- Round-2 review nits and #219. Not applied by the app.
-- Apply after 20261006_000700. Re-running 000400 or 000500 after this file
-- would put the old profile_org_change_allowed signature and the anon
-- product_issue_reports INSERT back. Re-running 000700 after this file
-- would restore the shared-org parts policies.
--
-- 1. A customer org already linked to another service org cannot be linked again.
-- 2. Catalog admin is an admin of the part creator's home org, not any shared org.
-- 4. profile_org_change_allowed(bigint) uses auth.uid(). The (uuid, bigint) signature is dropped.
-- 5. Anon cannot INSERT product_issue_reports. Guests post through /api/product-issues.
-- 7. laser_models keeps one read policy.
-- 10. The 235902 hotfix filename is 20261006030456, the live schema_migrations version.
-- N7. Client roles cannot attribute labor_log or inventory_transactions to another user
--     unless they are a company_admin of that org.

-- 1. customer_org_link_allowed
CREATE OR REPLACE FUNCTION public.customer_org_link_allowed(
  p_service bigint,
  p_customer bigint
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_service IS NOT NULL
    AND p_customer IS NOT NULL
    AND p_service = public.get_my_org_id()
    AND EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = p_customer
        AND o.type IN ('customer', 'laser_clinic', 'laser_rental', 'laser_reseller')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_customers existing
      WHERE existing.customer_organization_id = p_customer
        AND existing.service_organization_id IS DISTINCT FROM p_service
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.id = p_customer
          AND o.type = 'customer'
          AND o.created_by IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.organization_memberships m
            WHERE m.user_id = o.created_by
              AND m.organization_id = p_service
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.engineer_invitations i
        JOIN public.organization_memberships m
          ON m.user_id = i.invited_by
         AND m.organization_id = p_service
         AND lower(m.role) IN ('company_admin', 'owner', 'service_manager', 'crm')
        WHERE i.organization_id = p_customer
          AND i.accepted IS TRUE
          AND lower(coalesce(i.role, '')) = 'owner'
      )
    );
$$;

REVOKE ALL ON FUNCTION public.customer_org_link_allowed(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_org_link_allowed(bigint, bigint) TO authenticated;

-- 2. parts_catalog UPDATE and part_vendors DELETE.
-- The part's org is the creator's home membership (is_home), not every org
-- the creator happens to share with an admin.
DROP POLICY IF EXISTS parts_catalog_update ON public.parts_catalog;
DROP POLICY IF EXISTS parts_catalog_update_owner ON public.parts_catalog;
CREATE POLICY parts_catalog_update_owner
  ON public.parts_catalog
  FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.organization_memberships part_home
      JOIN public.organization_memberships admin_m
        ON admin_m.organization_id = part_home.organization_id
       AND admin_m.user_id = auth.uid()
       AND lower(btrim(admin_m.role)) IN ('admin', 'company_admin')
      WHERE part_home.user_id = parts_catalog.created_by
        AND part_home.is_home IS TRUE
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.organization_memberships part_home
      JOIN public.organization_memberships admin_m
        ON admin_m.organization_id = part_home.organization_id
       AND admin_m.user_id = auth.uid()
       AND lower(btrim(admin_m.role)) IN ('admin', 'company_admin')
      WHERE part_home.user_id = parts_catalog.created_by
        AND part_home.is_home IS TRUE
    )
  );

DROP POLICY IF EXISTS part_vendors_delete_owner ON public.part_vendors;
CREATE POLICY part_vendors_delete_owner
  ON public.part_vendors
  FOR DELETE
  TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.parts_catalog p
      WHERE p.id = part_vendors.part_id
        AND p.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.parts_catalog p
      JOIN public.organization_memberships part_home
        ON part_home.user_id = p.created_by
       AND part_home.is_home IS TRUE
      JOIN public.organization_memberships admin_m
        ON admin_m.organization_id = part_home.organization_id
       AND admin_m.user_id = auth.uid()
       AND lower(btrim(admin_m.role)) IN ('admin', 'company_admin')
      WHERE p.id = part_vendors.part_id
    )
  );

-- 4. profile_org_change_allowed(bigint). Create the new signature, point the
-- guard at it, then drop (uuid, bigint).
CREATE OR REPLACE FUNCTION public.profile_org_change_allowed(p_org bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
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
$$;

COMMENT ON FUNCTION public.profile_org_change_allowed(bigint) IS
  'Profile may take this org for auth.uid(): null, creator, member, or an open invite for the signed-in email.';

REVOKE ALL ON FUNCTION public.profile_org_change_allowed(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_org_change_allowed(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_profiles_guard_identity_enforce(
  p_op text,
  new_row public.user_profiles,
  old_row public.user_profiles
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  actor uuid;
  own_created boolean;
  member_of_new boolean;
  member_role text;
  elevated text[] := ARRAY[
    'admin', 'company_admin', 'owner', 'parts_supplier', 'supplier',
    'service_manager', 'dispatcher', 'scheduler', 'billing_manager', 'crm'
  ];
BEGIN
  actor := auth.uid();
  IF actor IS NULL THEN
    RETURN;
  END IF;

  IF p_op = 'INSERT' AND new_row.id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'user_profiles insert must be your own row';
  END IF;

  IF p_op = 'UPDATE' AND new_row.id IS DISTINCT FROM old_row.id THEN
    RAISE EXCEPTION 'user_profiles id cannot be changed';
  END IF;

  IF lower(coalesce(new_row.role, '')) = 'admin'
     AND (p_op = 'INSERT' OR lower(coalesce(old_row.role, '')) <> 'admin') THEN
    RAISE EXCEPTION 'Not allowed to set this role' USING ERRCODE = '42501';
  END IF;

  IF (p_op = 'INSERT' OR new_row.organization_id IS DISTINCT FROM old_row.organization_id)
     AND NOT public.profile_org_change_allowed(new_row.organization_id) THEN
    RAISE EXCEPTION 'Not a member of that organization' USING ERRCODE = '42501';
  END IF;

  IF (p_op = 'INSERT' OR new_row.active_organization_id IS DISTINCT FROM old_row.active_organization_id)
     AND NOT public.profile_org_change_allowed(new_row.active_organization_id) THEN
    RAISE EXCEPTION 'Not a member of that organization' USING ERRCODE = '42501';
  END IF;

  IF p_op = 'UPDATE'
     AND new_row.active_organization_id IS DISTINCT FROM old_row.active_organization_id
     AND new_row.active_organization_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.organization_memberships m
       WHERE m.user_id = actor AND m.organization_id = new_row.active_organization_id
     )
     AND new_row.active_organization_id IS DISTINCT FROM new_row.organization_id THEN
    RAISE EXCEPTION 'active_organization_id must reference an existing membership';
  END IF;

  IF p_op = 'INSERT'
     AND new_row.active_organization_id IS NOT NULL
     AND new_row.active_organization_id IS DISTINCT FROM new_row.organization_id
     AND NOT EXISTS (
       SELECT 1 FROM public.organization_memberships m
       WHERE m.user_id = actor AND m.organization_id = new_row.active_organization_id
     ) THEN
    RAISE EXCEPTION 'active_organization_id must reference an existing membership';
  END IF;

  IF (p_op = 'INSERT' AND new_row.organization_id IS NOT NULL)
     OR (p_op = 'UPDATE' AND new_row.organization_id IS DISTINCT FROM old_row.organization_id AND new_row.organization_id IS NOT NULL) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = new_row.organization_id AND o.created_by = actor
    ) INTO own_created;
    SELECT EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = actor AND m.organization_id = new_row.organization_id
    ) INTO member_of_new;
    IF own_created AND NOT member_of_new AND lower(COALESCE(new_row.role, '')) = ANY (elevated) THEN
      RAISE EXCEPTION 'cannot self-assign an elevated role';
    END IF;
  END IF;

  IF (p_op = 'UPDATE' AND new_row.role IS DISTINCT FROM old_row.role)
     OR p_op = 'INSERT' THEN
    IF lower(COALESCE(new_row.role, '')) = ANY (elevated) THEN
      SELECT m.role INTO member_role
      FROM public.organization_memberships m
      WHERE m.user_id = actor
        AND m.organization_id = COALESCE(new_row.organization_id, CASE WHEN p_op = 'UPDATE' THEN old_row.organization_id ELSE NULL END)
      LIMIT 1;
      IF member_role IS NULL
         OR lower(public.profile_role_from_membership(member_role)) IS DISTINCT FROM lower(btrim(new_row.role)) THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.engineer_invitations i
          WHERE i.organization_id = new_row.organization_id
            AND public.auth_login_email() IS NOT NULL
            AND lower(btrim(i.email)) = public.auth_login_email()
            AND public.invitation_is_open(i.accepted, i.expires_at, i.created_at)
            AND lower(public.profile_role_from_membership(COALESCE(i.role, ''))) = lower(btrim(new_row.role))
        ) THEN
          RAISE EXCEPTION 'cannot self-assign an elevated role';
        END IF;
      END IF;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.user_profiles_guard_identity_enforce(text, public.user_profiles, public.user_profiles) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_profiles_guard_identity_enforce(text, public.user_profiles, public.user_profiles) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.profile_org_change_allowed(uuid, bigint);

-- 5. product_issue_reports: guests already insert through the service-role route.
REVOKE INSERT ON TABLE public.product_issue_reports FROM anon;
DROP POLICY IF EXISTS product_issue_reports_insert_anon ON public.product_issue_reports;

-- 7. One laser_models read policy. Keep laser_models_read (anon and authenticated).
DROP POLICY IF EXISTS "Authenticated can read all laser_models" ON public.laser_models;
DROP POLICY IF EXISTS "Authenticated can read laser_models" ON public.laser_models;
DROP POLICY IF EXISTS auth_read_laser_models ON public.laser_models;
DROP POLICY IF EXISTS "read laser_models" ON public.laser_models;
DROP POLICY IF EXISTS laser_models_read ON public.laser_models;
CREATE POLICY laser_models_read ON public.laser_models
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- N7. Attribution guard. Client roles only. Unchanged echoes pass.
CREATE OR REPLACE FUNCTION public.caller_is_company_admin(p_org bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT p_org IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships m
      WHERE m.user_id = auth.uid()
        AND m.organization_id = p_org
        AND lower(btrim(m.role)) = 'company_admin'
    );
$$;

REVOKE ALL ON FUNCTION public.caller_is_company_admin(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_is_company_admin(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_client_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'labor_log' THEN
    IF TG_OP = 'UPDATE' AND NEW.engineer_id IS NOT DISTINCT FROM OLD.engineer_id THEN
      RETURN NEW;
    END IF;
    IF NEW.engineer_id IS NULL OR NEW.engineer_id IS NOT DISTINCT FROM auth.uid() THEN
      RETURN NEW;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.service_tickets t
      WHERE t.id = NEW.ticket_id
        AND public.caller_is_company_admin(t.organization_id)
    ) THEN
      RAISE EXCEPTION 'engineer_id cannot name another user' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'inventory_transactions' THEN
    IF TG_OP = 'UPDATE' AND NEW.performed_by IS NOT DISTINCT FROM OLD.performed_by THEN
      RETURN NEW;
    END IF;
    IF NEW.performed_by IS NULL OR NEW.performed_by IS NOT DISTINCT FROM auth.uid() THEN
      RETURN NEW;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.inventory_locations l
      WHERE l.id IN (NEW.from_location_id, NEW.to_location_id)
        AND public.caller_is_company_admin(l.organization_id)
    ) THEN
      RAISE EXCEPTION 'performed_by cannot name another user' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_client_attribution() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_client_attribution() TO authenticated, service_role;

DROP TRIGGER IF EXISTS guard_client_attribution ON public.labor_log;
CREATE TRIGGER guard_client_attribution
  BEFORE INSERT OR UPDATE ON public.labor_log
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_client_attribution();

DROP TRIGGER IF EXISTS guard_client_attribution ON public.inventory_transactions;
CREATE TRIGGER guard_client_attribution
  BEFORE INSERT OR UPDATE ON public.inventory_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_client_attribution();

-- Company admin of a location's org may attribute the transaction to another user.
-- Everyone else may only leave performed_by null or set it to themselves.
DROP POLICY IF EXISTS transactions_insert_own ON public.inventory_transactions;
CREATE POLICY transactions_insert_own
  ON public.inventory_transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      performed_by IS NULL
      OR performed_by = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.inventory_locations l
        WHERE l.id IN (inventory_transactions.from_location_id, inventory_transactions.to_location_id)
          AND public.caller_is_company_admin(l.organization_id)
      )
    )
    AND EXISTS (
      SELECT 1
      FROM public.inventory_locations l
      WHERE l.id IN (inventory_transactions.from_location_id, inventory_transactions.to_location_id)
        AND (
          (l.organization_id IS NOT NULL AND public.caller_in_org(l.organization_id))
          OR (l.organization_id IS NULL AND l.owner_user_id = auth.uid())
        )
    )
  );

-- Table UPDATE is a no-op for column restrictions. Grant every column except id.
-- engineer_id and performed_by stay granted so a company admin can set them and
-- an unchanged echo still works. The trigger is what blocks another user.
DO $$
DECLARE
  spec record;
  cols text;
BEGIN
  FOR spec IN
    SELECT *
    FROM (VALUES
      ('labor_log', ARRAY['id']::text[]),
      ('inventory_transactions', ARRAY['id']::text[])
    ) AS t(table_name, frozen)
  LOOP
    IF to_regclass('public.' || spec.table_name) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format(
      'REVOKE UPDATE ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      spec.table_name
    );
    SELECT string_agg(format('%I', c.column_name), ', ' ORDER BY c.ordinal_position)
      INTO cols
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = spec.table_name
      AND NOT (c.column_name = ANY (spec.frozen));
    IF cols IS NULL THEN
      RAISE EXCEPTION 'no safe update columns for %', spec.table_name;
    END IF;
    EXECUTE format(
      'GRANT UPDATE (%s) ON TABLE public.%I TO authenticated',
      cols,
      spec.table_name
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
