SET LOCAL lock_timeout = '5s';

-- 000973: one alert row per marketplace order and status. NOT APPLIED by the
-- PR that adds this file. Do not run it against production from that change.
--
-- The webhook inserts (order_id, status) ON CONFLICT DO NOTHING and emails
-- admins only when that insert created a row. A failed send deletes the row
-- so the next retry can claim it. order_id is marketplace_orders.id.
--
-- RLS is on and there are no member policies. anon and authenticated have no
-- grants. service_role is the only granted role; on Supabase that role
-- bypasses RLS.
--
-- Rollback: 20261122_000973_marketplace_order_alerts_rollback.sql

CREATE TABLE public.marketplace_order_alerts (
  order_id uuid NOT NULL REFERENCES public.marketplace_orders (id) ON DELETE CASCADE,
  status text NOT NULL,
  alerted_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT marketplace_order_alerts_pkey PRIMARY KEY (order_id, status),
  CONSTRAINT marketplace_order_alerts_status_check
    CHECK (status IN ('stock_pending', 'refund_review'))
);

COMMENT ON TABLE public.marketplace_order_alerts IS
  '000973: durable stuck-order alert claim. One row per (order_id, status). Members cannot read or write it.';

ALTER TABLE public.marketplace_order_alerts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.marketplace_order_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.marketplace_order_alerts TO service_role;

NOTIFY pgrst, 'reload schema';

SELECT '000973 ok' AS status;
