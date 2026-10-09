-- Read-only. Not a migration and not applied by the app.
-- Users with more than one is_home row in organization_memberships.
-- Live read on 2026-10-09: only 3841fd9c-4931-4993-91f7-a7b785e4341e
-- (membership 13, org 4 Luxor, and membership 17, org 2528 Galactic Empire).
-- Their user_profiles.organization_id is 4, so org 4 is the home to keep.

SELECT
  user_id,
  count(*) AS home_count,
  array_agg(id ORDER BY id) AS membership_ids,
  array_agg(organization_id ORDER BY id) AS organization_ids
FROM public.organization_memberships
WHERE is_home
GROUP BY user_id
HAVING count(*) > 1
ORDER BY user_id;
