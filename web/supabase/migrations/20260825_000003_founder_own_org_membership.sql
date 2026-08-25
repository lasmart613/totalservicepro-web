-- If an FSE already belongs to another shop, creating their own company used to
-- fail the identity guard (organization_id "cannot be changed") and never wrote
-- an organization_memberships row. The org existed; the switcher stayed empty
-- of that shop.
--
-- Allow attaching an org the user created (or has a pending invite to) even
-- when they already have a different active org. Backfill founder memberships
-- for shops they created.

-- ---------------------------------------------------------------------------
-- 1) Guard: own-created / invited orgs may become the active pointer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_profiles_guard_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  own_created boolean;
  invited boolean;
  member_of_new boolean;
  member_role text;
  locked_roles text[] := ARRAY[
    'admin', 'company_admin', 'owner', 'customer', 'parts_supplier',
    'service_manager', 'dispatcher', 'scheduler', 'billing_manager'
  ];
BEGIN
  actor := auth.uid();
  IF actor IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'user_profiles insert must be your own row';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'user_profiles id cannot be changed';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    IF NEW.organization_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.organization_memberships m
        WHERE m.user_id = actor AND m.organization_id = NEW.organization_id
      ) INTO member_of_new;
      IF member_of_new THEN
        NULL;
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.organizations o
          WHERE o.id = NEW.organization_id AND o.created_by = actor
        ) INTO own_created;
        SELECT EXISTS (
          SELECT 1 FROM public.engineer_invitations i
          WHERE i.organization_id = NEW.organization_id
            AND lower(i.email) = lower(COALESCE(NEW.email, ''))
            AND COALESCE(i.accepted, false) = false
        ) INTO invited;
        IF own_created OR invited THEN
          NULL;
        ELSIF OLD.organization_id IS NOT NULL THEN
          RAISE EXCEPTION 'organization_id cannot be changed by the client';
        ELSE
          RAISE EXCEPTION 'cannot attach profile to an organization you did not create or were not invited to';
        END IF;
      END IF;
    ELSE
      NULL;
    END IF;
  END IF;

  IF NEW.organization_id IS NOT NULL
     AND TG_OP = 'INSERT' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = actor AND m.organization_id = NEW.organization_id
    ) INTO member_of_new;
    SELECT EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = NEW.organization_id AND o.created_by = actor
    ) INTO own_created;
    SELECT EXISTS (
      SELECT 1 FROM public.engineer_invitations i
      WHERE i.organization_id = NEW.organization_id
        AND lower(i.email) = lower(COALESCE(NEW.email, ''))
        AND COALESCE(i.accepted, false) = false
    ) INTO invited;
    IF NOT member_of_new AND NOT own_created AND NOT invited THEN
      RAISE EXCEPTION 'cannot attach profile to an organization you did not create or were not invited to';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.role IS DISTINCT FROM OLD.role THEN
    SELECT m.role INTO member_role
    FROM public.organization_memberships m
    WHERE m.user_id = actor
      AND m.organization_id = COALESCE(NEW.organization_id, OLD.organization_id)
    LIMIT 1;

    IF member_role IS NOT NULL AND lower(NEW.role) = lower(member_role) THEN
      NULL;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.id = NEW.organization_id AND o.created_by = actor
      ) INTO own_created;

      IF own_created THEN
        NULL;
      ELSIF OLD.organization_id IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1 FROM public.organizations o
          WHERE o.id = OLD.organization_id AND o.created_by = actor
        ) INTO own_created;

        IF OLD.role IS NOT NULL AND lower(OLD.role) = ANY (locked_roles) THEN
          RAISE EXCEPTION 'role cannot be changed by the client once set';
        END IF;

        IF NOT own_created THEN
          RAISE EXCEPTION 'role cannot be changed by the client once set';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.user_profiles_guard_identity() IS
  'Blocks steal/self-attach. Allows switching to a membership, and attaching an org the user created (home shop) or was invited to, even if they already belong elsewhere.';

-- ---------------------------------------------------------------------------
-- 2) Founder memberships for shops they created (Tony / Galactic Empire, etc.)
--    Skip customer/clinic rows — those are often CRM records created_by a tech.
-- ---------------------------------------------------------------------------
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home)
SELECT
  o.created_by,
  o.id,
  CASE
    WHEN lower(COALESCE(o.type, '')) IN ('parts_supplier', 'supplier', 'vendor')
      THEN 'parts_supplier'
    ELSE 'company_admin'
  END,
  true
FROM public.organizations o
WHERE o.created_by IS NOT NULL
  AND lower(COALESCE(o.type, '')) IN (
    'service_company', 'parts_supplier', 'supplier', 'vendor'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.user_id = o.created_by
      AND m.organization_id = o.id
  )
ON CONFLICT (user_id, organization_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
