-- Local proof for 20261019_000935_marketplace_listings_private_columns.sql and its rollback.
-- Empty Postgres 17 scratch database only (never production). Refuses to run when
-- public.marketplace_listings already exists. Prod-shaped: same columns, same table
-- ACL (anon=rm, authenticated=arwdm), same 8 policies, same guard trigger shape.
-- Fixture rows are synthetic.
--
--   createdb listings_proof
--   psql "postgresql:///listings_proof" -v ON_ERROR_STOP=1 \
--     -f path/to/web/supabase/tests/20261019_marketplace_listings_private_columns.sql
--   dropdb listings_proof
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF to_regclass('public.marketplace_listings') IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to run: public.marketplace_listings already exists';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
-- prod default ACL for functions created by postgres in public
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.organization_memberships (id bigserial PRIMARY KEY, user_id uuid NOT NULL, organization_id bigint NOT NULL, role text);
CREATE OR REPLACE FUNCTION public.is_active_org_member(p_org bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.user_id = auth.uid() AND m.organization_id = p_org); $$;
CREATE OR REPLACE FUNCTION public.caller_in_org(p_org bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$ SELECT public.is_active_org_member(p_org) $$;

-- prod columns, in prod order
CREATE TABLE public.marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'part',
  condition text NOT NULL DEFAULT 'used',
  manufacturer text, model text, part_number text, serial_number text, wavelength text,
  price numeric, price_type text DEFAULT 'fixed', currency text DEFAULT 'USD',
  photos jsonb DEFAULT '[]'::jsonb, city text, state text, zip text,
  status text DEFAULT 'active', views integer DEFAULT 0,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  created_by uuid, organization_id bigint, listing_type text,
  images jsonb DEFAULT '[]'::jsonb, details jsonb DEFAULT '{}'::jsonb, notes text,
  year_manufactured integer, qty integer DEFAULT 1, quantity integer DEFAULT 1
);
ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketplace_listings FROM PUBLIC;
GRANT SELECT, MAINTAIN ON public.marketplace_listings TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, MAINTAIN ON public.marketplace_listings TO authenticated;
GRANT ALL ON public.marketplace_listings TO service_role;

CREATE POLICY "Anyone can view active listings" ON public.marketplace_listings FOR SELECT
  USING ((status = 'active'::text) OR (seller_id = auth.uid()));
CREATE POLICY "Authed users can create listings" ON public.marketplace_listings FOR INSERT
  WITH CHECK (seller_id = auth.uid());
CREATE POLICY "Sellers can update own listings" ON public.marketplace_listings FOR UPDATE
  USING (seller_id = auth.uid());
CREATE POLICY "Sellers can delete own listings" ON public.marketplace_listings FOR DELETE
  USING (seller_id = auth.uid());
CREATE POLICY "Owners manage own listings" ON public.marketplace_listings
  USING ((seller_id = auth.uid()) OR (created_by = auth.uid()))
  WITH CHECK ((seller_id = auth.uid()) OR (created_by = auth.uid()));
CREATE POLICY "Authenticated can view active listings" ON public.marketplace_listings FOR SELECT TO authenticated
  USING (status = 'active'::text);
CREATE POLICY "Sellers select own listings" ON public.marketplace_listings FOR SELECT TO authenticated
  USING ((status = ANY (ARRAY['active'::text, 'open'::text, 'published'::text, 'sold'::text, 'draft'::text]))
         OR (seller_id = auth.uid()) OR (created_by = auth.uid()));
CREATE POLICY "Sellers update own listings" ON public.marketplace_listings FOR UPDATE TO authenticated
  USING ((seller_id = auth.uid()) OR (created_by = auth.uid()))
  WITH CHECK ((seller_id = auth.uid()) OR (created_by = auth.uid()));

