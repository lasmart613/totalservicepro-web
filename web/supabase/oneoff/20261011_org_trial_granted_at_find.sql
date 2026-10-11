-- Read-only precheck for 20261011_000915_org_trial_granted_at.sql.
-- Lists every org the backfill marks as "trial used", with the reason and the
-- value it gets, plus the orgs QA named that stay null and why.
-- SELECT only. Works before the migration (does not read trial_granted_at).

WITH c AS (
  SELECT
    o.id, o.name, o.type, o.created_at, o.updated_at,
    o.created_by IS NOT NULL AS has_creator,
    o.is_premium, o.premium_until, o.premium_grant, o.subscription_tier, o.plan
  FROM public.organizations o
),
marked AS (
  SELECT c.*,
    CASE
      WHEN c.premium_grant = 'complimentary_signup' THEN 'current complimentary_signup grant'
      WHEN c.premium_grant = 'complimentary_god' THEN 'current complimentary_god grant'
      WHEN c.type = 'service_company'
        AND c.has_creator
        AND c.created_at >= timestamptz '2026-09-14 00:00:00+00'
        AND c.created_at <  timestamptz '2026-10-06 04:01:07+00'
        AND c.premium_grant IS NULL
        AND c.premium_until IS NULL
        AND coalesce(c.is_premium, false) = false
        THEN 'pre-#215 service_company signup after 20260914 with the trial gone'
    END AS reason,
    CASE
      WHEN c.premium_grant = 'complimentary_signup'
        THEN coalesce(c.premium_until - interval '1440 hours', c.created_at)
      WHEN c.premium_grant = 'complimentary_god'
        THEN coalesce(c.updated_at, c.created_at)
      ELSE c.created_at
    END AS trial_granted_at
  FROM c
)
SELECT 'backfill' AS bucket, id, name, type, created_at, premium_grant, premium_until,
       reason, trial_granted_at
FROM marked
WHERE reason IS NOT NULL
UNION ALL
SELECT 'stays null', id, name, type, created_at, premium_grant, premium_until,
       CASE
         WHEN NOT has_creator THEN 'no creator: the founder route never grants'
         WHEN type <> 'service_company' THEN 'not a service_company'
         WHEN is_premium AND premium_until IS NULL THEN 'paid / legacy premium (no expiry)'
         ELSE 'never had a trial; created more than 24h ago, so the new rule never grants'
       END,
       NULL::timestamptz
FROM marked
WHERE reason IS NULL
  AND (id IN (115, 120, 121, 134, 137, 2528, 2616, 2651)
       OR (type = 'service_company' AND has_creator))
ORDER BY 1, 2;
