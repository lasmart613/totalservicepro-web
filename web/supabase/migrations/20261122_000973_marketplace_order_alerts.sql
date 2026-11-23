SET LOCAL lock_timeout = '5s';

-- 000973: one alert row per marketplace order and status. NOT APPLIED by the
-- PR that adds this file. Do not run it against production from that change.
--
-- The webhook inserts (order_id, status) ON CONFLICT DO NOTHING and emails
-- admins only when that insert created a row. A failed send deletes the row
-- so the next retry can claim it. sent_at stays null until that send lands.
-- An unsent row older than an hour can be claimed again. order_id is
-- marketplace_orders.id.
--
-- Re-running this file is safe: the table is created only if it is missing,
-- and the grants and the empty policy list are applied again.
-- RLS is on and there are no member policies. anon and authenticated have no
-- grants. service_role may select, insert, and delete. It may not update,
-- truncate, reference, or create triggers. On Supabase that role bypasses RLS.
--
-- Rollback: 20261122_000973_marketplace_order_alerts_rollback.sql

CREATE TABLE IF NOT EXISTS public.marketplace_order_alerts (
  order_id uuid NOT NULL REFERENCES public.marketplace_orders (id) ON DELETE CASCADE,
  status text NOT NULL,
  alerted_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  sent_at timestamptz,
  CONSTRAINT marketplace_order_alerts_pkey PRIMARY KEY (order_id, status),
  CONSTRAINT marketplace_order_alerts_status_check
    CHECK (status IN ('stock_pending', 'refund_review'))
);

COMMENT ON TABLE public.marketplace_order_alerts IS
  '000973: durable stuck-order alert claim. One row per (order_id, status). sent_at is set after the admin email is accepted. Members cannot read or write it.';

ALTER TABLE public.marketplace_order_alerts ENABLE ROW LEVEL SECURITY;

-- No member policies. Re-applying drops this name if a partial edit added it
-- and does not create a replacement.
DROP POLICY IF EXISTS marketplace_order_alerts_member ON public.marketplace_order_alerts;

REVOKE ALL ON TABLE public.marketplace_order_alerts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.marketplace_order_alerts FROM service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.marketplace_order_alerts TO service_role;
REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.marketplace_order_alerts FROM service_role;

NOTIFY pgrst, 'reload schema';

SELECT '000973 ok' AS status;
