SET LOCAL lock_timeout = '5s';

-- Rollback for 20261122_000973_marketplace_order_alerts.sql.
-- Drops the alert claim table. Does not change marketplace_orders.

DROP TABLE IF EXISTS public.marketplace_order_alerts;

NOTIFY pgrst, 'reload schema';

SELECT '000973 rollback ok' AS status;
