-- Read-only audit for the 000951 price lock. Do not apply 000951 from this file.
-- Run it in a reviewed session before anyone applies
-- web/supabase/migrations/20261105_000951_org_parts_inventory_bom.sql.
-- This file only reads. It does not change grants, views, or publications.
--
-- What a coordinator looks for
-- 1. Price grants. anon and authenticated are expected to have them until
--    000951 runs. Any other ordinary role is a hold. A named revoke of
--    authenticated does not remove a grant that role inherits. If
--    qa_legacy_grant (or any other role) still has SELECT or INSERT, that
--    privilege survives REVOKE FROM authenticated. Remove that grant in its
--    own reviewed change. 000951 will abort rather than revoke the extra role.
-- 2. Owner views. A view that reads parts_catalog.sale_price or
--    part_vendors.unit_cost / currency and is not security_invoker runs as
--    its owner and bypasses column revokes. 000951 aborts and does not drop
--    the view.
-- 3. Realtime. If supabase_realtime is FOR ALL TABLES, or if it publishes
--    parts_catalog / part_vendors with the price column still included,
--    000951 aborts. It will not rewrite the publication, because that can
--    drop unrelated tables. Narrow the publication in a reviewed change first.
-- 4. Table owner and superuser still read every column. That is not a
--    PostgREST client grant. If an ordinary role owns the table, 000951 aborts
--    instead of changing ownership.
-- 5. service_role is expected to keep access for a later backfill. It is not
--    a client role.
--
-- A row in any of the result sets below, other than anon / authenticated /
-- service_role / superuser / bypassrls / table owner, is a release hold.

SELECT c.relname AS table_name,
       a.attname AS column_name,
       acl.privilege_type,
       COALESCE(gr.rolname, 'PUBLIC') AS grantee,
       pg_get_userbyid(c.relowner) AS table_owner
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  CROSS JOIN LATERAL aclexplode(c.relacl) acl
  LEFT JOIN pg_roles gr ON gr.oid = acl.grantee
 WHERE c.relacl IS NOT NULL
   AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE')
   AND (
     (c.relname = 'parts_catalog' AND a.attname = 'sale_price')
     OR (c.relname = 'part_vendors' AND a.attname IN ('unit_cost', 'currency'))
   )
UNION ALL
SELECT c.relname,
       a.attname,
       acl.privilege_type,
       COALESCE(gr.rolname, 'PUBLIC'),
       pg_get_userbyid(c.relowner)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
  CROSS JOIN LATERAL aclexplode(a.attacl) acl
  LEFT JOIN pg_roles gr ON gr.oid = acl.grantee
 WHERE acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE')
   AND (
     (c.relname = 'parts_catalog' AND a.attname = 'sale_price')
     OR (c.relname = 'part_vendors' AND a.attname IN ('unit_cost', 'currency'))
   )
 ORDER BY 1, 2, 4, 3;

SELECT r.rolname,
       has_column_privilege(r.oid, 'public.parts_catalog'::regclass, 'sale_price'::text, 'SELECT') AS catalog_sale_select,
       has_column_privilege(r.oid, 'public.parts_catalog'::regclass, 'sale_price'::text, 'INSERT') AS catalog_sale_insert,
       has_column_privilege(r.oid, 'public.part_vendors'::regclass, 'unit_cost'::text, 'SELECT') AS vendor_cost_select,
       has_column_privilege(r.oid, 'public.part_vendors'::regclass, 'unit_cost'::text, 'INSERT') AS vendor_cost_insert
  FROM pg_roles r
 WHERE has_column_privilege(r.oid, 'public.parts_catalog'::regclass, 'sale_price'::text, 'SELECT')
    OR has_column_privilege(r.oid, 'public.parts_catalog'::regclass, 'sale_price'::text, 'INSERT')
    OR has_column_privilege(r.oid, 'public.part_vendors'::regclass, 'unit_cost'::text, 'SELECT')
    OR has_column_privilege(r.oid, 'public.part_vendors'::regclass, 'unit_cost'::text, 'INSERT')
 ORDER BY r.rolname;

SELECT n.nspname, c.relname, pg_get_userbyid(c.relowner) AS owner, c.reloptions
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'v'
   AND n.nspname NOT IN ('pg_catalog', 'information_schema')
   AND (
     (pg_get_viewdef(c.oid, true) ILIKE '%parts_catalog%' AND pg_get_viewdef(c.oid, true) ILIKE '%sale_price%')
     OR (pg_get_viewdef(c.oid, true) ILIKE '%part_vendors%' AND (
       pg_get_viewdef(c.oid, true) ILIKE '%unit_cost%'
       OR pg_get_viewdef(c.oid, true) ILIKE '%currency%'
     ))
   );

SELECT p.pubname, p.puballtables, n.nspname, c.relname, a.attname,
       (pr.prattrs IS NULL OR a.attnum = ANY (pr.prattrs)) AS column_included
  FROM pg_publication p
  JOIN pg_publication_rel pr ON pr.prpubid = p.oid
  JOIN pg_class c ON c.oid = pr.prrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND NOT a.attisdropped
 WHERE p.pubname = 'supabase_realtime'
   AND (
     (c.relname = 'parts_catalog' AND a.attname = 'sale_price')
     OR (c.relname = 'part_vendors' AND a.attname IN ('unit_cost', 'currency'))
   );

SELECT p.pubname, p.puballtables
  FROM pg_publication p
 WHERE p.pubname = 'supabase_realtime';
