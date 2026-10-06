-- Claim column so two overlapping invoice Checkout webhooks cannot both
-- credit the same Stripe session. The webhook update matches only when
-- stripe_session_id is null or a different session, and credits only when
-- that update returns a row.
--
-- APPLY ON LIVE SUPABASE (SQL Editor or CLI) after review.
-- This repo does not auto-apply SQL. Safe to re-run.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.service_invoices
  ADD COLUMN IF NOT EXISTS stripe_session_id text;

COMMENT ON COLUMN public.service_invoices.stripe_session_id IS
  'Latest Stripe Checkout session credited on this invoice. A webhook claims the row only when this is null or a different session.';

NOTIFY pgrst, 'reload schema';
