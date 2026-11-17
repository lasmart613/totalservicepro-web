-- 000961: parts-supplier picker. One limited search instead of paging every
-- parts_supplier and vendor organization.
--
-- SECURITY INVOKER so organization row security still applies.
-- The term is a function argument, trimmed and cut at 80 characters.
-- Blank query is the first 12 names A to Z. A typed query matches the
-- combined name / city / state / phone / email string, then sorts A to Z,
-- then limits.
--
-- Scratch Postgres 16, 7,857 suppliers and vendors among 25,000 organizations.
-- EXPLAIN ANALYZE of search_supplier_orgs is a function scan: 19.0 ms for a
-- typed name and 13.8 ms for a blank query. The inner filter is selective
-- enough that no extra index was chosen. No CREATE INDEX in this file.
--
-- Does not change rows. Safe to re-run. The migration runner applies this
-- file as one transaction.
-- Repo only. Do not apply this file to production from the pull request.
-- Depends on nothing in 000960. Apply 000960 as well before the customer
-- pickers in this branch are deployed.
--
-- Rollback: 20261117_000961_supplier_org_search_rollback.sql

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.search_supplier_orgs(
  p_query text,
  p_limit integer DEFAULT 12
)
RETURNS TABLE (
  id bigint,
  name text,
  address text,
  city text,
  state text,
  zip text,
  phone text,
  email text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  WITH term AS (
    SELECT left(btrim(coalesce(p_query, '')), 80) AS q
  ),
  pattern AS (
    SELECT
      q,
      '%' || replace(replace(replace(lower(q), chr(92), chr(92) || chr(92)), '%', chr(92) || '%'), '_', chr(92) || '_') || '%' AS pat
    FROM term
  )
  SELECT
    o.id,
    btrim(o.name),
    o.address,
    o.city,
    o.state,
    o.zip,
    o.phone,
    o.email
  FROM public.organizations o
  CROSS JOIN pattern p
  WHERE o.type IS NOT NULL
    AND lower(btrim(o.type)) IN ('parts_supplier', 'vendor')
    AND btrim(coalesce(o.name, '')) <> ''
    AND (
      p.q = ''
      OR lower(concat_ws(' ', o.name, o.city, o.state, o.phone, o.email)) LIKE p.pat ESCAPE chr(92)
    )
  ORDER BY lower(btrim(o.name)) ASC, btrim(o.name) ASC, o.id ASC
  LIMIT least(greatest(coalesce(p_limit, 12), 1), 50);
$fn$;

COMMENT ON FUNCTION public.search_supplier_orgs(text, integer) IS
  '000961: up to p_limit parts suppliers and vendors. Blank query is A to Z. A typed query matches name, city, state, phone, or email and sorts A to Z before the limit.';

REVOKE ALL ON FUNCTION public.search_supplier_orgs(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_supplier_orgs(text, integer) TO authenticated, service_role;
