-- 000959: indexes for the service-ticket customer name search.
--
-- Opening a ticket and typing a customer name used to download every
-- organization_customers link for the shop (paged), then every clinic, then
-- every contact. That wait was serial round trips. The ticket form now asks
-- for one limited page:
--   empty box  -> newest links (ORDER BY created_at DESC LIMIT 12)
--   typed name -> ILIKE on the linked organization's name, city, state,
--                 phone, email, and contact_name, ordered by name, LIMIT 12
--
-- idx_org_customers_service_org does not include created_at, so the newest-12
-- query read every link for the shop and then scanned organizations.
-- ILIKE '%term%' cannot use a btree. pg_trgm GIN indexes let a selective
-- name or city use an index. A one-letter term still scans; trigrams are
-- not selective there.
--
-- pg_trgm ships with Supabase and is created in the extensions schema
-- (https://supabase.com/docs/guides/database/extensions/pgtrgm). If it is
-- already installed, this leaves it where it is.
--
-- CREATE INDEX CONCURRENTLY cannot run inside the transaction this runner
-- uses. These statements take a SHARE lock and block writes on that table
-- only while each index builds. lock_timeout 5s means a busy table fails
-- the migration instead of waiting. On a scratch database of 25,000
-- organizations and 4,576 links the six GIN builds were 11–79 ms each and
-- the btree build was 6 ms. A larger production organizations table holds
-- the write lock for the build, which grows with the table.
--
-- Does not change ticket, report, or customer rows.
-- Repo only. Do not apply this file to production from the pull request.
-- Never use orgs 4, 153, 154, 1005, 2616, 5509, or 5515.
--
-- Rollback: 20261117_000959_ticket_customer_search_indexes_rollback.sql

SET LOCAL lock_timeout = '5s';

DO $body$
DECLARE
  trgm_schema text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    RAISE EXCEPTION '000959: extensions schema is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
  END IF;

  SELECT n.nspname INTO trgm_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';

  IF trgm_schema IS NULL THEN
    RAISE EXCEPTION '000959: pg_trgm is not installed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.organization_customers'::regclass
      AND attname = 'created_at'
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '000959: organization_customers.created_at is missing';
  END IF;

  EXECUTE 'CREATE INDEX IF NOT EXISTS organization_customers_service_created_idx
    ON public.organization_customers (service_organization_id, created_at DESC)';

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS organizations_name_trgm_idx
       ON public.organizations USING gin (name %I.gin_trgm_ops)',
    trgm_schema
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS organizations_city_trgm_idx
       ON public.organizations USING gin (city %I.gin_trgm_ops)',
    trgm_schema
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS organizations_state_trgm_idx
       ON public.organizations USING gin (state %I.gin_trgm_ops)',
    trgm_schema
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS organizations_phone_trgm_idx
       ON public.organizations USING gin (phone %I.gin_trgm_ops)',
    trgm_schema
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS organizations_email_trgm_idx
       ON public.organizations USING gin (email %I.gin_trgm_ops)',
    trgm_schema
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS organizations_contact_name_trgm_idx
       ON public.organizations USING gin (contact_name %I.gin_trgm_ops)',
    trgm_schema
  );
END
$body$;
