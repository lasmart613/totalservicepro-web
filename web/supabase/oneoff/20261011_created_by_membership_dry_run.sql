-- Read-only. Not a migration and not applied by the app.
-- Dry run for 20261011_000916_created_by_requires_membership.sql: for every
-- auth user, rows they can reach today vs after the migration, per table, through
-- the policies that call user_owns_or_created_org() or test organizations.created_by.
-- The new rule is simulated in SQL with the user id in place of auth.uid().
-- links = organization_customers plus the links the migration backfills.
--
-- Columns: *_old / *_new = rows reachable before / after (org_select excludes
-- directory/storefront orgs, which stay readable to everyone). A row in the
-- output means at least one count changed. account_kind is qa when email contains +qa-.

WITH
backfill AS (
  -- Same rule as the migration's backfill: unlinked, memberless customer org whose
  -- creator is a member of exactly one service company.
  SELECT s.service_organization_id, o.id AS customer_organization_id
  FROM public.organizations o
  CROSS JOIN LATERAL (
    SELECT min(m.organization_id) AS service_organization_id, count(*) AS n
    FROM public.organization_memberships m
    JOIN public.organizations so ON so.id = m.organization_id AND so.type = 'service_company'
    WHERE m.user_id = o.created_by
  ) s
  WHERE o.type = 'customer'
    AND o.created_by IS NOT NULL
    AND s.n = 1
    AND NOT EXISTS (SELECT 1 FROM public.organization_customers oc WHERE oc.customer_organization_id = o.id)
    AND NOT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.organization_id = o.id)
),
links AS (
  SELECT service_organization_id, customer_organization_id FROM public.organization_customers
  UNION
  SELECT service_organization_id, customer_organization_id FROM backfill
),
mem AS (SELECT DISTINCT user_id, organization_id FROM public.organization_memberships),
users AS (
  SELECT u.id AS uid, u.email, p.organization_id AS profile_org,
    coalesce(
      (SELECT p.active_organization_id WHERE p.active_organization_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM mem WHERE mem.user_id = u.id AND mem.organization_id = p.active_organization_id)),
      (SELECT m.organization_id FROM public.organization_memberships m WHERE m.user_id = u.id
        ORDER BY m.is_home DESC NULLS LAST, m.created_at ASC NULLS LAST LIMIT 1)
    ) AS my_org
  FROM auth.users u
  LEFT JOIN public.user_profiles p ON p.id = u.id
),
pairs AS (
  -- Only (user, org) pairs where any branch can differ or apply: created_by,
  -- membership, or a link from a service org the user belongs to / is active in.
  SELECT o.created_by AS uid, o.id AS org_id FROM public.organizations o WHERE o.created_by IS NOT NULL
  UNION SELECT user_id, organization_id FROM mem
  UNION SELECT mem.user_id, l.customer_organization_id FROM links l JOIN mem ON mem.organization_id = l.service_organization_id
),
acc AS (
  SELECT p.uid, p.org_id,
    (m.user_id IS NOT NULL) AS is_member,
    (p.org_id = us.my_org AND m.user_id IS NOT NULL) AS own_branch,
    (o.created_by = p.uid) AS created_old,
    (o.created_by = p.uid AND (
       m.user_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM links l JOIN mem m2 ON m2.organization_id = l.service_organization_id AND m2.user_id = p.uid
                  WHERE l.customer_organization_id = o.id)
       OR (NOT EXISTS (SELECT 1 FROM links l WHERE l.customer_organization_id = o.id)
           AND NOT EXISTS (SELECT 1 FROM mem m3 WHERE m3.organization_id = o.id)
           AND o.created_at > now() - interval '24 hours')
    )) AS created_new,
    EXISTS (SELECT 1 FROM links l JOIN mem m2 ON m2.organization_id = l.service_organization_id AND m2.user_id = p.uid
            WHERE l.customer_organization_id = o.id) AS crm_branch,
    EXISTS (SELECT 1 FROM links l WHERE l.customer_organization_id = o.id AND l.service_organization_id = us.my_org) AS my_org_link,
    EXISTS (SELECT 1 FROM links l JOIN mem m2 ON m2.organization_id = l.service_organization_id AND m2.user_id = p.uid
            WHERE l.customer_organization_id = o.id AND l.service_organization_id = us.profile_org) AS profile_org_link,
    (coalesce(o.list_in_directory, false) OR coalesce(o.storefront_enabled, false)) AS published
  FROM pairs p
  JOIN users us ON us.uid = p.uid
  JOIN public.organizations o ON o.id = p.org_id
  LEFT JOIN mem m ON m.user_id = p.uid AND m.organization_id = p.org_id
),
acc2 AS (
  SELECT *, (own_branch OR created_old) AS uoc_old, (own_branch OR created_new) AS uoc_new FROM acc
),
report_orgs AS (
  -- Orgs whose ownership opens a report through the history function.
  SELECT r.id AS report_id, r.customer_organization_id AS org_id FROM public.service_reports r WHERE r.customer_organization_id IS NOT NULL
  UNION SELECT r.id, e.customer_organization_id FROM public.service_reports r JOIN public.equipment e ON e.id = r.equipment_id
  UNION SELECT r.id, e.customer_organization_id FROM public.service_reports r JOIN public.equipment e
        ON nullif(trim(r.serial_number), '') IS NOT NULL AND lower(trim(e.serial_number)) = lower(trim(r.serial_number))
),
report_base AS (
  -- Branches the migration does not touch.
  SELECT DISTINCT us.uid, r.id AS report_id
  FROM users us JOIN public.service_reports r ON
       (r.organization_id = us.profile_org AND EXISTS (SELECT 1 FROM mem WHERE mem.user_id = us.uid AND mem.organization_id = r.organization_id))
    OR r.organization_id = us.my_org
    OR (r.created_by = us.uid AND EXISTS (SELECT 1 FROM mem WHERE mem.user_id = us.uid AND mem.organization_id = r.organization_id))
    OR EXISTS (SELECT 1 FROM links l WHERE l.customer_organization_id = r.customer_organization_id AND l.service_organization_id = us.my_org)
),
report_old AS (
  SELECT uid, report_id FROM report_base
  UNION SELECT a.uid, ro.report_id FROM report_orgs ro JOIN acc2 a ON a.org_id = ro.org_id AND a.uoc_old
),
report_new AS (
  SELECT uid, report_id FROM report_base
  UNION SELECT a.uid, ro.report_id FROM report_orgs ro JOIN acc2 a ON a.org_id = ro.org_id AND a.uoc_new
),
per_user AS (
  SELECT us.uid, us.email,
    (SELECT count(*) FROM acc2 a WHERE a.uid = us.uid AND (a.is_member OR a.created_old OR a.crm_branch) AND NOT a.published) AS org_select_old,
    (SELECT count(*) FROM acc2 a WHERE a.uid = us.uid AND (a.is_member OR a.created_new OR a.crm_branch) AND NOT a.published) AS org_select_new,
    (SELECT count(*) FROM acc2 a WHERE a.uid = us.uid AND a.created_old) AS org_write_old,
    (SELECT count(*) FROM acc2 a WHERE a.uid = us.uid AND a.created_new) AS org_write_new,
    (SELECT count(*) FROM public.equipment e JOIN acc2 a ON a.uid = us.uid AND a.org_id = e.customer_organization_id
      WHERE a.uoc_old OR a.profile_org_link) AS equipment_write_old,
    (SELECT count(*) FROM public.equipment e JOIN acc2 a ON a.uid = us.uid AND a.org_id = e.customer_organization_id
      WHERE a.uoc_new OR a.profile_org_link) AS equipment_write_new,
    (SELECT count(*) FROM public.contacts c JOIN acc2 a ON a.uid = us.uid AND a.org_id = c.organization_id
      WHERE a.uoc_old OR a.my_org_link) AS contacts_old,
    (SELECT count(*) FROM public.contacts c JOIN acc2 a ON a.uid = us.uid AND a.org_id = c.organization_id
      WHERE a.uoc_new OR a.my_org_link) AS contacts_new,
    (SELECT count(*) FROM public.locations l JOIN acc2 a ON a.uid = us.uid AND a.org_id = l.organization_id
      WHERE a.uoc_old OR a.my_org_link) AS locations_old,
    (SELECT count(*) FROM public.locations l JOIN acc2 a ON a.uid = us.uid AND a.org_id = l.organization_id
      WHERE a.uoc_new OR a.my_org_link) AS locations_new,
    (SELECT count(*) FROM report_old x WHERE x.uid = us.uid) AS reports_old,
    (SELECT count(*) FROM report_new x WHERE x.uid = us.uid) AS reports_new,
    EXISTS (SELECT 1 FROM mem WHERE mem.user_id = us.uid) AS has_membership
  FROM users us
)
SELECT
  CASE WHEN coalesce(email, '') ILIKE '%+qa-%' THEN 'qa' ELSE 'real' END AS account_kind,
  *
FROM per_user
WHERE (org_select_old, org_write_old, equipment_write_old, contacts_old, locations_old, reports_old)
   IS DISTINCT FROM (org_select_new, org_write_new, equipment_write_new, contacts_new, locations_new, reports_new)
ORDER BY account_kind, email;
