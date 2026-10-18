-- Local proof for 20261018_000928_subscriptions_past_due_clock.sql and its
-- rollback. Empty Postgres 17 only (never production). Refuses to run when
-- public.subscriptions already exists. One transaction, ends in ROLLBACK.
-- Works from any directory (\ir paths are relative to this file).
--
--   createdb past_due_proof
--   psql "postgresql:///past_due_proof" -v ON_ERROR_STOP=1 \
--     -f path/to/web/supabase/tests/20261018_subscriptions_past_due_clock.sql
--
-- Fixture: public.subscriptions exactly as live on 2026-10-18 (columns,
-- defaults, CHECKs, uniques, indexes, grants; no triggers). BASE records the
-- table fingerprint; AFTER checks the clock rules; the rollback must restore
-- the BASE fingerprint exactly. Every check prints PASS or raises.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to run: public.subscriptions already exists';
  END IF;
END $$;

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.subscriptions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  subscription_type text,
  platform text,
  purchase_token text,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  tier text NOT NULL DEFAULT 'free'::text,
  sku text,
  status text NOT NULL DEFAULT 'active'::text,
  seat_count integer DEFAULT 1,
  stripe_subscription_id text,
  stripe_price_id text,
  stripe_product_id text,
  cancel_at_period_end boolean DEFAULT false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  organization_id bigint,
  package_name text,
  purchased_by uuid,
  CONSTRAINT subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT subscriptions_platform_check CHECK ((platform = ANY (ARRAY['google_play'::text, 'stripe'::text, 'manual'::text]))),
  CONSTRAINT subscriptions_purchased_by_fkey FOREIGN KEY (purchased_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT subscriptions_stripe_subscription_id_key UNIQUE (stripe_subscription_id),
  CONSTRAINT subscriptions_subscription_type_check CHECK ((subscription_type = ANY (ARRAY['monthly'::text, 'yearly'::text, 'lifetime'::text]))),
  CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT subscriptions_user_id_key UNIQUE (user_id),
  CONSTRAINT valid_status CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'cancelled'::text, 'grace_period'::text]))),
  CONSTRAINT valid_tier CHECK ((tier = ANY (ARRAY['free'::text, 'premium'::text, 'team'::text, 'enterprise'::text])))
);
CREATE INDEX subscriptions_org_idx ON public.subscriptions USING btree (organization_id);
CREATE INDEX subscriptions_user_idx ON public.subscriptions USING btree (user_id);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.subscriptions TO anon, authenticated;
GRANT ALL ON public.subscriptions TO service_role;

-- Users u1..u9 (fixed uuids). Orgs are plain ids (2655 / 2639 / 2656 / 2668 /
-- 2669 are QA fixtures; 1005 is never used).
INSERT INTO auth.users (id)
SELECT ('00000000-0000-0000-0000-00000000000' || g)::uuid FROM generate_series(1, 9) g;

-- Pre-migration rows: a Stripe row already past_due (no clock column yet),
-- an active Stripe row, a Google Play row in grace, a manual row (comp-like,
-- no Stripe id) and a cancelled Stripe row.
INSERT INTO public.subscriptions (user_id, platform, tier, status, stripe_subscription_id, organization_id, subscription_type) VALUES
  ('00000000-0000-0000-0000-000000000001', 'stripe', 'premium', 'grace_period', 'sub_pre_pastdue', 2655, 'monthly'),
  ('00000000-0000-0000-0000-000000000002', 'stripe', 'premium', 'active', 'sub_pre_active', 2639, 'monthly'),
  ('00000000-0000-0000-0000-000000000003', 'google_play', 'premium', 'grace_period', NULL, 2656, 'monthly'),
  ('00000000-0000-0000-0000-000000000004', 'manual', 'premium', 'active', NULL, 2668, 'yearly'),
  ('00000000-0000-0000-0000-000000000005', 'stripe', 'free', 'cancelled', 'sub_pre_cancelled', 2669, 'monthly');

