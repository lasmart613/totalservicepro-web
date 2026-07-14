-- Migration: manufacturers + laser_models for dropdowns in service reports / tickets
-- These tables replace / supplement the static MODELS in lib/models.ts for basic make/model selects.
-- Rich perf data (wavelengths etc) can live in laser_models as jsonb or stay in MODELS for now.

create table if not exists manufacturers (
  id bigserial primary key,
  name text not null unique,
  created_at timestamptz default now()
);

create table if not exists laser_models (
  id bigserial primary key,
  name text not null,                 -- e.g. 'GentleLASE' or key
  label text,                         -- display name
  manufacturer_id bigint references manufacturers(id) on delete set null,
  wavelengths jsonb,                  -- array of {name, mode, sets, unit, ...} matching old ModelDef
  params jsonb,                       -- string[]
  dye_params boolean default false,
  wl_test boolean default false,
  gas_test boolean default false,
  fiber_test boolean default false,
  bbl_test boolean default false,
  created_at timestamptz default now()
);

-- Basic RLS (adjust as needed)
alter table manufacturers enable row level security;
alter table laser_models enable row level security;

-- Allow authenticated read for dropdowns
create policy if not exists "read manufacturers" on manufacturers for select to authenticated using (true);
create policy if not exists "read laser_models" on laser_models for select to authenticated using (true);

-- (Optional) admin write policies or use service role for maintenance.

-- Example seed (run after inserting manufacturers)
-- insert into laser_models (name, label, manufacturer_id, wavelengths, params) values ...
