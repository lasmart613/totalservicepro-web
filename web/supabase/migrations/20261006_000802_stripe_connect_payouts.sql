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

SET LOCAL lock_timeout = '5s';

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

-- Same client-write guard as 20261006_000400, plus the Stripe columns.
-- auth.uid() is null for the service role, so the webhook and Connect route
-- still write these columns. A signed-in client cannot.
CREATE OR REPLACE FUNCTION public.organizations_guard_privilege()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  newj jsonb := to_jsonb(NEW);
  oldj jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'created_by must be the signed-in user';
    END IF;
    IF coalesce((newj->>'is_premium')::boolean, false) IS TRUE THEN
      RAISE EXCEPTION 'is_premium cannot be self-granted';
    END IF;
    IF nullif(newj->>'premium_until', '') IS NOT NULL
       OR nullif(newj->>'premium_grant', '') IS NOT NULL THEN
      RAISE EXCEPTION 'premium fields cannot be self-granted';
    END IF;
    IF lower(coalesce(newj->>'subscription_tier', '')) NOT IN ('', 'free')
       OR lower(coalesce(newj->>'plan', '')) NOT IN ('', 'free') THEN
      RAISE EXCEPTION 'plan cannot be self-granted';
    END IF;
    IF nullif(newj->>'stripe_account_id', '') IS NOT NULL
       OR coalesce((newj->>'stripe_charges_enabled')::boolean, false)
       OR coalesce((newj->>'stripe_payouts_enabled')::boolean, false)
       OR coalesce((newj->>'stripe_details_submitted')::boolean, false) THEN
      RAISE EXCEPTION 'stripe connect fields cannot be set by the client';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'created_by cannot be changed';
  END IF;
  IF (newj->>'is_premium') IS DISTINCT FROM (oldj->>'is_premium')
     OR (newj->>'premium_until') IS DISTINCT FROM (oldj->>'premium_until')
     OR (newj->>'premium_grant') IS DISTINCT FROM (oldj->>'premium_grant')
     OR (newj->>'subscription_tier') IS DISTINCT FROM (oldj->>'subscription_tier')
     OR (newj->>'plan') IS DISTINCT FROM (oldj->>'plan') THEN
    RAISE EXCEPTION 'plan and premium fields cannot be changed by the client';
  END IF;
  IF (newj->>'stripe_account_id') IS DISTINCT FROM (oldj->>'stripe_account_id')
     OR (newj->>'stripe_charges_enabled') IS DISTINCT FROM (oldj->>'stripe_charges_enabled')
     OR (newj->>'stripe_payouts_enabled') IS DISTINCT FROM (oldj->>'stripe_payouts_enabled')
     OR (newj->>'stripe_details_submitted') IS DISTINCT FROM (oldj->>'stripe_details_submitted') THEN
    RAISE EXCEPTION 'stripe connect fields cannot be changed by the client';
  END IF;
  RETURN NEW;
END;
$$;

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
    seller_organization_id is not null
    and (
      exists (
        select 1
        from public.organization_memberships m
        where m.user_id = (select auth.uid())
          and m.organization_id = marketplace_orders.seller_organization_id
          and lower(btrim(m.role)) in ('admin', 'company_admin', 'billing_manager')
      )
      or exists (
        select 1
        from public.user_profiles p
        where p.id = (select auth.uid())
          and p.organization_id = marketplace_orders.seller_organization_id
          and lower(btrim(p.role)) in ('admin', 'company_admin', 'billing_manager')
      )
    )
  );

create index if not exists marketplace_orders_seller_idx
  on public.marketplace_orders (seller_organization_id, created_at desc);

-- New table. Admin, company_admin, and billing_manager of the seller org may
-- read orders. Anon gets nothing (default privileges include SELECT and
-- MAINTAIN). Clients do not insert or update; the webhook uses the service role.
revoke all on table public.marketplace_orders from public, anon;
revoke insert, update, delete, truncate, maintain on table public.marketplace_orders from authenticated;
grant select on table public.marketplace_orders to authenticated;

notify pgrst, 'reload schema';
