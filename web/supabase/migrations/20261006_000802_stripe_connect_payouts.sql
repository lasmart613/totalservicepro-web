-- Stripe Connect payouts for invoice and marketplace parts card payments.
-- The selling organization receives the charge on stripe_account_id.
-- marketplace_orders records every paid parts checkout, including a held
-- payout when the money is not a completed transfer.
--
-- Sorts after 20261006_000801 so it runs after 20261006_000400 and
-- 20261006_000401. Those files revoke table UPDATE on organizations and
-- user_profiles, then re-grant a safe column list, and attach
-- guard_tenant_owner_cols to marketplace_listings. This file must not
-- GRANT anything those migrations revoked, and must not GRANT the new
-- Stripe columns to anon or authenticated. The Connect route and the
-- Stripe webhook write them with the service role.
--
-- Do not apply this file to production from the app. Ship the SQL only.

alter table public.organizations
  add column if not exists stripe_account_id text,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_payouts_enabled boolean not null default false,
  add column if not exists stripe_details_submitted boolean not null default false;

create unique index if not exists organizations_stripe_account_id_uidx
  on public.organizations (stripe_account_id)
  where stripe_account_id is not null;

comment on column public.organizations.stripe_account_id is
  'Stripe Connect account that receives this organization''s invoice and parts card payments.';

-- Column revoke only. Do not REVOKE or GRANT table UPDATE on organizations:
-- a table revoke would wipe the safe column list from 20261006_000400.
revoke update (
  stripe_account_id,
  stripe_charges_enabled,
  stripe_payouts_enabled,
  stripe_details_submitted
) on table public.organizations from public, anon, authenticated;

create table if not exists public.marketplace_orders (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.marketplace_listings(id) on delete set null,
  seller_organization_id bigint references public.organizations(id) on delete set null,
  stripe_checkout_session_id text not null unique,
  stripe_payment_intent_id text,
  stripe_account_id text,
  amount_cents integer not null,
  application_fee_cents integer not null default 0,
  currency text not null default 'usd',
  quantity integer not null default 1,
  buyer_email text,
  status text not null default 'paid',
  payout_status text not null default 'held',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.marketplace_orders.payout_status is
  'transferred = destination charge to the connected account. held = recorded order still owed to the seller.';

alter table public.marketplace_orders enable row level security;

drop policy if exists "Sellers read own marketplace orders" on public.marketplace_orders;
create policy "Sellers read own marketplace orders"
  on public.marketplace_orders
  for select
  to authenticated
  using (
    seller_organization_id in (
      select organization_id from public.user_profiles where id = auth.uid()
    )
  );

create index if not exists marketplace_orders_seller_idx
  on public.marketplace_orders (seller_organization_id, created_at desc);

-- New table. Sellers may read their own rows. Clients do not insert or update
-- orders; the webhook does that with the service role.
revoke insert, update, delete, truncate on table public.marketplace_orders from public, anon, authenticated;
grant select on table public.marketplace_orders to authenticated;

notify pgrst, 'reload schema';