-- prod guard trigger (same body)
CREATE OR REPLACE FUNCTION public.guard_tenant_owner_cols() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  n jsonb := to_jsonb(NEW);
  o jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
  c text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF (n->>'organization_id') IS NOT NULL
     AND (TG_OP = 'INSERT' OR (n->>'organization_id') IS DISTINCT FROM (o->>'organization_id'))
     AND NOT public.caller_in_org((n->>'organization_id')::bigint) THEN
    RAISE EXCEPTION 'organization_id must be an organization you belong to' USING ERRCODE = '42501';
  END IF;
  FOREACH c IN ARRAY ARRAY['created_by', 'seller_id'] LOOP
    IF n ? c THEN
      IF TG_OP = 'INSERT' AND (n->>c) IS NOT NULL AND (n->>c)::uuid <> auth.uid() THEN
        RAISE EXCEPTION '% must be the signed-in user', c USING ERRCODE = '42501';
      END IF;
      IF TG_OP = 'UPDATE' AND (n->>c) IS DISTINCT FROM (o->>c) THEN
        RAISE EXCEPTION '% cannot be changed', c USING ERRCODE = '42501';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_tenant_owner_cols BEFORE INSERT OR UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_owner_cols();

-- users: S = seller (org 501), C = colleague (org 501, not seller), X = stranger (org 502)
CREATE FUNCTION public._as(p text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', CASE p
    WHEN 'S' THEN 'aaaaaaaa-0000-0000-0000-000000000001'
    WHEN 'C' THEN 'aaaaaaaa-0000-0000-0000-000000000002'
    WHEN 'X' THEN 'aaaaaaaa-0000-0000-0000-000000000003'
    ELSE '' END, false)::text::void $$;
GRANT EXECUTE ON FUNCTION public._as(text) TO anon, authenticated;
INSERT INTO public.organization_memberships (user_id, organization_id, role) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001', 501, 'owner'),
 ('aaaaaaaa-0000-0000-0000-000000000002', 501, 'fse'),
 ('aaaaaaaa-0000-0000-0000-000000000003', 502, 'owner');
INSERT INTO public.marketplace_listings (id, seller_id, created_by, organization_id, title, status, listing_type, serial_number, notes, part_number, details) VALUES
 ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 501,
  'Active part', 'active', 'part', 'SN-ACTIVE', 'internal note', 'PN-1',
  '{"sku":"SKU-1","stripe_product_id":"prod_1","stripe_price_id":"price_1","stripe_price_cents":12300,"Seller_Email":"s@x.test","shipping":{"Price_Stripe_Id":"p","days":3},"compatible_models":[{"contact_phone":"1","m":"GentleLase"}],"warranty":"90 days"}'),
 ('11111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 501,
  'Draft part', 'draft', 'part', 'SN-DRAFT', 'draft note', 'PN-2', '{"sku":"SKU-2"}'),
 ('11111111-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 501,
  'Removed part', 'removed', 'part', NULL, NULL, 'PN-3', '{}'),
 ('11111111-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 501,
  'Sold part', 'sold', 'part', NULL, NULL, 'PN-4', '[1,{"stripe_x":1}]');

-- ---------------------------------------------------------------- snapshot (exactness baseline)
CREATE TABLE public._snap_pre AS
SELECT 'col:' || a.attname AS k, coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(a.attacl) x), '') AS v
  FROM pg_attribute a WHERE a.attrelid = 'public.marketplace_listings'::regclass AND a.attnum > 0 AND NOT a.attisdropped
UNION ALL SELECT 'relacl', (SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(relacl) x) FROM pg_class WHERE oid = 'public.marketplace_listings'::regclass
UNION ALL SELECT 'pol:' || polname, polcmd::text || '|' || polroles::regrole[]::text || '|' || coalesce(pg_get_expr(polqual, polrelid), '') || '|' || coalesce(pg_get_expr(polwithcheck, polrelid), '')
  FROM pg_policy WHERE polrelid = 'public.marketplace_listings'::regclass
UNION ALL SELECT 'fn:' || p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) || coalesce(p.proacl::text, '')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname NOT LIKE '\_%'
UNION ALL SELECT 'trg:' || tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'public.marketplace_listings'::regclass AND NOT tgisinternal;

-- ---------------------------------------------------------------- before: the leak
SET ROLE anon;
SELECT public._as('');
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM public.marketplace_listings WHERE id = '11111111-0000-0000-0000-000000000001';
  IF r.serial_number IS DISTINCT FROM 'SN-ACTIVE' OR r.details->>'stripe_price_id' IS NULL THEN RAISE EXCEPTION 'FAIL baseline'; END IF;
  RAISE NOTICE 'BEFORE 000935: anon SELECT * returns serial_number=%, notes=%, details.stripe_price_id=%', r.serial_number, r.notes, r.details->>'stripe_price_id';
