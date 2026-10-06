-- Organization IANA timezone for document numbers, email dates, and report headers.
-- Null means: derive from organizations.state, then America/Los_Angeles.
--
-- Do not apply this file to production from the app. Ship the SQL only.
-- The app keeps working when the column is missing.

alter table public.organizations
  add column if not exists timezone text;

comment on column public.organizations.timezone is
  'IANA timezone (America/Los_Angeles). Null uses the address state, then America/Los_Angeles. Does not change stored invoice dates.';
