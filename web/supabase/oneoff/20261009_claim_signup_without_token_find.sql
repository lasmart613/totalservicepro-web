-- Read-only. Not a migration and not applied by the app.
-- A failed clinic claim used to leave owner signup metadata after claim_token
-- was removed. The next sign-in rebuilt that into a new organization.
--
-- Live read 2026-10-09 (project yljztfajyvjzqikxdddf):
--   706c6bbf  fieldservicetotalservice+qa-238clinicd-1026@gmail.com
--             signup_kind=owner, organization_type=customer, no claim_token key.
--             Created org 2673 "QA TEST 238 Clinic 1026" at 19:16Z, home owner,
--             onboarding complete. Same name as clinic 2670 (created_by 383dd3dc).
--             This is the failed-claim duplicate. CEO decides whether to remove it.
--   24cec1f2  abdulrahman1998423@gmail.com
--             signup_kind=owner, organization_type=laser_reseller, no claim_token key.
--             Org 133 "laser parts egypt" was created 41 seconds after the account
--             on 2026-08-20, before owner signup stored claim_token. Not this bug.
-- No other auth user has owner/claim signup metadata with a null or missing
-- claim_token. Users who still hold a claim token (including qa-236 and qa-237)
-- did not get a second clinic.

SELECT
  u.id,
  u.email,
  u.created_at,
  u.raw_user_meta_data->>'signup_kind' AS signup_kind,
  u.raw_user_meta_data->>'signup_type' AS signup_type,
  u.raw_user_meta_data->>'role' AS meta_role,
  u.raw_user_meta_data->>'organization_type' AS org_type,
  coalesce(u.raw_user_meta_data->>'company', u.raw_user_meta_data->>'facility') AS meta_name,
  (u.raw_user_meta_data ? 'claim_token') AS has_claim_key,
  p.organization_id,
  p.role AS profile_role,
  p.onboarding_completed,
  o.id AS created_org_id,
  o.name AS created_org_name,
  o.type AS created_org_type,
  o.created_at AS org_created_at
FROM auth.users AS u
LEFT JOIN public.user_profiles AS p
  ON p.id = u.id
LEFT JOIN public.organizations AS o
  ON o.created_by = u.id
WHERE (
    coalesce(u.raw_user_meta_data->>'signup_kind', '') = 'owner'
    OR coalesce(u.raw_user_meta_data->>'role', '') IN ('owner', 'customer')
    OR coalesce(u.raw_user_meta_data->>'organization_type', '') IN (
      'customer', 'laser_clinic', 'laser_rental', 'laser_reseller'
    )
    OR coalesce(u.raw_user_meta_data->>'signup_type', '') IN ('claim', 'owner-claim')
  )
  AND coalesce(u.raw_user_meta_data->>'signup_kind', '') NOT IN ('company', 'supplier')
  AND coalesce(u.raw_user_meta_data->>'role', '') NOT IN (
    'company_admin', 'admin', 'parts_supplier', 'supplier'
  )
  AND (
    NOT (u.raw_user_meta_data ? 'claim_token')
    OR u.raw_user_meta_data->>'claim_token' IS NULL
  )
  AND length(coalesce(u.raw_user_meta_data->>'claim_token', '')) = 0
ORDER BY u.created_at DESC;
