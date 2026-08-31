-- RFC 8058 one-click unsubscribe for God-dashboard shop invites.
-- This repo does not auto-apply SQL. Run in the live Supabase SQL editor
-- after 20260831_000002_god_email_sends.sql.

ALTER TABLE public.god_email_sends
  ADD COLUMN IF NOT EXISTS unsubscribe_token text,
  ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS god_email_sends_unsubscribe_token_uidx
  ON public.god_email_sends (unsubscribe_token)
  WHERE unsubscribe_token IS NOT NULL;

COMMENT ON COLUMN public.god_email_sends.unsubscribe_token IS
  'Capability token for /unsubscribe one-click (RFC 8058). Not shown in the God UI.';

COMMENT ON COLUMN public.god_email_sends.unsubscribed_at IS
  'Set when the recipient used List-Unsubscribe / the HTTPS form. Blocks later shop invites to that address.';

NOTIFY pgrst, 'reload schema';
