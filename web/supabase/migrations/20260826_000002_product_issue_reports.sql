-- Tester / user issue reports for the Total Service Pro product team.
CREATE TABLE IF NOT EXISTS public.product_issue_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  what_happened text NOT NULL,
  page_url text,
  user_agent text,
  reporter_user_id uuid,
  reporter_email text,
  delivered_to_inbox boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE public.product_issue_reports IS
  'Short in-app issue reports from testers and users. Written by the app API (service role).';

ALTER TABLE public.product_issue_reports ENABLE ROW LEVEL SECURITY;

-- No authenticated policies: inserts/reads go through the service-role API route.