CREATE TEMP TABLE proof_base AS
SELECT
  (SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod) || ':' || attnotnull, ',' ORDER BY attnum)
     FROM pg_attribute WHERE attrelid = 'public.subscriptions'::regclass AND attnum > 0 AND NOT attisdropped) AS cols,
  (SELECT string_agg(indexdef, ';' ORDER BY indexdef) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'subscriptions') AS idx,
  (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.subscriptions'::regclass AND NOT tgisinternal) AS trg,
  (SELECT string_agg(conname || '=' || pg_get_constraintdef(oid), ';' ORDER BY conname) FROM pg_constraint WHERE conrelid = 'public.subscriptions'::regclass) AS cons,
  (SELECT relacl::text FROM pg_class WHERE oid = 'public.subscriptions'::regclass) AS acl,
  (SELECT count(*) FROM pg_proc WHERE proname = 'subscriptions_past_due_clock') AS fns,
  (SELECT md5(string_agg(row(t.id, t.user_id, t.subscription_type, t.platform, t.purchase_token, t.expires_at, t.created_at,
            t.tier, t.sku, t.status, t.seat_count, t.stripe_subscription_id, t.stripe_price_id, t.stripe_product_id,
            t.cancel_at_period_end, t.current_period_start, t.current_period_end, t.organization_id, t.package_name,
            t.purchased_by, t.updated_at)::text, '|' ORDER BY t.user_id)) FROM public.subscriptions t) AS rows_md5;

DO $$ BEGIN RAISE NOTICE 'PASS base: fixture built (5 rows, no trigger, no past_due_since)'; END $$;

-- ---------------------------------------------------------------- apply ---
SAVEPOINT apply_000928;
\ir ../migrations/20261018_000928_subscriptions_past_due_clock.sql

DO $$
DECLARE r record;
BEGIN
  -- Objects.
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.subscriptions'::regclass
                 AND attname = 'past_due_since' AND atttypid = 'timestamptz'::regtype AND NOT attnotnull AND NOT attisdropped) THEN
    RAISE EXCEPTION 'FAILED: past_due_since column';
  END IF;
  SELECT p.prosecdef, p.proconfig INTO r FROM pg_proc p WHERE p.oid = 'public.subscriptions_past_due_clock()'::regprocedure;
  IF NOT r.prosecdef OR r.proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
    RAISE EXCEPTION 'FAILED: function must be SECURITY DEFINER with search_path '''' (got %, %)', r.prosecdef, r.proconfig;
  END IF;
  IF has_function_privilege('anon', 'public.subscriptions_past_due_clock()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.subscriptions_past_due_clock()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.subscriptions_past_due_clock()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAILED: clock function must not be executable by anon/authenticated/service_role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.subscriptions'::regclass
                 AND tgname = 'subscriptions_past_due_clock' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'FAILED: trigger';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'subscriptions_past_due_since_idx'
                 AND indexdef LIKE '%WHERE (status = ''grace_period''::text)%') THEN
    RAISE EXCEPTION 'FAILED: partial index';
  END IF;
  RAISE NOTICE 'PASS objects: column, SECURITY DEFINER trigger fn (search_path '''', no EXECUTE grants), trigger, partial index';

  -- Conservative backfill: only the Stripe past_due row, clock = apply time.
  IF (SELECT past_due_since FROM public.subscriptions WHERE stripe_subscription_id = 'sub_pre_pastdue') IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'FAILED: existing past_due row must start its clock at apply time';
  END IF;
  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE past_due_since IS NOT NULL AND stripe_subscription_id IS DISTINCT FROM 'sub_pre_pastdue') THEN
    RAISE EXCEPTION 'FAILED: backfill touched a non-past_due or non-Stripe row';
  END IF;
  IF (SELECT count(*) FROM public.subscriptions WHERE status = 'grace_period' AND platform = 'google_play' AND past_due_since IS NULL) <> 1 THEN
    RAISE EXCEPTION 'FAILED: Google Play grace row must not get a Stripe clock';
  END IF;
  RAISE NOTICE 'PASS backfill: only the existing Stripe past_due row, at apply time (not retroactive); Play/manual/active/cancelled untouched';

  -- Other columns of the pre-existing rows are unchanged.
  IF (SELECT md5(string_agg(row(t.id, t.user_id, t.subscription_type, t.platform, t.purchase_token, t.expires_at, t.created_at,
            t.tier, t.sku, t.status, t.seat_count, t.stripe_subscription_id, t.stripe_price_id, t.stripe_product_id,
            t.cancel_at_period_end, t.current_period_start, t.current_period_end, t.organization_id, t.package_name,
            t.purchased_by, t.updated_at)::text, '|' ORDER BY t.user_id)) FROM public.subscriptions t)
     IS DISTINCT FROM (SELECT rows_md5 FROM proof_base) THEN
    RAISE EXCEPTION 'FAILED: apply changed existing columns';
  END IF;
  RAISE NOTICE 'PASS apply leaves every pre-existing column value as it was';
