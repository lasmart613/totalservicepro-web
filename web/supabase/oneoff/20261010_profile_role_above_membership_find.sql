-- Read-only. Not a migration and not applied by the app.
-- Profiles whose user_profiles.role outranks their membership role in
-- user_profiles.organization_id (the profile org).
--
-- Rank, higher number = more privilege:
--   owner, customer
--   > company_admin
--   > service_manager
--   > billing_manager, dispatcher
--   > fse
-- engineer and technician rank with fse (field roles in lib/roles.ts).
-- scheduler ranks with dispatcher (shop-schedule lead, not an admin).
-- A membership role of admin is compared as company_admin, matching
-- profile_role_from_membership. Platform admin (user_profiles.role = admin,
-- which is_admin() reads) is not on this ladder: it is listed as
-- platform_admin and excluded from needs_fix.
-- Roles off this ladder (crm, parts_supplier, supplier, and anything else)
-- are not ranked, so they are not needs_fix.
--
-- Live read on 2026-10-10 against project yljztfajyvjzqikxdddf:
--   needs_fix: no rows
--   no_membership: no rows
--   platform_admin: two profiles on organization 4 whose membership role
--   is company_admin
--     larrysmart@gmail.com
--     kayle.cornell@gmail.com
-- A same-day read of every profile whose role text differs from the mapped
-- membership role returned only those two platform-admin rows. No one-off
-- data fix.

WITH ranks(role, rank) AS (
  VALUES
    ('owner', 50),
    ('customer', 50),
    ('company_admin', 40),
    ('service_manager', 30),
    ('billing_manager', 20),
    ('dispatcher', 20),
    ('scheduler', 20),
    ('fse', 10),
    ('engineer', 10),
    ('technician', 10)
),
joined AS (
  SELECT
    p.id,
    p.email,
    p.organization_id,
    p.role AS profile_role,
    m.role AS membership_role,
    CASE
      WHEN lower(btrim(COALESCE(m.role, ''))) = 'admin' THEN 'company_admin'
      ELSE lower(btrim(COALESCE(m.role, '')))
    END AS membership_role_mapped,
    pr.rank AS profile_rank,
    mr.rank AS membership_rank
  FROM public.user_profiles p
  LEFT JOIN public.organization_memberships m
    ON m.user_id = p.id
   AND m.organization_id = p.organization_id
  LEFT JOIN ranks pr
    ON pr.role = lower(btrim(COALESCE(p.role, '')))
  LEFT JOIN ranks mr
    ON mr.role = CASE
      WHEN lower(btrim(COALESCE(m.role, ''))) = 'admin' THEN 'company_admin'
      ELSE lower(btrim(COALESCE(m.role, '')))
    END
  WHERE p.organization_id IS NOT NULL
)
SELECT
  CASE
    WHEN lower(btrim(COALESCE(profile_role, ''))) = 'admin' THEN 'platform_admin'
    WHEN membership_role IS NULL THEN 'no_membership'
    WHEN profile_rank IS NOT NULL
     AND membership_rank IS NOT NULL
     AND profile_rank > membership_rank THEN 'needs_fix'
    ELSE 'not_higher'
  END AS bucket,
  id,
  email,
  organization_id,
  profile_role,
  membership_role,
  membership_role_mapped,
  profile_rank,
  membership_rank
FROM joined
WHERE lower(btrim(COALESCE(profile_role, ''))) = 'admin'
   OR membership_role IS NULL
   OR (
     profile_rank IS NOT NULL
     AND membership_rank IS NOT NULL
     AND profile_rank > membership_rank
   )
ORDER BY bucket, organization_id, email;
