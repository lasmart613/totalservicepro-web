SET LOCAL lock_timeout = '5s';

-- Rollback for 20261122_000972_marketplace_order_claim_stock.sql.
-- Drops the claim function. Does not change orders or listing quantities.

DROP FUNCTION IF EXISTS public.marketplace_order_claim_stock(uuid, uuid, integer);

SELECT '000972 rollback ok' AS status;
