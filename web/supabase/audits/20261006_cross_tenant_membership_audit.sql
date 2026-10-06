-- Read-only audit: memberships and profiles that may have joined an org
-- without creating it and without an accepted engineer_invitations row.
--
-- SELECT only. Do not add UPDATE, DELETE, or INSERT.
-- Clinic owners claimed with a customer-invite token (not engineer_invitations)
-- appear here on purpose so a human can tell them apart from a forged join.
-- Review the rows. Do not delete from this file.

-- Memberships whose user did not create the org and has no accepted invite.
SELECT
  m.user_id,
  NULLIF(lower(btrim(u.email)), '') AS email,
  m.organization_id AS org_id,
  o.name AS org_name,
  m.role AS membership_role,
  m.created_at,
  p.role AS profile_role
FROM public.organization_memberships AS m
JOIN public.organizations AS o ON o.id = m.organization_id
LEFT JOIN auth.users AS u ON u.id = m.user_id
LEFT JOIN public.user_profiles AS p ON p.id = m.user_id
WHERE o.created_by IS DISTINCT FROM m.user_id
  AND NOT EXISTS (
    SELECT 1
    FROM public.engineer_invitations AS i
    WHERE i.organization_id = m.organization_id
      AND COALESCE(i.accepted, false) = true
      AND u.email IS NOT NULL
      AND lower(btrim(i.email)) = lower(btrim(u.email))
  )
ORDER BY m.created_at DESC NULLS LAST, m.user_id;

-- Profiles whose active organization_id is not an org they created and
-- has no accepted engineer_invitations row for their auth email.
SELECT
  p.id AS user_id,
  NULLIF(lower(btrim(u.email)), '') AS email,
  p.organization_id AS org_id,
  o.name AS org_name,
  mem.role AS membership_role,
  p.created_at,
  p.role AS profile_role
FROM public.user_profiles AS p
JOIN public.organizations AS o ON o.id = p.organization_id
LEFT JOIN auth.users AS u ON u.id = p.id
LEFT JOIN public.organization_memberships AS mem
  ON mem.user_id = p.id AND mem.organization_id = p.organization_id
WHERE p.organization_id IS NOT NULL
  AND o.created_by IS DISTINCT FROM p.id
  AND NOT EXISTS (
    SELECT 1
    FROM public.engineer_invitations AS i
    WHERE i.organization_id = p.organization_id
      AND COALESCE(i.accepted, false) = true
      AND u.email IS NOT NULL
      AND lower(btrim(i.email)) = lower(btrim(u.email))
  )
ORDER BY p.created_at DESC NULLS LAST, p.id;
