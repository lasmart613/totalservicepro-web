-- Shop UI language at the moment an estimate is emailed.
-- Null means the customer page keeps today's fallback:
-- ?lang=, then Accept-Language, then English.
-- No default and no backfill. Old rows stay null.
--
-- Do not apply this file to production from the app. Ship the SQL only.
-- The app keeps working when the column is missing.
--
-- #215 (20261006_000401_open_write_policies.sql) rebuilds column grants for
-- other tables and does not list service_estimates. This grant is additive.
-- If a later migration narrows service_estimates to an explicit column list
-- that was generated before this column existed, document_locale stays granted.

alter table public.service_estimates
  add column if not exists document_locale text;

comment on column public.service_estimates.document_locale is
  'Site language (en, de, ar, ...) of the shop UI when the estimate was sent. Null uses the customer page fallback.';

grant select (document_locale), update (document_locale)
  on table public.service_estimates to authenticated;
