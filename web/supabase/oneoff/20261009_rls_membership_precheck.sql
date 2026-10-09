-- Read-only. Not a migration and not applied by the app.
-- user_profiles rows whose organization_id, or active_organization_id when
-- set, has no organization_memberships row for (user_id, that org).
-- account_kind is qa when email contains +qa-, otherwise real.
--
-- Live read-only run on 2026-10-09 against project yljztfajyvjzqikxdddf
-- as postgres (RLS bypass):
--   profiles = 66
--   profiles_with_org = 60
--   profiles_with_active = 60
--   memberships = 61
--   organization_id unmatched = 0
--   active_organization_id unmatched = 0
--   emails containing +qa- = 35, and every one of those had a matching membership
-- The detail query below returned no rows.

SELECT
  g.user_id,
  g.email,
  g.role,
  g.created_at,
  g.organization_id,
  oo.name AS organization_name,
  g.active_organization_id,
  ao.name AS active_organization_name,
  g.organization_id_unmatched,
  g.active_organization_id_unmatched,
  CASE
    WHEN coalesce(g.email, '') ILIKE '%+qa-%' THEN 'qa'
    ELSE 'real'
  END AS account_kind
FROM (
  SELECT
    p.id AS user_id,
    p.email,
    p.role,
    p.created_at,
    p.organization_id,
    p.active_organization_id,
    (
      p.organization_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.organization_memberships m
        WHERE m.user_id = p.id
          AND m.organization_id = p.organization_id
      )
    ) AS organization_id_unmatched,
    (
      p.active_organization_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.organization_memberships m
        WHERE m.user_id = p.id
          AND m.organization_id = p.active_organization_id
      )
    ) AS active_organization_id_unmatched
  FROM public.user_profiles p
) g
LEFT JOIN public.organizations oo ON oo.id = g.organization_id
LEFT JOIN public.organizations ao ON ao.id = g.active_organization_id
WHERE g.organization_id_unmatched
   OR g.active_organization_id_unmatched
ORDER BY account_kind, g.email;