END $$;
RESET ROLE;
SET ROLE authenticated;
SELECT public._as('X');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.marketplace_listings WHERE status = 'draft') THEN RAISE EXCEPTION 'FAIL baseline draft'; END IF;
  RAISE NOTICE 'BEFORE 000935: a stranger (other org) reads the seller''s draft listing';
END $$;
RESET ROLE;

-- ---------------------------------------------------------------- apply twice
\ir ../migrations/20261019_000935_marketplace_listings_private_columns.sql
\ir ../migrations/20261019_000935_marketplace_listings_private_columns.sql

DO $$ DECLARE v text; BEGIN
  IF has_table_privilege('anon', 'public.marketplace_listings', 'MAINTAIN')
     OR has_table_privilege('authenticated', 'public.marketplace_listings', 'MAINTAIN') THEN RAISE EXCEPTION 'FAIL MAINTAIN'; END IF;
  IF has_table_privilege('anon', 'public.marketplace_listings', 'SELECT')
     OR has_table_privilege('authenticated', 'public.marketplace_listings', 'SELECT') THEN RAISE EXCEPTION 'FAIL table SELECT'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.marketplace_listings', 'INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'FAIL write grants changed'; END IF;
  IF has_table_privilege('anon', 'public.marketplace_listings', 'INSERT') OR has_table_privilege('anon', 'public.marketplace_listings', 'UPDATE') THEN RAISE EXCEPTION 'FAIL anon writes'; END IF;
  FOREACH v IN ARRAY ARRAY['serial_number', 'notes', 'details'] LOOP
    IF has_column_privilege('anon', 'public.marketplace_listings', v, 'SELECT') OR has_column_privilege('authenticated', 'public.marketplace_listings', v, 'SELECT') THEN
      RAISE EXCEPTION 'FAIL private column % selectable', v; END IF;
  END LOOP;
  FOREACH v IN ARRAY ARRAY['id', 'seller_id', 'created_by', 'organization_id', 'title', 'status', 'part_number', 'price', 'images', 'photos', 'quantity', 'qty', 'details_public', 'views'] LOOP
    IF NOT has_column_privilege('anon', 'public.marketplace_listings', v, 'SELECT') OR NOT has_column_privilege('authenticated', 'public.marketplace_listings', v, 'SELECT') THEN
      RAISE EXCEPTION 'FAIL public column % not selectable', v; END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.marketplace_listing_private(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.marketplace_listing_private(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'FAIL rpc grants'; END IF;
  IF (SELECT proconfig FROM pg_proc WHERE oid = 'public.marketplace_listing_private(uuid)'::regprocedure) <> ARRAY['search_path=""']
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.marketplace_listing_private(uuid)'::regprocedure) THEN RAISE EXCEPTION 'FAIL rpc shape'; END IF;
  RAISE NOTICE 'PASS grants: MAINTAIN revoked, no table SELECT, private columns closed, public columns + details_public open, write grants unchanged, RPC authenticated-only SECURITY DEFINER search_path ''''; re-apply idempotent';
END $$;

-- ---------------------------------------------------------------- anon
SET ROLE anon;
SELECT public._as('');
DO $$ DECLARE j jsonb; n int; BEGIN
  BEGIN PERFORM * FROM public.marketplace_listings; RAISE EXCEPTION 'FAIL anon select *';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM serial_number FROM public.marketplace_listings; RAISE EXCEPTION 'FAIL anon serial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM notes FROM public.marketplace_listings; RAISE EXCEPTION 'FAIL anon notes';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM details FROM public.marketplace_listings; RAISE EXCEPTION 'FAIL anon details';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.marketplace_listings WHERE serial_number = 'SN-ACTIVE'; RAISE EXCEPTION 'FAIL anon filter on serial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.marketplace_listing_private('11111111-0000-0000-0000-000000000001'); RAISE EXCEPTION 'FAIL anon rpc';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT details_public INTO j FROM public.marketplace_listings WHERE id = '11111111-0000-0000-0000-000000000001';
  IF j <> '{"sku":"SKU-1","shipping":{"days":3},"compatible_models":[{"m":"GentleLase"}],"warranty":"90 days"}'::jsonb THEN
    RAISE EXCEPTION 'FAIL details_public %', j; END IF;
  SELECT count(*) INTO n FROM public.marketplace_listings;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL anon rows %', n; END IF;
  RAISE NOTICE 'PASS anon: select * / serial / notes / details / filter on serial refused, RPC refused; details_public = %; 1 active row', j;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------- authenticated
SET ROLE authenticated;
SELECT public._as('X');
DO $$ DECLARE n int; BEGIN
  BEGIN PERFORM * FROM public.marketplace_listings; RAISE EXCEPTION 'FAIL authed select *';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM serial_number FROM public.marketplace_listings; RAISE EXCEPTION 'FAIL authed serial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT count(*) INTO n FROM public.marketplace_listings;
  IF n <> 2 OR EXISTS (SELECT 1 FROM public.marketplace_listings WHERE status IN ('draft', 'removed')) THEN
    RAISE EXCEPTION 'FAIL stranger rows % (expect active + sold only)', n; END IF;
  IF public.marketplace_listing_private('11111111-0000-0000-0000-000000000001') IS NOT NULL THEN RAISE EXCEPTION 'FAIL stranger rpc'; END IF;
  IF (SELECT details_public FROM public.marketplace_listings WHERE status = 'sold') <> '[1,{}]'::jsonb THEN RAISE EXCEPTION 'FAIL array sanitize'; END IF;
  RAISE NOTICE 'PASS stranger: no drafts/removed of other orgs (sees active + sold), RPC NULL, arrays sanitized';
END $$;
SELECT public._as('C');
DO $$ DECLARE n int; j jsonb; BEGIN
  SELECT count(*) INTO n FROM public.marketplace_listings;
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL colleague rows %', n; END IF;
  j := public.marketplace_listing_private('11111111-0000-0000-0000-000000000002');
  IF j->>'serial_number' <> 'SN-DRAFT' OR j->>'notes' <> 'draft note' THEN RAISE EXCEPTION 'FAIL colleague rpc %', j; END IF;
  RAISE NOTICE 'PASS colleague (same org, not seller): sees all 4 org rows incl. draft/removed, RPC returns serial/notes';
END $$;
SELECT public._as('S');
DO $$ DECLARE j jsonb; v_id uuid; BEGIN
  j := public.marketplace_listing_private('11111111-0000-0000-0000-000000000001');
  IF j->>'serial_number' <> 'SN-ACTIVE' OR j->'details'->>'stripe_price_id' <> 'price_1' THEN RAISE EXCEPTION 'FAIL seller rpc %', j; END IF;
  -- client insert with RETURNING id (PostgREST .insert().select('id'))
  INSERT INTO public.marketplace_listings (seller_id, created_by, organization_id, title, listing_type, serial_number, notes, details)
  VALUES (auth.uid(), auth.uid(), 501, 'New', 'part', 'SN-NEW', 'n', '{"sku":"S","stripe_price_id":"x"}')
  RETURNING id INTO v_id;
  IF (SELECT details_public FROM public.marketplace_listings WHERE id = v_id) <> '{"sku":"S"}'::jsonb THEN RAISE EXCEPTION 'FAIL insert generated'; END IF;
  UPDATE public.marketplace_listings SET details = '{"sku":"S2","STRIPE_product_id":"y"}', serial_number = 'SN-NEW2' WHERE id = v_id;
  IF (SELECT details_public FROM public.marketplace_listings WHERE id = v_id) <> '{"sku":"S2"}'::jsonb THEN RAISE EXCEPTION 'FAIL update generated'; END IF;
  IF public.marketplace_listing_private(v_id)->>'serial_number' <> 'SN-NEW2' THEN RAISE EXCEPTION 'FAIL update serial'; END IF;
  UPDATE public.marketplace_listings SET views = coalesce(views, 0) + 1 WHERE id = '11111111-0000-0000-0000-000000000001';
  DELETE FROM public.marketplace_listings WHERE id = v_id;
  BEGIN
    UPDATE public.marketplace_listings SET details_public = '{}' WHERE id = '11111111-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'FAIL details_public writable';
  EXCEPTION WHEN generated_always OR insufficient_privilege OR feature_not_supported OR syntax_error THEN NULL; END;
  RAISE NOTICE 'PASS seller: RPC returns serial/notes/raw details; insert RETURNING id, update details/serial, views bump, delete all work; details_public regenerates and cannot be written';
END $$;
RESET ROLE;

-- ---------------------------------------------------------------- rollback (exact), twice
\ir ../migrations/20261019_000935_marketplace_listings_private_columns_rollback.sql
\ir ../migrations/20261019_000935_marketplace_listings_private_columns_rollback.sql
CREATE TABLE public._snap_post AS
SELECT 'col:' || a.attname AS k, coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(a.attacl) x), '') AS v
  FROM pg_attribute a WHERE a.attrelid = 'public.marketplace_listings'::regclass AND a.attnum > 0 AND NOT a.attisdropped
UNION ALL SELECT 'relacl', (SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(relacl) x) FROM pg_class WHERE oid = 'public.marketplace_listings'::regclass
UNION ALL SELECT 'pol:' || polname, polcmd::text || '|' || polroles::regrole[]::text || '|' || coalesce(pg_get_expr(polqual, polrelid), '') || '|' || coalesce(pg_get_expr(polwithcheck, polrelid), '')
  FROM pg_policy WHERE polrelid = 'public.marketplace_listings'::regclass
UNION ALL SELECT 'fn:' || p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) || coalesce(p.proacl::text, '')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname NOT LIKE '\_%'
UNION ALL SELECT 'trg:' || tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'public.marketplace_listings'::regclass AND NOT tgisinternal;
DO $$ DECLARE d text; BEGIN
  SELECT string_agg(x.k || ' = ' || x.v, '; ') INTO d FROM (
    (SELECT 'pre ' || k AS k, v FROM public._snap_pre EXCEPT SELECT 'pre ' || k, v FROM public._snap_post)
    UNION ALL
    (SELECT 'post ' || k, v FROM public._snap_post EXCEPT SELECT 'post ' || k, v FROM public._snap_pre)) x;
  IF d IS NOT NULL THEN RAISE EXCEPTION 'FAIL rollback not exact: %', d; END IF;
  RAISE NOTICE 'PASS rollback exact (table ACL entries (order-normalised), every column ACL, 8 policies, functions + ACLs, triggers), rollback re-run OK';
END $$;
SET ROLE anon;
DO $$ BEGIN
  PERFORM * FROM public.marketplace_listings;
  RAISE NOTICE 'PASS after rollback anon SELECT * works again (pre-000935 behaviour)';
END $$;
RESET ROLE;

-- ---------------------------------------------------------------- drift guards
CREATE FUNCTION public.marketplace_listing_private(p_id uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261019_000935_marketplace_listings_private_columns.sql
\ir ../migrations/20261019_000935_marketplace_listings_private_columns_rollback.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT has_table_privilege('anon', 'public.marketplace_listings', 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.marketplace_listings'::regclass AND attname = 'details_public' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'FAIL drift guard let a foreign marketplace_listing_private through'; END IF;
  RAISE NOTICE 'PASS drift guard: foreign marketplace_listing_private refused by apply and rollback, nothing changed';
END $$;
DROP FUNCTION public.marketplace_listing_private(uuid);
ALTER POLICY "Sellers select own listings" ON public.marketplace_listings USING (true);
\set ON_ERROR_STOP off
\ir ../migrations/20261019_000935_marketplace_listings_private_columns.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT has_table_privilege('anon', 'public.marketplace_listings', 'SELECT') THEN RAISE EXCEPTION 'FAIL drift guard let an edited policy through'; END IF;
  RAISE NOTICE 'PASS drift guard: hand-edited "Sellers select own listings" refused';
END $$;
ALTER POLICY "Sellers select own listings" ON public.marketplace_listings
  USING ((status = ANY (ARRAY['active'::text, 'open'::text, 'published'::text, 'sold'::text, 'draft'::text]))
         OR (seller_id = auth.uid()) OR (created_by = auth.uid()));

-- re-apply after rollback
\ir ../migrations/20261019_000935_marketplace_listings_private_columns.sql
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM serial_number FROM public.marketplace_listings; RAISE EXCEPTION 'FAIL re-apply';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS re-apply after rollback';
END $$;
RESET ROLE;
