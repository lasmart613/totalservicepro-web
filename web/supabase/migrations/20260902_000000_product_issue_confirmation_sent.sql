-- Track whether the reporter already received a confirmation for this report.
ALTER TABLE public.product_issue_reports
  ADD COLUMN IF NOT EXISTS confirmation_sent boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.product_issue_reports.confirmation_sent IS
  'True after one confirmation email was sent to the reporter. Prevents a second copy.';
