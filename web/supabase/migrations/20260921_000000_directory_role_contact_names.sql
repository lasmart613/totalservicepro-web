-- Split directory role people into first_name + last_name.
-- Backfills organizations.directory_contacts JSON and contacts rows that
-- still store a single "First Last" string. Safe to re-run.
--
-- Soft beta. No paid ads.
--
-- LIVE SQL (Supabase SQL editor after merge):
--   1. Paste this file and Run.
--   2. Confirm:
--        select id, name, contact_name, directory_contacts
--        from organizations
--        where type in ('customer', 'laser_clinic')
--          and directory_contacts is not null
--        order by id desc
--        limit 20;
--   Preview/prod do not apply this automatically.

COMMENT ON COLUMN public.organizations.directory_contacts IS
  'Customer Directory person-roles: {version, primaryRole, roles{owner,medical_director,physician,laser_technician,office_manager:{first_name,last_name,name,email,phone}}}. Display name is first_name + last_name. Main office email/phone stay on organizations.email / organizations.phone.';

DO $$
DECLARE
  rec RECORD;
  role_key TEXT;
  role_obj JSONB;
  roles JSONB;
  next_roles JSONB;
  raw_name TEXT;
  first_n TEXT;
  last_n TEXT;
  parts TEXT[];
  next_doc JSONB;
BEGIN
  FOR rec IN
    SELECT id, directory_contacts
    FROM public.organizations
    WHERE directory_contacts IS NOT NULL
      AND jsonb_typeof(directory_contacts) = 'object'
  LOOP
    roles := CASE
      WHEN jsonb_typeof(rec.directory_contacts->'roles') = 'object'
        THEN rec.directory_contacts->'roles'
      ELSE rec.directory_contacts
    END;
    IF jsonb_typeof(roles) <> 'object' THEN
      CONTINUE;
    END IF;

    next_roles := roles;
    FOR role_key IN SELECT jsonb_object_keys(roles)
    LOOP
      role_obj := roles->role_key;
      IF jsonb_typeof(role_obj) <> 'object' THEN
        CONTINUE;
      END IF;

      first_n := NULLIF(trim(COALESCE(role_obj->>'first_name', '')), '');
      last_n := NULLIF(trim(COALESCE(role_obj->>'last_name', '')), '');
      raw_name := NULLIF(trim(COALESCE(role_obj->>'name', '')), '');

      IF first_n IS NULL AND last_n IS NULL AND raw_name IS NOT NULL THEN
        parts := regexp_split_to_array(raw_name, '\s+');
        first_n := parts[1];
        IF array_length(parts, 1) > 1 THEN
          last_n := array_to_string(parts[2:array_length(parts, 1)], ' ');
        END IF;
      ELSIF first_n IS NOT NULL AND last_n IS NULL AND first_n ~ '\s' THEN
        parts := regexp_split_to_array(first_n, '\s+');
        first_n := parts[1];
        IF array_length(parts, 1) > 1 THEN
          last_n := array_to_string(parts[2:array_length(parts, 1)], ' ');
        END IF;
      END IF;

      IF raw_name IS NULL THEN
        raw_name := NULLIF(trim(concat_ws(' ', first_n, last_n)), '');
      END IF;

      next_roles := jsonb_set(
        next_roles,
        ARRAY[role_key],
        role_obj
          || jsonb_strip_nulls(jsonb_build_object(
            'first_name', COALESCE(first_n, ''),
            'last_name', COALESCE(last_n, ''),
            'name', COALESCE(raw_name, '')
          )),
        true
      );
    END LOOP;

    next_doc := CASE
      WHEN rec.directory_contacts ? 'roles' THEN rec.directory_contacts
      ELSE jsonb_build_object(
        'version', 2,
        'primaryRole', rec.directory_contacts->'primaryRole',
        'roles', rec.directory_contacts
      )
    END;
    next_doc := jsonb_set(next_doc, '{roles}', next_roles, true);
    IF jsonb_typeof(next_doc->'version') IS NULL OR (next_doc->>'version') = '1' THEN
      next_doc := jsonb_set(next_doc, '{version}', '2'::jsonb, true);
    END IF;

    UPDATE public.organizations
    SET directory_contacts = next_doc
    WHERE id = rec.id
      AND directory_contacts IS DISTINCT FROM next_doc;
  END LOOP;
END $$;

-- Split contacts.first_name that still holds "First Last" when last_name is empty.
-- Skip rows whose first_name is only the role title (Owner, Medical Director, …).
UPDATE public.contacts
SET
  last_name = NULLIF(trim(substring(first_name from '\s+(.+)$')), ''),
  first_name = trim(substring(first_name from '^\S+')),
  updated_at = now()
WHERE (last_name IS NULL OR trim(last_name) = '')
  AND first_name ~ '\s'
  AND lower(trim(first_name)) IS DISTINCT FROM lower(trim(COALESCE(title, '')));

NOTIFY pgrst, 'reload schema';

SELECT 'ok' AS status;
