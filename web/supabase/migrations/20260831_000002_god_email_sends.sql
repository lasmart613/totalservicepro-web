-- God-dashboard shop-invite send log. Larry only, via service-role API.
-- This repo does not auto-apply SQL. Run in the live Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.god_email_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  organization_id bigint,
  organization_name text,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  template_key text NOT NULL DEFAULT 'shop_invite',
  sent_by_user_id uuid,
  sent_by_email text
);

COMMENT ON TABLE public.god_email_sends IS
  'Manual God-dashboard email sends. Written by the app API (service role). No automatic blast.';

CREATE INDEX IF NOT EXISTS god_email_sends_org_created_idx
  ON public.god_email_sends (organization_id, created_at DESC);

ALTER TABLE public.god_email_sends ENABLE ROW LEVEL SECURITY;

-- No authenticated policies: inserts/reads go through the service-role API route.

NOTIFY pgrst, 'reload schema';
