-- Local proof for 20261116_000957_service_org_reviews.sql and its rollback.
-- Empty Postgres scratch database only (never production, never the live project).
-- Synthetic orgs 88021-88024. Does not use 4, 153, 154, 1005, 2616, 5509, or 5515.
--
--   createdb reviews_proof
--   psql "postgresql:///reviews_proof" -v ON_ERROR_STOP=1 \
--     -f path/to/web/supabase/tests/20261116_service_org_reviews.sql
--   dropdb reviews_proof
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF to_regclass('public.service_org_reviews') IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to run: public.service_org_reviews already exists';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN CREATE ROLE supabase_admin NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user)
$$;

GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

CREATE TABLE public.organizations (
  id bigint PRIMARY KEY,
  name text,
  type text,
  city text,
  state text,
  list_in_directory boolean DEFAULT false,
  is_active boolean DEFAULT true,
  notes text,
  phone text,
  email text,
  logo_url text,
  description text,
  website text
);

CREATE TABLE public.organization_memberships (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  organization_id bigint NOT NULL REFERENCES public.organizations(id),
  role text
);

CREATE OR REPLACE FUNCTION public.is_active_org_member(p_org bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_org IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = auth.uid() AND m.organization_id = p_org
    );
$$;
GRANT EXECUTE ON FUNCTION public.is_active_org_member(bigint) TO anon, authenticated, service_role;

CREATE TABLE public.service_tickets (
  id bigint PRIMARY KEY,
  organization_id bigint,
  customer_organization_id bigint,
  status text,
  ticket_number text,
  service_date date,
  notes text
);

CREATE TABLE public.service_reports (
  id uuid PRIMARY KEY,
  organization_id bigint,
  customer_organization_id bigint,
  status text,
  finalized_at timestamptz,
  ticket_id text,
  report_number text,
  date_out date,
  comments text
);

CREATE TABLE public.service_invoices (
  id bigint PRIMARY KEY,
  organization_id bigint,
  customer_organization_id bigint,
  status text,
  ticket_id bigint,
  invoice_number text,
  total numeric(12,2),
  amount_paid numeric(12,2),
  notes text,
  paid_at timestamptz
);

INSERT INTO public.organizations (id, name, type, city, state, list_in_directory, is_active, notes, phone, email, description)
VALUES
  (88021, 'QA Clinic', 'laser_clinic', 'Austin', 'TX', true, true, '', '512-555-0100', 'clinic@example.com', 'Clinic bio'),
  (88022, 'QA Repair Co', 'service_company', 'Dallas', 'TX', true, true, '', '214-555-0199', 'shop-secret@example.com', 'Laser repair'),
  (88023, 'Other Shop', 'service_company', 'Houston', 'TX', true, true, '', NULL, NULL, NULL),
  (88024, 'Unlisted Shop', 'service_company', 'El Paso', 'TX', false, true, '', '915-555-0101', 'unlisted@example.com', 'Hidden shop');

INSERT INTO public.organization_memberships (user_id, organization_id, role) VALUES
  ('11111111-1111-4111-8111-111111111111', 88021, 'owner'),
  ('22222222-2222-4222-8222-222222222222', 88022, 'owner'),
  ('33333333-3333-4333-8333-333333333333', 88022, 'fse'),
  ('55555555-5555-4555-8555-555555555555', 88021, 'owner'),
  ('55555555-5555-4555-8555-555555555555', 88022, 'company_admin'),
  ('44444444-4444-4444-8444-444444444444', 88023, 'owner');

INSERT INTO public.service_tickets (id, organization_id, customer_organization_id, status, ticket_number, service_date, notes) VALUES
  (501, 88022, 88021, 'completed', 'T-501', '2026-11-01', 'SECRET-NOTE'),
  (502, 88022, 88021, 'open', 'T-502', '2026-11-02', 'SECRET-NOTE'),
  (503, 88022, 88021, 'cancelled', 'T-503', '2026-11-03', 'SECRET-NOTE'),
  (510, 88024, 88021, 'completed', 'T-510', '2026-11-04', 'SECRET-NOTE');

INSERT INTO public.service_reports (id, organization_id, customer_organization_id, status, finalized_at, ticket_id, report_number, date_out, comments) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 88022, 88021, 'complete', now(), '501', 'R-501', '2026-11-01', 'SECRET-REPORT'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 88022, 88021, 'draft', NULL, NULL, 'R-DRAFT', '2026-11-02', 'SECRET-REPORT'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 88022, 88021, 'complete', now(), NULL, 'R-SOLO', '2026-11-05', 'SECRET-REPORT');