END $$;

-- Rules exercised as service_role (the webhook / sweep writer). Trigger
-- functions fire without EXECUTE on the function.
SET LOCAL ROLE service_role;

-- active -> past_due starts the clock now.
UPDATE public.subscriptions SET status = 'grace_period' WHERE stripe_subscription_id = 'sub_pre_active';
DO $$ BEGIN
  IF (SELECT past_due_since FROM public.subscriptions WHERE stripe_subscription_id = 'sub_pre_active') IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'FAILED: active -> grace_period must start the clock';
  END IF;
  RAISE NOTICE 'PASS active -> past_due starts the clock (as service_role, no EXECUTE grant needed)';
END $$;
RESET ROLE;

-- Simulate a clock that started 10 days ago (trigger off only for this setup).
ALTER TABLE public.subscriptions DISABLE TRIGGER subscriptions_past_due_clock;
UPDATE public.subscriptions SET past_due_since = now() - interval '10 days' WHERE stripe_subscription_id = 'sub_pre_active';
ALTER TABLE public.subscriptions ENABLE TRIGGER subscriptions_past_due_clock;

SET LOCAL ROLE service_role;
-- Replayed past_due writes, an explicit reset and an explicit NULL all keep it.
UPDATE public.subscriptions SET status = 'grace_period', updated_at = now() WHERE stripe_subscription_id = 'sub_pre_active';
UPDATE public.subscriptions SET past_due_since = now() WHERE stripe_subscription_id = 'sub_pre_active';
UPDATE public.subscriptions SET past_due_since = NULL WHERE stripe_subscription_id = 'sub_pre_active';
UPDATE public.subscriptions SET past_due_since = now() - interval '400 days' WHERE stripe_subscription_id = 'sub_pre_active';
UPDATE public.subscriptions SET tier = 'free' WHERE stripe_subscription_id = 'sub_pre_active';
DO $$ BEGIN
  IF (SELECT past_due_since FROM public.subscriptions WHERE stripe_subscription_id = 'sub_pre_active') IS DISTINCT FROM now() - interval '10 days' THEN
    RAISE EXCEPTION 'FAILED: the clock moved during one past_due episode';
  END IF;
  RAISE NOTICE 'PASS one past_due episode keeps its clock (replay, reset to now, NULL, backdate, tier write)';
END $$;

-- past_due -> expired keeps it as history; expired -> grace_period (same sub) keeps it.
UPDATE public.subscriptions SET status = 'expired' WHERE stripe_subscription_id = 'sub_pre_active';
DO $$ BEGIN
  IF (SELECT past_due_since FROM public.subscriptions WHERE stripe_subscription_id = 'sub_pre_active') IS DISTINCT FROM now() - interval '10 days' THEN
    RAISE EXCEPTION 'FAILED: expired must keep past_due_since';
  END IF;
  RAISE NOTICE 'PASS past_due -> expired keeps the clock as history';
END $$;

-- Recovery: back to active clears it.
UPDATE public.subscriptions SET status = 'active', tier = 'premium' WHERE stripe_subscription_id = 'sub_pre_active';
DO $$ BEGIN
  IF (SELECT past_due_since FROM public.subscriptions WHERE stripe_subscription_id = 'sub_pre_active') IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED: recovery must clear the clock';
  END IF;
  RAISE NOTICE 'PASS recovery (active) clears the clock';
END $$;

-- A later past_due is a new episode: starts now, not at the old time.
UPDATE public.subscriptions SET status = 'grace_period' WHERE stripe_subscription_id = 'sub_pre_active';
DO $$ BEGIN
  IF (SELECT past_due_since FROM public.subscriptions WHERE stripe_subscription_id = 'sub_pre_active') IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'FAILED: a new past_due episode must start now';
  END IF;
  RAISE NOTICE 'PASS a second past_due episode starts a fresh clock';
END $$;
RESET ROLE;

