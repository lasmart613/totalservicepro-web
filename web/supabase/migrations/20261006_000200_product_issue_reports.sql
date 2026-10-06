-- In-app "Report an Issue" rows. The table was missing on live (Oct 2026).
-- Safe to re-run. Does not require 20260826 / 20260902 to have been applied.
-- The Next.js API writes with the service role. RLS covers direct client access.
-- Logged-out reports are allowed (the form has an optional guest email).

CREATE TABLE IF NOT EXISTS public.product_issue_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  what_happened text NOT NULL,
  page_url text,
  user_agent text,
  reporter_user_id uuid DEFAULT auth.uid(),
  reporter_email text,
  delivered_to_inbox boolean NOT NULL DEFAULT false,
  confirmation_sent boolean NOT NULL DEFAULT false
);

ALTER TABLE public.product_issue_reports
  ADD COLUMN IF NOT EXISTS what_happened text,
  ADD COLUMN IF NOT EXISTS page_url text,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS reporter_user_id uuid DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS reporter_email text,
  ADD COLUMN IF NOT EXISTS delivered_to_inbox boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmation_sent boolean NOT NULL DEFAULT false;

COMMENT ON TABLE public.product_issue_reports IS
  'Short in-app issue reports. Inserted by the app API (service role) and by the reporter.';

ALTER TABLE public.product_issue_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_issue_reports_insert_authenticated ON public.product_issue_reports;
CREATE POLICY product_issue_reports_insert_authenticated
  ON public.product_issue_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (reporter_user_id = auth.uid());

DROP POLICY IF EXISTS product_issue_reports_insert_anon ON public.product_issue_reports;
CREATE POLICY product_issue_reports_insert_anon
  ON public.product_issue_reports
  FOR INSERT
  TO anon
  WITH CHECK (reporter_user_id IS NULL);

-- A signed-in reporter reads only their own rows.
-- Platform admins read every row through the service role
-- (God table APIs behind requireGodCaller).
DROP POLICY IF EXISTS product_issue_reports_select_own_or_admin ON public.product_issue_reports;
DROP POLICY IF EXISTS product_issue_reports_select_own ON public.product_issue_reports;
CREATE POLICY product_issue_reports_select_own
  ON public.product_issue_reports
  FOR SELECT
  TO authenticated
  USING (reporter_user_id = auth.uid());

GRANT SELECT, INSERT ON TABLE public.product_issue_reports TO authenticated;
GRANT INSERT ON TABLE public.product_issue_reports TO anon;
GRANT ALL ON TABLE public.product_issue_reports TO service_role;

CREATE INDEX IF NOT EXISTS product_issue_reports_reporter_idx
  ON public.product_issue_reports (reporter_user_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
