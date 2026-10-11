-- Read-only. Not a migration and not applied by the app.
-- service_reports rows whose created_by user has no organization_memberships
-- row for that report's organization. Rows with a null created_by are
-- omitted: there is no author to match.
-- account_kind is qa when the auth login email contains +qa-, otherwise real.
--
-- Live read-only run on 2026-10-11 against project yljztfajyvjzqikxdddf
-- as postgres (RLS bypass), before 000909:
--   service_reports = 54
--   organization_id null = 0
--   created_by null = 2 (omitted below)
--   created_by is a current member of the report organization = 51
--   created_by has no current membership in the report organization = 1
--     that author has no membership in any organization
--     that report's organization_id is not in organizations
-- The detail query below returned that 1 row.

SELECT
  r.id,
  r.organization_id,
  (o.id IS NULL) AS organization_missing,
  r.created_by,
  r.status,
  r.created_at,
  (
    SELECT count(*)
    FROM public.organization_memberships m
    WHERE m.user_id = r.created_by
  ) AS author_membership_count,
  CASE
    WHEN coalesce(u.email, '') ILIKE '%+qa-%' THEN 'qa'
    ELSE 'real'
  END AS account_kind
FROM public.service_reports r
LEFT JOIN public.organizations o ON o.id = r.organization_id
LEFT JOIN auth.users u ON u.id = r.created_by
WHERE r.organization_id IS NOT NULL
  AND r.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.user_id = r.created_by
      AND m.organization_id = r.organization_id
  )
ORDER BY r.created_at, r.id;