-- A new Stripe subscription id on the same ledger row starts fresh.
ALTER TABLE public.subscriptions DISABLE TRIGGER subscriptions_past_due_clock;
UPDATE public.subscriptions SET past_due_since = now() - interval '30 days' WHERE stripe_subscription_id = 'sub_pre_pastdue';
ALTER TABLE public.subscriptions ENABLE TRIGGER subscriptions_past_due_clock;
UPDATE public.subscriptions SET stripe_subscription_id = 'sub_new_pastdue' WHERE stripe_subscription_id = 'sub_pre_pastdue';
UPDATE public.subscriptions SET stripe_subscription_id = 'sub_new_cancelled', status = 'cancelled' WHERE stripe_subscription_id = 'sub_pre_cancelled';
DO $$ BEGIN
  IF (SELECT past_due_since FROM public.subscriptions WHERE stripe_subscription_id = 'sub_new_pastdue') IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'FAILED: new subscription id in grace must start a fresh clock';
  END IF;
  IF (SELECT past_due_since FROM public.subscriptions WHERE stripe_subscription_id = 'sub_new_cancelled') IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED: new subscription id outside grace must have no clock';
  END IF;
  RAISE NOTICE 'PASS a new stripe_subscription_id starts fresh (grace: now; otherwise NULL)';
END $$;

-- Inserts: grace starts now (no backdating); active / non-Stripe have none.
INSERT INTO public.subscriptions (user_id, platform, tier, status, stripe_subscription_id, organization_id, past_due_since) VALUES
  ('00000000-0000-0000-0000-000000000006', 'stripe', 'premium', 'grace_period', 'sub_ins_grace', 2668, now() - interval '90 days'),
  ('00000000-0000-0000-0000-000000000007', 'stripe', 'premium', 'active', 'sub_ins_active', 2669, now() - interval '90 days'),
  ('00000000-0000-0000-0000-000000000008', 'manual', 'premium', 'grace_period', NULL, 2656, NULL);
DO $$ BEGIN
  IF (SELECT past_due_since FROM public.subscriptions WHERE stripe_subscription_id = 'sub_ins_grace') IS DISTINCT FROM now()
     OR (SELECT past_due_since FROM public.subscriptions WHERE stripe_subscription_id = 'sub_ins_active') IS NOT NULL
     OR (SELECT past_due_since FROM public.subscriptions WHERE user_id = '00000000-0000-0000-0000-000000000008') IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED: insert rules';
  END IF;
  RAISE NOTICE 'PASS inserts: grace starts now (backdate ignored); active and non-Stripe rows get no clock';
END $$;

-- Clients still cannot write the table (unchanged grants).
DO $$ BEGIN
  IF has_table_privilege('authenticated', 'public.subscriptions', 'UPDATE')
     OR has_table_privilege('anon', 'public.subscriptions', 'UPDATE')
     OR has_column_privilege('anon', 'public.subscriptions', 'past_due_since', 'UPDATE') THEN
    RAISE EXCEPTION 'FAILED: clients must not write subscriptions';
  END IF;
  RAISE NOTICE 'PASS anon/authenticated still have no write on subscriptions (grants unchanged)';
END $$;

-- The sweep's query shape: due rows only (>= 14 days, grace, not yet free).
ALTER TABLE public.subscriptions DISABLE TRIGGER subscriptions_past_due_clock;
UPDATE public.subscriptions SET past_due_since = now() - interval '13 days 23 hours' WHERE stripe_subscription_id = 'sub_ins_grace';
UPDATE public.subscriptions SET past_due_since = now() - interval '14 days' WHERE stripe_subscription_id = 'sub_new_pastdue';
ALTER TABLE public.subscriptions ENABLE TRIGGER subscriptions_past_due_clock;
DO $$
DECLARE due text[];
BEGIN
  SELECT array_agg(stripe_subscription_id ORDER BY stripe_subscription_id) INTO due
  FROM public.subscriptions
  WHERE platform = 'stripe' AND status = 'grace_period' AND tier <> 'free'
    AND past_due_since IS NOT NULL AND past_due_since <= now() - interval '14 days';
  IF due IS DISTINCT FROM ARRAY['sub_new_pastdue'] THEN
    RAISE EXCEPTION 'FAILED: sweep selection %', due;
  END IF;
  RAISE NOTICE 'PASS sweep selection: day 14 is due, day 13d23h is not';
END $$;

