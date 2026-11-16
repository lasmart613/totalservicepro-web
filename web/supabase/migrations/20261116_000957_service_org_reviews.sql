-- 000957: Customer ratings of the service organization that did a job.
--
-- A signed-in member of the customer clinic/facility org may leave exactly
-- one rating per job: stars are required (1-5, NOT NULL) and the written
-- review is optional. Text without stars cannot be stored. The same author
-- may edit stars and text for 30 days (service_org_review_edit_window).
--
-- A job is eligible when it ties those two orgs and at least one of these
-- is true: the ticket status is completed or closed (not cancelled), the
-- service report is complete or finalized, or the invoice status is paid.
-- A paid invoice alone qualifies. partially_paid, sent, draft, and void do
-- not. Cancelled tickets do not. The canonical job is the ticket when a
-- report or invoice points at that ticket, so the same job cannot be rated
-- twice through a different anchor.
--
-- Authority is organization_memberships, not organizations.type and not
-- user_profiles.role. The rater must be an active member of the customer
-- org and must not be a member of the service org. A public reply is one
-- column set on the review; only owner / company_admin / admin membership
-- roles of the rated org may write it. admin here is the membership alias
-- of company_admin, not a platform admin.
--
-- Hiding a review is not a membership power. The trigger allows hidden_at
-- to change only when the database role is service_role (or supabase_admin).
-- The God route checks the platform allowlist, then uses the service role.
-- Spoofing request.jwt.claim.role does not count. A hidden review stays the
-- one row for that job and is left out of averages and public lists.
--
-- Public reads go through security-definer functions that return stars,
-- optional text, the company reply, and aggregates. They do not return
-- ticket notes, invoice totals, amounts, or customer contact fields.
-- organizations.customer_rating is a legacy column and is not written.
--
-- Repo only. Do not apply this file to the live project from the pull request.
-- No customer rows are inserted. Local proof uses synthetic org ids.
-- Never use orgs 4, 153, 154, 1005, 2616, 5509, or 5515.
--
-- Rollback: 20261116_000957_service_org_reviews_rollback.sql

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_reviews regclass;
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION '000957 drift: auth.uid() or auth.role() is missing';
  END IF;
  IF to_regprocedure('public.is_active_org_member(bigint)') IS NULL THEN
    RAISE EXCEPTION '000957 drift: public.is_active_org_member(bigint) is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION '000957 drift: service_role is missing';
  END IF;
  IF to_regclass('public.organizations') IS NULL
     OR to_regclass('public.organization_memberships') IS NULL
     OR to_regclass('public.service_tickets') IS NULL
     OR to_regclass('public.service_reports') IS NULL
     OR to_regclass('public.service_invoices') IS NULL THEN
    RAISE EXCEPTION '000957 drift: organizations, memberships, tickets, reports, or invoices are missing';
  END IF;
  v_reviews := to_regclass('public.service_org_reviews');
  IF v_reviews IS NOT NULL
     AND coalesce(pg_catalog.obj_description(v_reviews, 'pg_class'), '') NOT LIKE '000957:%' THEN
    RAISE EXCEPTION '000957 drift: public.service_org_reviews exists and was not created by 000957';
  END IF;
END $$;

DO $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY ARRAY[
    'id', 'name', 'type', 'city', 'state', 'list_in_directory', 'is_active', 'notes'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.organizations'::regclass AND attname = col AND NOT attisdropped
    ) THEN
      RAISE EXCEPTION '000957 drift: organizations.% is missing', col;
    END IF;
  END LOOP;
  FOREACH col IN ARRAY ARRAY[
    'id', 'organization_id', 'customer_organization_id', 'status', 'ticket_number', 'service_date'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.service_tickets'::regclass AND attname = col AND NOT attisdropped
    ) THEN
      RAISE EXCEPTION '000957 drift: service_tickets.% is missing', col;
    END IF;
  END LOOP;
  FOREACH col IN ARRAY ARRAY[
    'id', 'organization_id', 'customer_organization_id', 'status', 'finalized_at', 'ticket_id', 'report_number', 'date_out'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.service_reports'::regclass AND attname = col AND NOT attisdropped
    ) THEN
      RAISE EXCEPTION '000957 drift: service_reports.% is missing', col;
    END IF;
  END LOOP;
  FOREACH col IN ARRAY ARRAY['id', 'organization_id', 'customer_organization_id', 'status']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.service_invoices'::regclass AND attname = col AND NOT attisdropped
    ) THEN
      RAISE EXCEPTION '000957 drift: service_invoices.% is missing', col;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.service_org_review_edit_window()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT interval '30 days';
