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
-- 5. service_role is a named exception for a later backfill. It is not a client
--    role. Other BYPASSRLS roles are not exempt. A grant to one of them is a hold.
-- 6. Security-definer functions, materialized views, owner views, and views
--    that depend on those objects. A scan of function source and pg_depend
--    cannot prove that dynamic SQL or obfuscated names are safe.
--
-- Passing every query below with no unexpected row does not clear production.
-- A human audit of the real database is mandatory and has not been performed
-- by writing this file.
--
-- A row in the grant list, other than anon / authenticated / service_role /
-- superuser / table owner, is a release hold. BYPASSRLS is not an exemption.

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

-- BYPASSRLS is listed, not skipped. service_role is the only named exception.
SELECT r.rolname, r.rolbypassrls, r.rolsuper
  FROM pg_roles r
 WHERE r.rolbypassrls
    OR r.rolsuper
 ORDER BY r.rolname;

WITH RECURSIVE chain AS (
  SELECT am.member AS who, am.roleid AS inherits, 1 AS depth
    FROM pg_auth_members am
  UNION ALL
  SELECT c.who, am.roleid, c.depth + 1
    FROM chain c
    JOIN pg_auth_members am ON am.member = c.inherits
   WHERE c.depth < 8
)
SELECT who.rolname AS member_name, inherits.rolname AS inherited_role, inherits.rolbypassrls
  FROM chain c
  JOIN pg_roles who ON who.oid = c.who
  JOIN pg_roles inherits ON inherits.oid = c.inherits
 WHERE who.rolname IN ('anon', 'authenticated')
 ORDER BY 1, 2;

SELECT n.nspname, p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef,
       pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
   AND (
     p.prosecdef
     OR has_function_privilege('anon', p.oid, 'EXECUTE')
     OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
     OR has_function_privilege('public', p.oid, 'EXECUTE')
   )
   AND (
     pg_get_functiondef(p.oid) ILIKE '%parts_catalog%'
     OR pg_get_functiondef(p.oid) ILIKE '%part_vendors%'
     OR pg_get_functiondef(p.oid) ILIKE '%sale_price%'
     OR pg_get_functiondef(p.oid) ILIKE '%unit_cost%'
   )
 ORDER BY 1, 2;

SELECT n.nspname, c.relname, c.relkind, pg_get_userbyid(c.relowner) AS owner, c.reloptions
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'm'
   AND n.nspname NOT IN ('pg_catalog', 'information_schema')
   AND (
     pg_get_viewdef(c.oid, true) ILIKE '%sale_price%'
     OR pg_get_viewdef(c.oid, true) ILIKE '%unit_cost%'
     OR pg_get_viewdef(c.oid, true) ILIKE '%parts_catalog%'
     OR pg_get_viewdef(c.oid, true) ILIKE '%part_vendors%'
   )
 ORDER BY 1, 2;
