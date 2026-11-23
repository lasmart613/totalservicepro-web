SET LOCAL lock_timeout = '5s';

-- Rollback for 20261122_000973_marketplace_order_alerts.sql.
-- Drops the alert claim table. Does not change marketplace_orders.
-- The same service_role revoke as the forward migration, so a partial
-- rollback still leaves update, truncate, references, and trigger revoked.

DO $$ BEGIN
  IF to_regclass('public.marketplace_order_alerts') IS NOT NULL THEN
    EXECUTE 'REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.marketplace_order_alerts FROM service_role';
  END IF;
END $$;

DROP TABLE IF EXISTS public.marketplace_order_alerts;

NOTIFY pgrst, 'reload schema';

SELECT '000973 rollback ok' AS status;
