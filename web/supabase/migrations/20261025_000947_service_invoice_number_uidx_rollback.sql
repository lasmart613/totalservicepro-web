-- Rollback for 000947. Drops public.service_invoices_org_number_uidx only
-- when its definition is still the 20260813 partial unique index, and deletes
-- schema_migrations version 20261025_000947. A different index with that name
-- is left in place and the rollback aborts. Idempotent when the index is
-- already absent. Does not change invoice_number values, NOT NULL, the 000946
-- trigger, service_estimates_org_number_uidx, or purchase_orders_org_number_uidx.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $drift$
BEGIN
  IF to_regclass('public.service_invoices') IS NULL THEN
    RAISE EXCEPTION '000947 rollback drift: public.service_invoices is missing';
  END IF;
END
$drift$;

LOCK TABLE public.service_invoices IN SHARE ROW EXCLUSIVE MODE;

DO $drop$
DECLARE
  v_unique boolean;
  v_indexdef text;
BEGIN
  SELECT i.indisunique, pg_catalog.pg_get_indexdef(i.indexrelid)
    INTO v_unique, v_indexdef
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'service_invoices_org_number_uidx';

  IF v_indexdef IS NULL THEN
    RAISE NOTICE '000947 rollback: service_invoices_org_number_uidx is already absent';
  ELSIF v_unique IS NOT TRUE
     OR v_indexdef NOT LIKE '%(organization_id, invoice_number)%'
     OR v_indexdef NOT ILIKE '%invoice_number IS NOT NULL%'
     OR v_indexdef NOT ILIKE '%btrim(invoice_number)%' THEN
    RAISE EXCEPTION '000947 rollback: service_invoices_org_number_uidx is not the 20260813 definition; refusing to drop it';
  ELSE
    EXECUTE 'DROP INDEX public.service_invoices_org_number_uidx';
  END IF;
END
$drop$;

DO $book$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261025_000947';
END
$book$;

NOTIFY pgrst, 'reload schema';

COMMIT;