$$;

COMMENT ON FUNCTION public.service_org_review_edit_window() IS
  '000957: authors may change their own stars and review text until this interval after created_at. Replies and hides are not limited by it.';

REVOKE ALL ON FUNCTION public.service_org_review_edit_window() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_org_review_edit_window() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.service_org_review_parse_ticket(p_text text)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_text ~ '^[0-9]+$' THEN p_text::bigint
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.service_org_review_parse_ticket(text) IS
  '000957: numeric ticket id stored on a report or invoice. A ticket number that is not all digits is not an id.';

REVOKE ALL ON FUNCTION public.service_org_review_parse_ticket(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.service_org_review_safe_date(p_text text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF p_text IS NULL OR p_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
    RETURN NULL;
  END IF;
  RETURN p_text::timestamptz::date;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.service_org_review_safe_date(text) IS
  '000957: date from an invoice timestamp string. Invalid text becomes null. Not a price.';

REVOKE ALL ON FUNCTION public.service_org_review_safe_date(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.service_org_review_can_reply(p_service bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
    AND p_service IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships m
      WHERE m.user_id = auth.uid()
        AND m.organization_id = p_service
        AND lower(pg_catalog.btrim(coalesce(m.role, ''))) IN ('owner', 'company_admin', 'admin')
    );
$$;

COMMENT ON FUNCTION public.service_org_review_can_reply(bigint) IS
  '000957: true when the caller has an owner, company_admin, or admin membership on the rated org. Not user_profiles.role and not organizations.type.';

REVOKE ALL ON FUNCTION public.service_org_review_can_reply(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_org_review_can_reply(bigint) TO authenticated, service_role;

-- Returns the canonical job key, or NULL when the anchors are not one eligible
-- job between this customer org and this service org. Reads status and ids
-- only. Does not read notes, comments, totals, or amounts.
CREATE OR REPLACE FUNCTION public.service_org_review_resolve(
  p_customer bigint,
  p_service bigint,
  p_ticket bigint,
  p_report uuid,
  p_invoice bigint
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_eligible boolean := false;
  v_ticket bigint := NULL;
  v_status text;
  v_org bigint;
  v_customer bigint;
  v_finalized timestamptz;
  v_link text;
BEGIN
  IF p_customer IS NULL OR p_service IS NULL OR p_customer = p_service THEN
    RETURN NULL;
  END IF;
  IF p_ticket IS NULL AND p_report IS NULL AND p_invoice IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_ticket IS NOT NULL THEN
    SELECT t.organization_id, t.customer_organization_id, t.status
      INTO v_org, v_customer, v_status
    FROM public.service_tickets t
    WHERE t.id = p_ticket;
    IF NOT FOUND OR v_org IS DISTINCT FROM p_service OR v_customer IS DISTINCT FROM p_customer THEN
      RETURN NULL;
    END IF;
    v_ticket := p_ticket;
    IF lower(pg_catalog.btrim(coalesce(v_status, ''))) IN ('completed', 'closed') THEN
      v_eligible := true;
    END IF;
  END IF;

  IF p_report IS NOT NULL THEN
    SELECT r.organization_id, r.customer_organization_id, r.status, r.finalized_at, r.ticket_id::text
      INTO v_org, v_customer, v_status, v_finalized, v_link
    FROM public.service_reports r
    WHERE r.id = p_report;
    IF NOT FOUND OR v_org IS DISTINCT FROM p_service OR v_customer IS DISTINCT FROM p_customer THEN
      RETURN NULL;
    END IF;
    IF lower(pg_catalog.btrim(coalesce(v_status, ''))) IN ('complete', 'completed', 'finalized')
       OR v_finalized IS NOT NULL THEN
      v_eligible := true;
    END IF;
    IF public.service_org_review_parse_ticket(v_link) IS NOT NULL THEN
      IF v_ticket IS NOT NULL AND v_ticket IS DISTINCT FROM public.service_org_review_parse_ticket(v_link) THEN
        RETURN NULL;
      END IF;
      PERFORM 1
      FROM public.service_tickets t
      WHERE t.id = public.service_org_review_parse_ticket(v_link)
        AND t.organization_id = p_service
        AND t.customer_organization_id = p_customer;
      IF FOUND THEN
        v_ticket := public.service_org_review_parse_ticket(v_link);
      END IF;
    END IF;
  END IF;

  IF p_invoice IS NOT NULL THEN
    SELECT i.organization_id, i.customer_organization_id, i.status,
           pg_catalog.to_jsonb(i) ->> 'ticket_id'
      INTO v_org, v_customer, v_status, v_link
    FROM public.service_invoices i
    WHERE i.id = p_invoice;
    IF NOT FOUND OR v_org IS DISTINCT FROM p_service OR v_customer IS DISTINCT FROM p_customer THEN
      RETURN NULL;
    END IF;
    IF lower(pg_catalog.btrim(coalesce(v_status, ''))) = 'paid' THEN
      v_eligible := true;
    END IF;
    IF public.service_org_review_parse_ticket(v_link) IS NOT NULL THEN
      IF v_ticket IS NOT NULL AND v_ticket IS DISTINCT FROM public.service_org_review_parse_ticket(v_link) THEN
        RETURN NULL;
      END IF;
      PERFORM 1
      FROM public.service_tickets t
      WHERE t.id = public.service_org_review_parse_ticket(v_link)
        AND t.organization_id = p_service
        AND t.customer_organization_id = p_customer;
      IF FOUND THEN
        v_ticket := public.service_org_review_parse_ticket(v_link);
      END IF;
    END IF;
  END IF;

  IF NOT v_eligible THEN
    RETURN NULL;
  END IF;
  IF v_ticket IS NOT NULL THEN
    RETURN 'ticket:' || v_ticket::text;
  END IF;
  IF p_report IS NOT NULL THEN
    RETURN 'report:' || p_report::text;
  END IF;
  RETURN 'invoice:' || p_invoice::text;
END;
$$;

COMMENT ON FUNCTION public.service_org_review_resolve(bigint, bigint, bigint, uuid, bigint) IS
  '000957: canonical job key when a completed ticket, completed report, or paid invoice ties the two orgs. NULL otherwise. Does not read prices or notes.';

REVOKE ALL ON FUNCTION public.service_org_review_resolve(bigint, bigint, bigint, uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_org_review_resolve(bigint, bigint, bigint, uuid, bigint) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.service_org_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  service_organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL,
  stars smallint NOT NULL,
  body text,
  ticket_id bigint,
  report_id uuid,
  invoice_id bigint,
  job_key text NOT NULL,
  reply_body text,
  reply_by uuid,
  reply_at timestamptz,
  hidden_at timestamptz,
  hidden_by uuid,
  hidden_reason text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT service_org_reviews_stars_chk CHECK (stars BETWEEN 1 AND 5),
  CONSTRAINT service_org_reviews_body_chk CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 4000),
  CONSTRAINT service_org_reviews_reply_chk CHECK (reply_body IS NULL OR char_length(reply_body) BETWEEN 1 AND 2000),
  CONSTRAINT service_org_reviews_distinct_orgs_chk CHECK (customer_organization_id <> service_organization_id),
  CONSTRAINT service_org_reviews_anchor_chk CHECK (
    ticket_id IS NOT NULL OR report_id IS NOT NULL OR invoice_id IS NOT NULL
  ),
  CONSTRAINT service_org_reviews_job_key_chk CHECK (
    job_key ~ '^(ticket:[0-9]+|invoice:[0-9]+|report:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'
  ),
  CONSTRAINT service_org_reviews_hide_reason_chk CHECK (
    (hidden_at IS NULL AND hidden_reason IS NULL)
    OR (hidden_at IS NOT NULL AND hidden_reason IS NOT NULL AND char_length(hidden_reason) BETWEEN 3 AND 500)
  ),
  CONSTRAINT service_org_reviews_job_key_uidx UNIQUE (job_key)
);

COMMENT ON TABLE public.service_org_reviews IS
  '000957: One customer rating per completed job. Stars are required. The written review is optional. Hidden rows stay unique and are omitted from public reads.';
COMMENT ON COLUMN public.service_org_reviews.stars IS
  '000957: Required 1-5 rating. Text without stars cannot be inserted. Larry confirmed stars are required and the written review is optional.';
COMMENT ON COLUMN public.service_org_reviews.body IS
  '000957: Optional written review attached to the stars. Null when the customer submits stars only.';
COMMENT ON COLUMN public.service_org_reviews.job_key IS
  '000957: ticket:<id> when the job has a ticket, otherwise report:<uuid> or invoice:<id>. One row per job, including while hidden.';
COMMENT ON COLUMN public.service_org_reviews.hidden_reason IS
  '000957: Required when a platform admin hides the review. Not returned by public read functions.';

CREATE INDEX IF NOT EXISTS service_org_reviews_service_idx
  ON public.service_org_reviews (service_organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS service_org_reviews_public_idx
  ON public.service_org_reviews (service_organization_id, created_at DESC)
  WHERE hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS service_org_reviews_author_idx
  ON public.service_org_reviews (author_user_id);

CREATE OR REPLACE FUNCTION public.service_org_reviews_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_key text;
  v_stars boolean;
  v_reply boolean;
  v_hide boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user IS DISTINCT FROM 'authenticated' THEN
      RAISE EXCEPTION 'sign in to rate a company' USING ERRCODE = '42501';
    END IF;
    IF auth.uid() IS NULL OR NEW.author_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'author_user_id must be the signed-in user' USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_active_org_member(NEW.customer_organization_id) THEN
      RAISE EXCEPTION 'only a member of the customer organization can rate this job' USING ERRCODE = '42501';
    END IF;
    IF public.is_active_org_member(NEW.service_organization_id) THEN
      RAISE EXCEPTION 'you cannot rate an organization you belong to' USING ERRCODE = '42501';
    END IF;
    NEW.body := nullif(pg_catalog.btrim(coalesce(NEW.body, '')), '');
    v_key := public.service_org_review_resolve(
      NEW.customer_organization_id, NEW.service_organization_id, NEW.ticket_id, NEW.report_id, NEW.invoice_id
    );
    IF v_key IS NULL THEN
      RAISE EXCEPTION 'this job is not eligible for a rating' USING ERRCODE = '42501';
    END IF;
    NEW.job_key := v_key;
    NEW.reply_body := NULL;
    NEW.reply_by := NULL;
    NEW.reply_at := NULL;
    NEW.hidden_at := NULL;
    NEW.hidden_by := NULL;
    NEW.hidden_reason := NULL;
    NEW.created_at := pg_catalog.now();
    NEW.updated_at := pg_catalog.now();
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.customer_organization_id IS DISTINCT FROM OLD.customer_organization_id
     OR NEW.service_organization_id IS DISTINCT FROM OLD.service_organization_id
     OR NEW.author_user_id IS DISTINCT FROM OLD.author_user_id
     OR NEW.ticket_id IS DISTINCT FROM OLD.ticket_id
     OR NEW.report_id IS DISTINCT FROM OLD.report_id
     OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
     OR NEW.job_key IS DISTINCT FROM OLD.job_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'rating ownership and the job cannot change' USING ERRCODE = '42501';
  END IF;

  NEW.body := nullif(pg_catalog.btrim(coalesce(NEW.body, '')), '');
  NEW.reply_body := nullif(pg_catalog.btrim(coalesce(NEW.reply_body, '')), '');
  NEW.hidden_reason := nullif(pg_catalog.btrim(coalesce(NEW.hidden_reason, '')), '');
  v_stars := NEW.stars IS DISTINCT FROM OLD.stars OR NEW.body IS DISTINCT FROM OLD.body;
  v_reply := NEW.reply_body IS DISTINCT FROM OLD.reply_body
    OR NEW.reply_by IS DISTINCT FROM OLD.reply_by
    OR NEW.reply_at IS DISTINCT FROM OLD.reply_at;
  v_hide := NEW.hidden_at IS DISTINCT FROM OLD.hidden_at
    OR NEW.hidden_by IS DISTINCT FROM OLD.hidden_by
    OR NEW.hidden_reason IS DISTINCT FROM OLD.hidden_reason;

  IF v_hide THEN
    IF current_user NOT IN ('service_role', 'supabase_admin') THEN
      RAISE EXCEPTION 'only a platform admin can hide a review' USING ERRCODE = '42501';
    END IF;
    IF v_stars OR v_reply THEN
      RAISE EXCEPTION 'hide a review in its own update' USING ERRCODE = '42501';
    END IF;
    IF NEW.hidden_at IS NULL THEN
      NEW.hidden_by := NULL;
      NEW.hidden_reason := NULL;
    ELSIF NEW.hidden_reason IS NULL THEN
      RAISE EXCEPTION 'a hide reason is required' USING ERRCODE = '42501';
    END IF;
  ELSIF v_reply THEN
    IF current_user IS DISTINCT FROM 'authenticated' OR NOT public.service_org_review_can_reply(OLD.service_organization_id) THEN
      RAISE EXCEPTION 'only an owner or company admin of the rated organization can reply' USING ERRCODE = '42501';
    END IF;
    IF v_stars THEN
      RAISE EXCEPTION 'a reply cannot change the star rating' USING ERRCODE = '42501';
    END IF;
    NEW.reply_by := auth.uid();
    NEW.reply_at := CASE WHEN NEW.reply_body IS NULL THEN NULL ELSE pg_catalog.now() END;
  ELSIF v_stars THEN
    IF current_user IS DISTINCT FROM 'authenticated'
       OR auth.uid() IS DISTINCT FROM OLD.author_user_id
       OR NOT public.is_active_org_member(OLD.customer_organization_id)
       OR public.is_active_org_member(OLD.service_organization_id) THEN
      RAISE EXCEPTION 'only the author can edit this rating' USING ERRCODE = '42501';
    END IF;
    IF OLD.created_at < pg_catalog.now() - public.service_org_review_edit_window() THEN
      RAISE EXCEPTION 'the edit window for this rating has closed' USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.service_org_reviews_guard() IS
  '000957: membership checks on insert and edit, one reply for owner/company_admin/admin memberships, and hide only for the service_role database role.';

REVOKE ALL ON FUNCTION public.service_org_reviews_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS service_org_reviews_guard_trg ON public.service_org_reviews;
CREATE TRIGGER service_org_reviews_guard_trg
  BEFORE INSERT OR UPDATE ON public.service_org_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.service_org_reviews_guard();

ALTER TABLE public.service_org_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_org_reviews_party_select ON public.service_org_reviews;
CREATE POLICY service_org_reviews_party_select
  ON public.service_org_reviews
  FOR SELECT
  TO authenticated
  USING (
    author_user_id = auth.uid()
    OR public.is_active_org_member(customer_organization_id)
    OR public.is_active_org_member(service_organization_id)
  );

DROP POLICY IF EXISTS service_org_reviews_insert ON public.service_org_reviews;
CREATE POLICY service_org_reviews_insert
  ON public.service_org_reviews
  FOR INSERT
  TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND public.is_active_org_member(customer_organization_id)
    AND NOT public.is_active_org_member(service_organization_id)
    AND public.service_org_review_resolve(
      customer_organization_id, service_organization_id, ticket_id, report_id, invoice_id
    ) IS NOT NULL
  );

DROP POLICY IF EXISTS service_org_reviews_update ON public.service_org_reviews;
CREATE POLICY service_org_reviews_update
  ON public.service_org_reviews
  FOR UPDATE
  TO authenticated
  USING (
    (
      author_user_id = auth.uid()
      AND public.is_active_org_member(customer_organization_id)
      AND NOT public.is_active_org_member(service_organization_id)
    )
    OR public.service_org_review_can_reply(service_organization_id)
  )
  WITH CHECK (
    (
      author_user_id = auth.uid()
      AND public.is_active_org_member(customer_organization_id)
      AND NOT public.is_active_org_member(service_organization_id)
    )
    OR public.service_org_review_can_reply(service_organization_id)
  );

REVOKE ALL ON TABLE public.service_org_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.service_org_reviews TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.service_org_reviews TO service_role;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE 'REVOKE MAINTAIN ON TABLE public.service_org_reviews FROM anon, authenticated';
EXCEPTION
  WHEN syntax_error OR undefined_object THEN
    NULL;
END $$;

-- Listed orgs only, same import/prospect/lead bar as public_directory_page.
CREATE OR REPLACE FUNCTION public.service_org_review_org_is_public(p_org bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_org
      AND o.list_in_directory IS TRUE
      AND o.is_active IS DISTINCT FROM false
      AND coalesce(o.notes, '') !~* '(^|[^a-z])(re)?import[[:space:]]*:'
      AND coalesce(pg_catalog.to_jsonb(o) ->> 'prospect_pool', '') IN ('', 'false', 'f')
      AND coalesce(pg_catalog.to_jsonb(o) ->> 'lead_source', '') = ''
  );
$$;

COMMENT ON FUNCTION public.service_org_review_org_is_public(bigint) IS
  '000957: listed, active, non-import directory org. Used only to decide whether averages and review text are public.';

REVOKE ALL ON FUNCTION public.service_org_review_org_is_public(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.service_org_rating_summaries(p_org_ids bigint[])
RETURNS TABLE (service_organization_id bigint, review_count integer, average_stars numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.service_organization_id,
         count(*)::integer AS review_count,
         round(avg(r.stars)::numeric, 2) AS average_stars
  FROM public.service_org_reviews r
  WHERE r.hidden_at IS NULL
    AND p_org_ids IS NOT NULL
    AND cardinality(p_org_ids) BETWEEN 1 AND 200
    AND r.service_organization_id = ANY (p_org_ids)
    AND public.service_org_review_org_is_public(r.service_organization_id)
  GROUP BY r.service_organization_id;
$$;

COMMENT ON FUNCTION public.service_org_rating_summaries(bigint[]) IS
  '000957: visible-review count and average for up to 200 listed orgs. No review text, no prices, no notes. Show stars in the UI only when review_count >= 1.';

REVOKE ALL ON FUNCTION public.service_org_rating_summaries(bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.service_org_rating_summaries(bigint[]) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.service_org_reviews_public(
  p_org bigint,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_org IS NULL OR NOT public.service_org_review_org_is_public(p_org) THEN '[]'::jsonb
    ELSE coalesce((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', r.id,
          'stars', r.stars,
          'body', r.body,
          'created_at', r.created_at,
          'reply_body', r.reply_body,
          'reply_at', r.reply_at
        )
        ORDER BY r.created_at DESC, r.id DESC
      )
      FROM (
        SELECT id, stars, body, created_at, reply_body, reply_at
        FROM public.service_org_reviews
        WHERE service_organization_id = p_org
          AND hidden_at IS NULL
        ORDER BY created_at DESC, id DESC
        OFFSET least(500, greatest(0, coalesce(p_offset, 0)))
        LIMIT least(20, greatest(1, coalesce(p_limit, 20)))
      ) r
    ), '[]'::jsonb)
  END;
$$;

COMMENT ON FUNCTION public.service_org_reviews_public(bigint, integer, integer) IS
  '000957: public review list for a listed org. Stars, optional text, and the company reply only. Hidden rows, job ids, prices, and notes are omitted.';

REVOKE ALL ON FUNCTION public.service_org_reviews_public(bigint, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.service_org_reviews_public(bigint, integer, integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.public_service_org_profile(p_org bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN NOT public.service_org_review_org_is_public(p_org) THEN NULL
    ELSE (
      SELECT pg_catalog.jsonb_build_object(
        'id', o.id,
        'name', o.name,
        'type', o.type,
        'city', o.city,
        'state', o.state,
        'logo_url', pg_catalog.to_jsonb(o) ->> 'logo_url',
        'description', pg_catalog.to_jsonb(o) ->> 'description',
        'website', pg_catalog.to_jsonb(o) ->> 'website',
        'bio', pg_catalog.to_jsonb(o) ->> 'bio',
        'slogan', pg_catalog.to_jsonb(o) ->> 'slogan',
        'rating_count', s.review_count,
        'rating_average', s.average_stars
      )
      FROM public.organizations o
      LEFT JOIN public.service_org_rating_summaries(ARRAY[p_org]) s
        ON s.service_organization_id = o.id
      WHERE o.id = p_org
    )
  END;
$$;

COMMENT ON FUNCTION public.public_service_org_profile(bigint) IS
  '000957: public company profile for a listed org. Name, place, and rating only. Phone, email, notes, and the legacy customer_rating column are not returned.';

REVOKE ALL ON FUNCTION public.public_service_org_profile(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_service_org_profile(bigint) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.service_org_review_eligible_jobs(p_service bigint)
RETURNS TABLE (
  customer_organization_id bigint,
  job_key text,
  ticket_id bigint,
  report_id uuid,
  invoice_id bigint,
  source text,
  reference text,
  completed_on date,
  already_rated boolean,
  review_id uuid,
  stars smallint,
  body text,
  review_created_at timestamptz,
  can_edit boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  rec record;
  v_key text;
  v_seen text[] := ARRAY[]::text[];
  v_review public.service_org_reviews%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR p_service IS NULL THEN
    RETURN;
  END IF;
  IF public.is_active_org_member(p_service) THEN
    RETURN;
  END IF;

  FOR rec IN
    SELECT t.id AS ticket_id,
           NULL::uuid AS report_id,
           NULL::bigint AS invoice_id,
           t.customer_organization_id,
           t.ticket_number AS reference,
           t.service_date AS completed_on,
           'ticket'::text AS source
    FROM public.service_tickets t
    WHERE t.organization_id = p_service
      AND lower(pg_catalog.btrim(coalesce(t.status, ''))) IN ('completed', 'closed')
      AND public.is_active_org_member(t.customer_organization_id)
    UNION ALL
    SELECT NULL::bigint,
           r.id,
           NULL::bigint,
           r.customer_organization_id,
           r.report_number,
           r.date_out,
           'report'::text
    FROM public.service_reports r
    WHERE r.organization_id = p_service
      AND (
        lower(pg_catalog.btrim(coalesce(r.status, ''))) IN ('complete', 'completed', 'finalized')
        OR r.finalized_at IS NOT NULL
      )
      AND public.is_active_org_member(r.customer_organization_id)
    UNION ALL
    SELECT NULL::bigint,
           NULL::uuid,
           i.id,
           i.customer_organization_id,
           pg_catalog.to_jsonb(i) ->> 'invoice_number',
           coalesce(
             public.service_org_review_safe_date(pg_catalog.to_jsonb(i) ->> 'paid_at'),
             public.service_org_review_safe_date(pg_catalog.to_jsonb(i) ->> 'invoice_date')
           ),
           'invoice'::text
    FROM public.service_invoices i
    WHERE i.organization_id = p_service
      AND lower(pg_catalog.btrim(coalesce(i.status, ''))) = 'paid'
      AND public.is_active_org_member(i.customer_organization_id)
  LOOP
    v_key := public.service_org_review_resolve(
      rec.customer_organization_id, p_service, rec.ticket_id, rec.report_id, rec.invoice_id
    );
    IF v_key IS NULL OR v_key = ANY (v_seen) THEN
      CONTINUE;
    END IF;
    v_seen := v_seen || v_key;
    SELECT * INTO v_review FROM public.service_org_reviews r WHERE r.job_key = v_key;
    IF NOT FOUND THEN
      v_review := NULL;
    END IF;
    customer_organization_id := rec.customer_organization_id;
    job_key := v_key;
    ticket_id := rec.ticket_id;
    report_id := rec.report_id;
    invoice_id := rec.invoice_id;
    source := rec.source;
    reference := rec.reference;
    completed_on := rec.completed_on;
    already_rated := v_review.id IS NOT NULL;
    IF v_review.author_user_id = v_uid THEN
      review_id := v_review.id;
      stars := v_review.stars;
      body := v_review.body;
      review_created_at := v_review.created_at;
      can_edit := v_review.created_at >= pg_catalog.now() - public.service_org_review_edit_window();
    ELSE
      review_id := NULL;
      stars := NULL;
      body := NULL;
      review_created_at := NULL;
      can_edit := false;
    END IF;
    RETURN NEXT;
    EXIT WHEN cardinality(v_seen) >= 50;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.service_org_review_eligible_jobs(bigint) IS
  '000957: jobs the signed-in customer member may rate. Empty when they belong to the service org. Returns references, not prices or notes.';

REVOKE ALL ON FUNCTION public.service_org_review_eligible_jobs(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_org_review_eligible_jobs(bigint) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