-- Re-run is a no-op (drift guard accepts its own body; clocks unchanged).
CREATE TEMP TABLE proof_clocks AS SELECT stripe_subscription_id, past_due_since FROM public.subscriptions;
\ir ../migrations/20261018_000928_subscriptions_past_due_clock.sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.subscriptions s JOIN proof_clocks c USING (stripe_subscription_id)
             WHERE s.past_due_since IS DISTINCT FROM c.past_due_since) THEN
    RAISE EXCEPTION 'FAILED: re-run changed a clock';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.subscriptions'::regclass AND NOT tgisinternal) <> 1 THEN
    RAISE EXCEPTION 'FAILED: re-run duplicated the trigger';
  END IF;
  RAISE NOTICE 'PASS re-run is idempotent (guard accepts own body, clocks unchanged, one trigger)';
END $$;

-- Drift guard refuses a foreign body.
SAVEPOINT drift;
CREATE OR REPLACE FUNCTION public.subscriptions_past_due_clock() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$;
-- ON_ERROR_ROLLBACK keeps the guard's error as LAST_ERROR_MESSAGE (the rest
-- of the file then runs and is undone by the savepoint rollback below).
\set ON_ERROR_STOP off
\set ON_ERROR_ROLLBACK on
\ir ../migrations/20261018_000928_subscriptions_past_due_clock.sql
\set ON_ERROR_ROLLBACK off
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT drift;
SELECT (:'LAST_ERROR_MESSAGE' LIKE '%exists with another body; refusing to overwrite%') AS drift_ok \gset
\if :drift_ok
DO $$ BEGIN RAISE NOTICE 'PASS drift guard refuses a foreign subscriptions_past_due_clock() body (the guard error above is expected)'; END $$;
\else
DO $$ BEGIN RAISE EXCEPTION 'FAILED: drift guard did not refuse a foreign body'; END $$;
\endif
DO $$ BEGIN
  IF md5(pg_get_functiondef('public.subscriptions_past_due_clock()'::regprocedure)) <> '2a0d072a45f52660ba23f4822738c26a' THEN
    RAISE EXCEPTION 'FAILED: savepoint rollback did not restore the 000928 body';
  END IF;
  RAISE NOTICE 'PASS the applied body has the md5 the drift guard records';
END $$;

-- ------------------------------------------------------------- rollback ---
\ir ../migrations/20261018_000928_subscriptions_past_due_clock_rollback.sql
DO $$
DECLARE b record;
BEGIN
  SELECT * INTO b FROM proof_base;
  IF (SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod) || ':' || attnotnull, ',' ORDER BY attnum)
        FROM pg_attribute WHERE attrelid = 'public.subscriptions'::regclass AND attnum > 0 AND NOT attisdropped) IS DISTINCT FROM b.cols
     OR (SELECT string_agg(indexdef, ';' ORDER BY indexdef) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'subscriptions') IS DISTINCT FROM b.idx
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.subscriptions'::regclass AND NOT tgisinternal) IS DISTINCT FROM b.trg
     OR (SELECT string_agg(conname || '=' || pg_get_constraintdef(oid), ';' ORDER BY conname) FROM pg_constraint WHERE conrelid = 'public.subscriptions'::regclass) IS DISTINCT FROM b.cons
     OR (SELECT relacl::text FROM pg_class WHERE oid = 'public.subscriptions'::regclass) IS DISTINCT FROM b.acl
     OR (SELECT count(*) FROM pg_proc WHERE proname = 'subscriptions_past_due_clock') IS DISTINCT FROM b.fns THEN
    RAISE EXCEPTION 'FAILED: rollback did not restore the BASE fingerprint';
  END IF;
  RAISE NOTICE 'PASS rollback restores the BASE fingerprint (columns, indexes, triggers, constraints, ACL, no function)';
END $$;
\ir ../migrations/20261018_000928_subscriptions_past_due_clock_rollback.sql
DO $$ BEGIN RAISE NOTICE 'PASS rollback re-run is a no-op'; END $$;

-- Apply again after rollback (round trip).
\ir ../migrations/20261018_000928_subscriptions_past_due_clock.sql
DO $$ BEGIN
  IF to_regprocedure('public.subscriptions_past_due_clock()') IS NULL THEN RAISE EXCEPTION 'FAILED: re-apply after rollback'; END IF;
  RAISE NOTICE 'PASS apply -> rollback -> apply round trip';
END $$;

ROLLBACK;
