SET LOCAL lock_timeout = '5s';

-- 000972: claim marketplace stock for one order. NOT APPLIED by the PR that
-- adds this file. Do not run it against production from that change.
--
-- One transaction flips marketplace_orders from stock_pending to paid, then
-- decrements marketplace_listings only if that flip changed a row. A second
-- delivery of the same order sees status paid and does not touch quantity.
-- If the listing no longer has enough quantity, the order becomes
-- refund_review in the same transaction.
--
-- service_role only. search_path is empty so every name is schema-qualified.
-- Rollback: 20261122_000972_marketplace_order_claim_stock_rollback.sql

CREATE OR REPLACE FUNCTION public.marketplace_order_claim_stock(
  p_order_id uuid,
  p_listing_id uuid,
  p_quantity integer
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows integer;
  v_status text;
BEGIN
  IF p_order_id IS NULL OR p_listing_id IS NULL OR p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'marketplace_order_claim_stock: order, listing, and a positive quantity are required'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.marketplace_orders
  SET status = 'paid',
      updated_at = pg_catalog.now()
  WHERE id = p_order_id
    AND status = 'stock_pending';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    SELECT o.status INTO v_status
    FROM public.marketplace_orders o
    WHERE o.id = p_order_id;
    IF v_status = 'paid' THEN
      RETURN 'already_settled';
    END IF;
    IF v_status = 'refund_review' THEN
      RETURN 'refund_review';
    END IF;
    RAISE EXCEPTION 'marketplace_order_claim_stock: order % is not claimable', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.marketplace_listings
  SET quantity = quantity - p_quantity,
      status = CASE WHEN quantity - p_quantity = 0 THEN 'sold' ELSE status END,
      updated_at = pg_catalog.now()
  WHERE id = p_listing_id
    AND quantity >= p_quantity;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    UPDATE public.marketplace_orders
    SET status = 'refund_review',
        updated_at = pg_catalog.now()
    WHERE id = p_order_id;
    RETURN 'refund_review';
  END IF;

  RETURN 'claimed';
END;
$$;

COMMENT ON FUNCTION public.marketplace_order_claim_stock(uuid, uuid, integer) IS
  '000972: one transaction. stock_pending -> paid, then quantity = quantity - n where quantity >= n. Miss becomes refund_review. A repeat returns already_settled and does not decrement.';

REVOKE ALL ON FUNCTION public.marketplace_order_claim_stock(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_order_claim_stock(uuid, uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_order_claim_stock(uuid, uuid, integer) TO service_role;

SELECT '000972 ok' AS status;
