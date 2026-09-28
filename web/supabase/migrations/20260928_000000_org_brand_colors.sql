-- Premium company branding colors.
-- Nullable on purpose: null means "use the RepairPlanet default".
-- Do not apply this file to production from the app. Ship the SQL only;
-- a person applies it when the organizations table is ready.
--
-- Free plans may have values stored later, but document rendering ignores
-- them unless the org is on a paid plan (see getCompanyTheme).

alter table public.organizations
  add column if not exists brand_primary_color text,
  add column if not exists brand_accent_color text;

comment on column public.organizations.brand_primary_color is
  'Optional #RRGGBB primary brand color. Null uses the RepairPlanet default. Applied only for paid plans.';

comment on column public.organizations.brand_accent_color is
  'Optional #RRGGBB accent brand color. Null uses the RepairPlanet default. Applied only for paid plans.';
