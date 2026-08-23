-- First-class organizations.type = manufacturer (laser OEM / factory).
-- Does NOT rewrite existing rows. Imported OEM service contacts stay service_company.
-- Widens an existing type CHECK if one is present; never drops live values.

DO $$
DECLARE
  r record;
  def text;
BEGIN
  FOR r IN
    SELECT c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'organizations'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ~* '\ytype\y'
      AND (
        pg_get_constraintdef(c.oid) ILIKE '%service_company%'
        OR pg_get_constraintdef(c.oid) ILIKE '%parts_supplier%'
        OR pg_get_constraintdef(c.oid) ILIKE '%customer%'
      )
  LOOP
    def := r.def;
    IF def ILIKE '%manufacturer%' THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS %I', r.conname);
    EXECUTE '
      ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_type_check
      CHECK (
        type IS NULL
        OR type IN (
          ''customer'',
          ''service_company'',
          ''parts_supplier'',
          ''laser_clinic'',
          ''laser_rental'',
          ''laser_reseller'',
          ''manufacturer'',
          ''vendor'',
          ''service''
        )
      )';
    EXIT;
  END LOOP;
END $$;

COMMENT ON TABLE public.organizations IS
  'Org types: customer | service_company | parts_supplier | laser_clinic | laser_rental | laser_reseller | manufacturer';

COMMENT ON COLUMN public.organizations.type IS
  'customer | service_company | parts_supplier | laser_clinic | laser_rental | laser_reseller | manufacturer';

-- Same guard as 20260822, with manufacturer added to locked founder roles.
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
  locked_roles text[] := ARRAY[
    'admin', 'company_admin', 'owner', 'customer', 'parts_supplier', 'manufacturer',
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
     AND OLD.organization_id IS NOT NULL
     AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'organization_id cannot be changed by the client';
  END IF;

  IF NEW.organization_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.organization_id IS NULL) THEN
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

    IF NOT own_created AND NOT invited THEN
      RAISE EXCEPTION 'cannot attach profile to an organization you did not create or were not invited to';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.role IS DISTINCT FROM OLD.role
     AND OLD.organization_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = OLD.organization_id AND o.created_by = actor
    ) INTO own_created;

    IF OLD.role IS NOT NULL AND lower(OLD.role) = ANY (locked_roles) THEN
      RAISE EXCEPTION 'role cannot be changed by the client once set';
    END IF;

    -- fse/pending leftover from the old signup trigger: only the org creator may fix it
    IF NOT own_created THEN
      RAISE EXCEPTION 'role cannot be changed by the client once set';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
