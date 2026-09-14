-- Complimentary Premium for early-adopter / shop signup (soft beta).
-- Adds a real expiry timestamp. Do NOT backfill existing is_premium = true
-- rows — those are paid or legacy and must keep working without an expiry.
--
-- APPLY ON LIVE SUPABASE (SQL Editor or CLI). This repo does not auto-apply SQL.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS premium_until timestamptz;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS premium_grant text;

COMMENT ON COLUMN public.organizations.premium_until IS
  'Complimentary Premium expiry. is_premium=true without this is paid/legacy and must not be expired by the complimentary job.';

COMMENT ON COLUMN public.organizations.premium_grant IS
  'complimentary_signup | complimentary_god. Cleared when expired or converted to paid Stripe.';

NOTIFY pgrst, 'reload schema';
