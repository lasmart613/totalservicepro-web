-- 000917 precheck. READ-ONLY (SELECT only). Run on live before applying.
-- Live 2026-10-15 10:20 PM PT result:
--   customer_side_orgs 1778, no_link 12 (type 'customer' 8), no_link_no_members 1,
--   creator_owner_member 11, creator_owner_and_linked 0,
--   creator_owner_is_shop_user 0, no_link_shop_created 0.
-- So no existing org is a shop-created, unlinked customer org, and no creator
-- holds an owner membership on a linked or shop-created customer org.
WITH c AS (
  SELECT o.id, o.type, o.created_by, o.created_at
  FROM public.organizations o
  WHERE o.type IN ('customer', 'laser_clinic', 'laser_rental', 'laser_reseller')
)
SELECT
  (SELECT count(*) FROM c) AS customer_side_orgs,
  (SELECT count(*) FROM c WHERE NOT EXISTS (
     SELECT 1 FROM public.organization_customers oc WHERE oc.customer_organization_id = c.id)) AS no_link,
  (SELECT count(*) FROM c WHERE c.type = 'customer' AND NOT EXISTS (
     SELECT 1 FROM public.organization_customers oc WHERE oc.customer_organization_id = c.id)) AS no_link_type_customer,
  (SELECT count(*) FROM c WHERE c.created_by IS NOT NULL AND EXISTS (
     SELECT 1 FROM public.organization_memberships m
     WHERE m.organization_id = c.id AND m.user_id = c.created_by AND lower(m.role) = 'owner')) AS creator_owner_member,
  (SELECT count(*) FROM c WHERE c.created_by IS NOT NULL AND EXISTS (
     SELECT 1 FROM public.organization_memberships m
     WHERE m.organization_id = c.id AND m.user_id = c.created_by AND lower(m.role) = 'owner')
   AND EXISTS (SELECT 1 FROM public.organization_customers oc WHERE oc.customer_organization_id = c.id)) AS creator_owner_and_linked,
  (SELECT count(*) FROM c WHERE c.created_by IS NOT NULL AND EXISTS (
     SELECT 1 FROM public.organization_memberships m
     WHERE m.organization_id = c.id AND m.user_id = c.created_by AND lower(m.role) = 'owner')
   AND EXISTS (
     SELECT 1 FROM public.organization_memberships s JOIN public.organizations so ON so.id = s.organization_id
     WHERE s.user_id = c.created_by AND so.type IN ('service_company', 'service'))) AS creator_owner_is_shop_user,
  (SELECT count(*) FROM c WHERE NOT EXISTS (
     SELECT 1 FROM public.organization_customers oc WHERE oc.customer_organization_id = c.id)
   AND EXISTS (
     SELECT 1 FROM public.organization_memberships s JOIN public.organizations so ON so.id = s.organization_id
     WHERE s.user_id = c.created_by AND so.type IN ('service_company', 'service'))) AS no_link_shop_created,
  (SELECT count(*) FROM c WHERE NOT EXISTS (
     SELECT 1 FROM public.organization_customers oc WHERE oc.customer_organization_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.organization_id = c.id)) AS no_link_no_members;