INSERT INTO public.service_invoices (id, organization_id, customer_organization_id, status, ticket_id, invoice_number, total, amount_paid, notes, paid_at) VALUES
  (601, 88022, 88021, 'paid', 501, 'INV-601', 99999.99, 99999.99, 'SECRET-INVOICE', '2026-11-06 12:00:00+00'),
  (602, 88022, 88021, 'sent', NULL, 'INV-602', 111.00, 0, 'SECRET-INVOICE', NULL),
  (603, 88022, 88021, 'paid', NULL, 'INV-603', 88888.88, 88888.88, 'SECRET-INVOICE', '2026-11-07 12:00:00+00');

\ir ../migrations/20261116_000957_service_org_reviews.sql
\ir ../migrations/20261116_000957_service_org_reviews.sql

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_user uuid, p_role text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  PERFORM set_config('request.jwt.claim.role', coalesce(p_role, ''), false);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.try_sql(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

-- anon cannot insert, and cannot read the table
SET ROLE anon;
SELECT pg_temp.as_user(NULL, 'anon');
DO $$ DECLARE msg text; BEGIN
  msg := pg_temp.try_sql($q$
    INSERT INTO public.service_org_reviews (customer_organization_id, service_organization_id, author_user_id, stars, ticket_id)
    VALUES (88021, 88022, '11111111-1111-4111-8111-111111111111', 5, 501)
  $q$);
  IF msg = 'ok' THEN RAISE EXCEPTION 'FAIL anon insert'; END IF;
  msg := pg_temp.try_sql('SELECT count(*) FROM public.service_org_reviews');
  IF msg = 'ok' THEN RAISE EXCEPTION 'FAIL anon select'; END IF;
  IF public.public_service_org_profile(88022) ->> 'phone' IS NOT NULL
     OR public.public_service_org_profile(88022)::text ILIKE '%shop-secret%'
     OR public.public_service_org_profile(88022)::text ILIKE '%214-555%' THEN
    RAISE EXCEPTION 'FAIL profile leaked contact %', public.public_service_org_profile(88022);
  END IF;
  IF (public.public_service_org_profile(88022) ->> 'name') IS DISTINCT FROM 'QA Repair Co' THEN
    RAISE EXCEPTION 'FAIL profile name';
  END IF;
  RAISE NOTICE 'PASS anon: no insert, no table read, profile has no phone or email';
END $$;
RESET ROLE;

-- text without stars
SET ROLE authenticated;
SELECT pg_temp.as_user('11111111-1111-4111-8111-111111111111', 'authenticated');
DO $$ DECLARE msg text; BEGIN
  msg := pg_temp.try_sql($q$
    INSERT INTO public.service_org_reviews (customer_organization_id, service_organization_id, author_user_id, body, report_id)
    VALUES (88021, 88022, '11111111-1111-4111-8111-111111111111', 'Great work, no stars', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3')
  $q$);
  IF msg = 'ok' OR msg NOT LIKE '23502%' THEN
    RAISE EXCEPTION 'FAIL text without stars: %', msg;
  END IF;
  msg := pg_temp.try_sql($q$
    INSERT INTO public.service_org_reviews (customer_organization_id, service_organization_id, author_user_id, stars, body, ticket_id)
    VALUES (88021, 88022, '11111111-1111-4111-8111-111111111111', NULL, 'Nope', 501)
  $q$);
  IF msg = 'ok' OR msg NOT LIKE '23502%' THEN
    RAISE EXCEPTION 'FAIL null stars: %', msg;
  END IF;
  msg := pg_temp.try_sql($q$
    INSERT INTO public.service_org_reviews (customer_organization_id, service_organization_id, author_user_id, stars, ticket_id)
    VALUES (88021, 88022, '11111111-1111-4111-8111-111111111111', 0, 501)
  $q$);
  IF msg = 'ok' OR msg NOT LIKE '23514%' THEN
    RAISE EXCEPTION 'FAIL stars 0: %', msg;
  END IF;
  msg := pg_temp.try_sql($q$
    INSERT INTO public.service_org_reviews (customer_organization_id, service_organization_id, author_user_id, stars, ticket_id)
    VALUES (88021, 88022, '11111111-1111-4111-8111-111111111111', 6, 501)
  $q$);
  IF msg = 'ok' OR msg NOT LIKE '23514%' THEN
    RAISE EXCEPTION 'FAIL stars 6: %', msg;
  END IF;
  RAISE NOTICE 'PASS stars are required and must be 1-5';
END $$;

-- ineligible jobs and self-org
DO $$ DECLARE msg text; BEGIN
  msg := pg_temp.try_sql($q$
    INSERT INTO public.service_org_reviews (customer_organization_id, service_organization_id, author_user_id, stars, ticket_id)
    VALUES (88021, 88022, '11111111-1111-4111-8111-111111111111', 5, 502)
  $q$);
  IF msg = 'ok' OR (msg NOT LIKE '%not eligible%' AND msg NOT LIKE '%row-level security%') THEN RAISE EXCEPTION 'FAIL open ticket: %', msg; END IF;
  msg := pg_temp.try_sql($q$
    INSERT INTO public.service_org_reviews (customer_organization_id, service_organization_id, author_user_id, stars, ticket_id)
    VALUES (88021, 88022, '11111111-1111-4111-8111-111111111111', 5, 503)
  $q$);
  IF msg = 'ok' OR (msg NOT LIKE '%not eligible%' AND msg NOT LIKE '%row-level security%') THEN RAISE EXCEPTION 'FAIL cancelled ticket: %', msg; END IF;
  msg := pg_temp.try_sql($q$
    INSERT INTO public.service_org_reviews (customer_organization_id, service_organization_id, author_user_id, stars, report_id)
    VALUES (88021, 88022, '11111111-1111-4111-8111-111111111111', 5, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')
  $q$);
  IF msg = 'ok' OR (msg NOT LIKE '%not eligible%' AND msg NOT LIKE '%row-level security%') THEN RAISE EXCEPTION 'FAIL draft report: %', msg; END IF;
  msg := pg_temp.try_sql($q$
    INSERT INTO public.service_org_reviews (customer_organization_id, service_organization_id, author_user_id, stars, invoice_id)
    VALUES (88021, 88022, '11111111-1111-4111-8111-111111111111', 5, 602)
  $q$);
  IF msg = 'ok' OR (msg NOT LIKE '%not eligible%' AND msg NOT LIKE '%row-level security%') THEN RAISE EXCEPTION 'FAIL sent invoice: %', msg; END IF;
  RAISE NOTICE 'PASS open, cancelled, draft, and sent jobs are refused';
END $$;

SELECT pg_temp.as_user('55555555-5555-4555-8555-555555555555', 'authenticated');
DO $$ DECLARE msg text; BEGIN
  msg := pg_temp.try_sql($q$
    INSERT INTO public.service_org_reviews (customer_organization_id, service_organization_id, author_user_id, stars, ticket_id)
    VALUES (88021, 88022, '55555555-5555-4555-8555-555555555555', 5, 501)
  $q$);
  IF msg = 'ok' OR (msg NOT LIKE '%belong%' AND msg NOT LIKE '%row-level security%') THEN RAISE EXCEPTION 'FAIL self-org rating: %', msg; END IF;
  IF EXISTS (SELECT 1 FROM public.service_org_review_eligible_jobs(88022)) THEN
    RAISE EXCEPTION 'FAIL self-org still sees jobs';
  END IF;
  RAISE NOTICE 'PASS a member of the service org cannot rate it';
END $$;

SELECT pg_temp.as_user('44444444-4444-4444-8444-444444444444', 'authenticated');
DO $$ DECLARE msg text; BEGIN
  msg := pg_temp.try_sql($q$
    INSERT INTO public.service_org_reviews (customer_organization_id, service_organization_id, author_user_id, stars, ticket_id)
    VALUES (88021, 88022, '44444444-4444-4444-8444-444444444444', 5, 501)
  $q$);
  IF msg = 'ok' OR (msg NOT LIKE '%customer organization%' AND msg NOT LIKE '%row-level security%') THEN RAISE EXCEPTION 'FAIL outsider: %', msg; END IF;
  RAISE NOTICE 'PASS a non-member cannot rate';
END $$;

SELECT pg_temp.as_user('22222222-2222-4222-8222-222222222222', 'authenticated');
DO $$ DECLARE msg text; BEGIN
  msg := pg_temp.try_sql($q$
    INSERT INTO public.service_org_reviews (customer_organization_id, service_organization_id, author_user_id, stars, ticket_id)
    VALUES (88022, 88022, '22222222-2222-4222-8222-222222222222', 5, 501)
  $q$);
  IF msg = 'ok' THEN RAISE EXCEPTION 'FAIL own-org insert'; END IF;
  RAISE NOTICE 'PASS the service org cannot rate itself';
END $$;

-- stars only, then a second anchor of the same job, then a paid invoice alone
SELECT pg_temp.as_user('11111111-1111-4111-8111-111111111111', 'authenticated');
DO $$ DECLARE msg text; n int; avg numeric; pub jsonb; jobs jsonb; BEGIN
  INSERT INTO public.service_org_reviews (customer_organization_id, service_organization_id, author_user_id, stars, body, ticket_id)
  VALUES (88021, 88022, '11111111-1111-4111-8111-111111111111', 5, '   ', 501);
  IF (SELECT body FROM public.service_org_reviews WHERE ticket_id = 501) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL blank review text was stored';
  END IF;
  IF (SELECT job_key FROM public.service_org_reviews WHERE ticket_id = 501) IS DISTINCT FROM 'ticket:501' THEN
    RAISE EXCEPTION 'FAIL job key';
  END IF;
  msg := pg_temp.try_sql($q$
    INSERT INTO public.service_org_reviews (customer_organization_id, service_organization_id, author_user_id, stars, report_id)
    VALUES (88021, 88022, '11111111-1111-4111-8111-111111111111', 4, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')
  $q$);
  IF msg = 'ok' OR msg NOT LIKE '23505%' THEN RAISE EXCEPTION 'FAIL second rating on same job: %', msg; END IF;
  msg := pg_temp.try_sql($q$
    INSERT INTO public.service_org_reviews (customer_organization_id, service_organization_id, author_user_id, stars, invoice_id)
    VALUES (88021, 88022, '11111111-1111-4111-8111-111111111111', 4, 601)
  $q$);
  IF msg = 'ok' OR msg NOT LIKE '23505%' THEN RAISE EXCEPTION 'FAIL invoice of the same ticket: %', msg; END IF;
  INSERT INTO public.service_org_reviews (customer_organization_id, service_organization_id, author_user_id, stars, body, invoice_id)
  VALUES (88021, 88022, '11111111-1111-4111-8111-111111111111', 4, 'On time', 603);
  IF (SELECT job_key FROM public.service_org_reviews WHERE invoice_id = 603) IS DISTINCT FROM 'invoice:603' THEN
    RAISE EXCEPTION 'FAIL paid invoice alone';
  END IF;
  INSERT INTO public.service_org_reviews (customer_organization_id, service_organization_id, author_user_id, stars, report_id)
  VALUES (88021, 88022, '11111111-1111-4111-8111-111111111111', 3, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
  SELECT review_count, average_stars INTO n, avg
  FROM public.service_org_rating_summaries(ARRAY[88022]::bigint[]);
  IF n IS DISTINCT FROM 3 OR avg IS DISTINCT FROM 4.00 THEN
    RAISE EXCEPTION 'FAIL average % %', n, avg;
  END IF;
  pub := public.service_org_reviews_public(88022, 20, 0);
  IF pub::text ILIKE '%SECRET%' OR pub::text ILIKE '%99999%' OR pub::text ILIKE '%88888%'
     OR pub::text ILIKE '%customer_organization%' OR pub::text ILIKE '%hidden%' THEN
    RAISE EXCEPTION 'FAIL public list leaked %', pub;
  END IF;
  IF jsonb_array_length(pub) IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'FAIL public count %', pub; END IF;
  jobs := (SELECT jsonb_agg(to_jsonb(j)) FROM public.service_org_review_eligible_jobs(88022) j);
  IF jobs::text ILIKE '%SECRET%' OR jobs::text ILIKE '%99999%' OR jobs::text ILIKE '%88888%' THEN
    RAISE EXCEPTION 'FAIL eligible jobs leaked %', jobs;
  END IF;
  RAISE NOTICE 'PASS one rating per job, paid invoice alone, public aggregate hides prices';
END $$;

-- reply: tech and outsider refused, owner accepted once
SELECT pg_temp.as_user('33333333-3333-4333-8333-333333333333', 'authenticated');
DO $$ DECLARE rid uuid; BEGIN
  SELECT id INTO rid FROM public.service_org_reviews WHERE job_key = 'ticket:501';
  UPDATE public.service_org_reviews SET reply_body = 'Thanks from a tech' WHERE id = rid;
  IF (SELECT reply_body FROM public.service_org_reviews WHERE id = rid) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL tech reply';
  END IF;
  RAISE NOTICE 'PASS a non-admin member cannot reply';
END $$;

SELECT pg_temp.as_user('22222222-2222-4222-8222-222222222222', 'authenticated');
DO $$ DECLARE rid uuid; BEGIN
  SELECT id INTO rid FROM public.service_org_reviews WHERE job_key = 'ticket:501';
  UPDATE public.service_org_reviews SET reply_body = 'Thank you' WHERE id = rid;
  UPDATE public.service_org_reviews SET reply_body = 'Thank you — updated' WHERE id = rid;
  IF (SELECT count(*) FROM public.service_org_reviews WHERE job_key = 'ticket:501') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL reply created a second row';
  END IF;
  IF (SELECT reply_body FROM public.service_org_reviews WHERE id = rid) IS DISTINCT FROM 'Thank you — updated' THEN
    RAISE EXCEPTION 'FAIL reply text';
  END IF;
  IF public.service_org_reviews_public(88022, 20, 0)::text NOT LIKE '%Thank you%' THEN
    RAISE EXCEPTION 'FAIL public reply missing';
  END IF;
  RAISE NOTICE 'PASS owner membership can post the one public reply';
END $$;

-- hide: spoofed jwt role fails; service_role requires a reason; hidden drops out of the average
SELECT pg_temp.as_user('11111111-1111-4111-8111-111111111111', 'service_role');
DO $$ DECLARE msg text; rid uuid; BEGIN
  SELECT id INTO rid FROM public.service_org_reviews WHERE job_key = 'invoice:603';
  msg := pg_temp.try_sql(format(
    'UPDATE public.service_org_reviews SET hidden_at = now(), hidden_reason = %L WHERE id = %L',
    'spoofed', rid
  ));
  IF msg = 'ok' OR msg NOT LIKE '%platform admin%' THEN
    RAISE EXCEPTION 'FAIL spoofed role hid a review: %', msg;
  END IF;
  RAISE NOTICE 'PASS jwt role claim is not enough to hide';
END $$;
RESET ROLE;

SET ROLE service_role;
SELECT pg_temp.as_user('22222222-2222-4222-8222-222222222222', 'service_role');
DO $$ DECLARE msg text; rid uuid; n int; BEGIN
  SELECT id INTO rid FROM public.service_org_reviews WHERE job_key = 'invoice:603';
  msg := pg_temp.try_sql(format(
    'UPDATE public.service_org_reviews SET hidden_at = now() WHERE id = %L', rid
  ));
  IF msg = 'ok' OR msg NOT LIKE '%reason%' THEN RAISE EXCEPTION 'FAIL hide without reason: %', msg; END IF;
  UPDATE public.service_org_reviews
    SET hidden_at = now(), hidden_by = '22222222-2222-4222-8222-222222222222', hidden_reason = 'abusive'
    WHERE id = rid;
  SELECT review_count INTO n FROM public.service_org_rating_summaries(ARRAY[88022]::bigint[]);
  IF n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'FAIL hidden still counted %', n; END IF;
  IF public.service_org_reviews_public(88022, 20, 0)::text ILIKE '%On time%'
     OR public.service_org_reviews_public(88022, 20, 0)::text ILIKE '%abusive%' THEN
    RAISE EXCEPTION 'FAIL hidden review still public';
  END IF;
  UPDATE public.service_org_reviews
    SET hidden_at = NULL, hidden_by = NULL, hidden_reason = NULL
    WHERE id = rid;
  SELECT review_count INTO n FROM public.service_org_rating_summaries(ARRAY[88022]::bigint[]);
  IF n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'FAIL unhide count %', n; END IF;
  RAISE NOTICE 'PASS platform role hides with a reason and public reads skip hidden rows';
END $$;
RESET ROLE;

-- edit window
SET ROLE authenticated;
SELECT pg_temp.as_user('11111111-1111-4111-8111-111111111111', 'authenticated');
DO $$ DECLARE rid uuid; BEGIN
  SELECT id INTO rid FROM public.service_org_reviews WHERE job_key = 'ticket:501';
  UPDATE public.service_org_reviews SET stars = 4, body = 'Updated' WHERE id = rid;
  IF (SELECT stars FROM public.service_org_reviews WHERE id = rid) IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'FAIL edit';
  END IF;
  RAISE NOTICE 'PASS author can edit inside 30 days';
END $$;
RESET ROLE;

ALTER TABLE public.service_org_reviews DISABLE TRIGGER service_org_reviews_guard_trg;
UPDATE public.service_org_reviews SET created_at = now() - interval '31 days' WHERE job_key = 'ticket:501';
ALTER TABLE public.service_org_reviews ENABLE TRIGGER service_org_reviews_guard_trg;

SET ROLE authenticated;
SELECT pg_temp.as_user('11111111-1111-4111-8111-111111111111', 'authenticated');
DO $$ DECLARE msg text; rid uuid; BEGIN
  SELECT id INTO rid FROM public.service_org_reviews WHERE job_key = 'ticket:501';
  msg := pg_temp.try_sql(format(
    'UPDATE public.service_org_reviews SET stars = 1 WHERE id = %L', rid
  ));
  IF msg = 'ok' OR msg NOT LIKE '%edit window%' THEN RAISE EXCEPTION 'FAIL closed window: %', msg; END IF;
  RAISE NOTICE 'PASS edits close after 30 days';
END $$;
RESET ROLE;

-- unlisted org can be rated but is not public
SET ROLE authenticated;
SELECT pg_temp.as_user('11111111-1111-4111-8111-111111111111', 'authenticated');
INSERT INTO public.service_org_reviews (customer_organization_id, service_organization_id, author_user_id, stars, ticket_id)
VALUES (88021, 88024, '11111111-1111-4111-8111-111111111111', 5, 510);
DO $$ BEGIN
  IF public.public_service_org_profile(88024) IS NOT NULL THEN RAISE EXCEPTION 'FAIL unlisted profile'; END IF;
  IF EXISTS (SELECT 1 FROM public.service_org_rating_summaries(ARRAY[88024]::bigint[])) THEN
    RAISE EXCEPTION 'FAIL unlisted average';
  END IF;
  IF public.service_org_reviews_public(88024, 20, 0)::text IS DISTINCT FROM '[]' THEN
    RAISE EXCEPTION 'FAIL unlisted reviews';
  END IF;
  RAISE NOTICE 'PASS unlisted orgs stay out of public reads';
END $$;
RESET ROLE;

-- service role cannot fabricate a rating
SET ROLE service_role;
DO $$ DECLARE msg text; BEGIN
  msg := pg_temp.try_sql($q$
    INSERT INTO public.service_org_reviews (customer_organization_id, service_organization_id, author_user_id, stars, ticket_id)
    VALUES (88021, 88023, '22222222-2222-4222-8222-222222222222', 5, 501)
  $q$);
  IF msg = 'ok' OR msg NOT LIKE '%sign in%' THEN RAISE EXCEPTION 'FAIL service insert: %', msg; END IF;
  RAISE NOTICE 'PASS service role cannot insert a rating';
END $$;
RESET ROLE;

\ir ../migrations/20261116_000957_service_org_reviews_rollback.sql
DO $$ BEGIN
  IF to_regclass('public.service_org_reviews') IS NOT NULL THEN RAISE EXCEPTION 'FAIL rollback left the table'; END IF;
  IF to_regprocedure('public.service_org_rating_summaries(bigint[])') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL rollback left the summary';
  END IF;
END $$;
\ir ../migrations/20261116_000957_service_org_reviews_rollback.sql
\ir ../migrations/20261116_000957_service_org_reviews.sql

SET ROLE authenticated;
SELECT pg_temp.as_user('11111111-1111-4111-8111-111111111111', 'authenticated');
INSERT INTO public.service_org_reviews (customer_organization_id, service_organization_id, author_user_id, stars, ticket_id)
VALUES (88021, 88022, '11111111-1111-4111-8111-111111111111', 5, 501);
RESET ROLE;

DO $$ BEGIN
  IF (SELECT review_count FROM public.service_org_rating_summaries(ARRAY[88022]::bigint[])) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL reapply';
  END IF;
  RAISE NOTICE 'PASS rollback and reapply';
END $$;
