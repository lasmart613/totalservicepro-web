-- Organization display currency and number format.
-- Nullable number_format: null means "Automatic, from my language".
-- currency_code defaults to USD so existing US shops stay on dollars.
-- Display and labeling only. Do not convert FX. Do not change Stripe
-- charge currency or subscription prices.
--
-- Do not apply this file to production from the app. Ship the SQL only.
-- The app falls back to USD and the locale format when these columns
-- are missing.

alter table public.organizations
  add column if not exists currency_code text default 'USD',
  add column if not exists number_format text;

comment on column public.organizations.currency_code is
  'ISO 4217 display currency. Null or missing is treated as USD. Does not convert amounts and does not change Stripe.';

comment on column public.organizations.number_format is
  'Money display preset. Null or auto uses Intl.NumberFormat for the user locale. Presets: comma_dot_before, dot_comma_after, space_comma_after, apostrophe_dot_before.';
