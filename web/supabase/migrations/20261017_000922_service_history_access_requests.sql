SET LOCAL lock_timeout = '5s';

-- L-B (QA #314 rev 2): 000923 (clinic owner invite binding) MUST be applied
-- first. Abort before touching anything if its objects are missing.
DO $$
BEGIN
  IF to_regclass('public.clinic_owner_invites') IS NULL
     OR to_regclass('public.clinic_claim_emails') IS NULL
     OR to_regclass('public.organization_membership_departures') IS NULL
     OR to_regprocedure('public.guard_clinic_owner_membership()') IS NULL THEN
    RAISE EXCEPTION '000922 requires 000923 (clinic owner invite binding): apply 000923 first';
  END IF;
END $$;

-- 000922: locked service history teaser + owner permission requests.
--
-- A shop linked to a claimed clinic sees, for one of that clinic's lasers, a
-- locked list of the OTHER finished reports on it: a synthesized title and the
-- date only. A shop owner/admin (or a tech assigned to one of the shop's
-- tickets for that clinic) can ask the clinic for access. A clinic
-- owner/admin approves (creates a service_history_grant through the 000920
-- grant_service_history, scoped to that laser by default) or denies.
--
-- Nothing here widens RLS. The teaser comes only from the SECURITY DEFINER
-- RPC get_locked_service_history_teaser, which returns (ref, title,
-- service_date) and nothing else. No policy or table is changed. ONE existing
-- function is redefined: public.grant_service_history (000920) gains the M-1
-- guard below; its live body (md5 c4b6de797b5e6ee4efcb918aa5137d69, read from
-- prod 2026-10-17) is restored verbatim by the rollback. 000919/000921 bodies
-- are untouched.
--
-- QA #314 revision (2026-10-17):
--   M-1  An approver who is also a member of the requesting/grantee shop is
--        refused, in respond_to_service_history_request AND in
--        grant_service_history. A clinic whose only approvers are members of
--        the shop counts as 'unclaimed' for that shop (no teaser, no request).
--   L-1  Approve re-checks the pair: a block in organization_customer_link_blocks
--        (or a removed link) closes the request ('blocked' / 'link_removed')
--        instead of granting.
--   L-2  The 30-day cooldown after a denial is per (clinic, shop), not per laser.
--   L-3  Tech requesters: a member assigned to a NON-cancelled ticket of the
--        shop for that clinic that is still open (not Completed/Closed) or was
--        serviced/updated in the last 90 days.
-- ORDERING: apply 000923 (clinic claim / invite binding) BEFORE this migration;
-- the first DO block enforces it. 000923 redefines none of the functions here.
--
-- QA #314 rev 2:
--   L-A  Leave / approve / re-join: trigger trg_revoke_conflicted_history_grants
--        on organization_memberships revokes every active service_history_grants
--        row whose granted_by user gains (INSERT or UPDATE) a membership in the
--        grantee shop. Chosen over a read-time check because grants record
--        granted_by, the trigger fires for every writer (clients, service role,
--        set_home_membership, the 000923 claim), the revocation is durable and
--        visible to the owner (revoked_at / revoked_by on the Shared-with list),
--        and it needs no change to the live read paths
--        (get_shared_service_history / can_view_service_report_for_history),
--        so no further live function bodies are redefined. Prod has 0 grants
--        today, so there is nothing to sweep.
--   I-1  A dual member can neither approve NOR deny its own shop's request,
--        and is not an owner recipient of its own shop's request notice.
--   I-2  grant_service_history refuses a shop the clinic has blocked.
--   I-3  A Completed/Closed ticket keeps a tech eligible only while its
--        service date (or creation date when unset) lies within the last 90
--        days and not in the future; updated_at no longer counts.
--
-- Eligibility (Rule A, Larry 2026-10-17): caller's active shop
--   = get_my_org_id(), active member, service-company type
--   AND organization_customers links (shop, owner)
--   AND owner is a customer-side org with >= 1 owner/company_admin/admin/manager
--   AND (owner, shop) is not in organization_customer_link_blocks
--   AND equipment.id = p_equipment_id belongs to the owner.
-- The serial is never the key (H2). Teaser rows are only the owner's own
-- reports (customer_organization_id = owner) on that laser: equipment_id =
-- the laser, or equipment_id NULL with the serial of THAT owner's row (the
-- same rule get_shared_service_history uses for a per-equipment grant), not
-- written by the caller's shop, finished (status complete or finalized),
-- and not already covered by an active grant to this shop.
--
-- Title: synthesized from service_type only (never report_number, which has
-- a shop prefix, nor any free text). Date: date_out.
-- ref: per-shop HMAC of the report id (key in private.service_history_ref_keys),
-- 32 hex chars; never the report uuid.
--
-- Rate limits (service_history_slots, the 000910 design: one row per slot,
-- sliding window, advisory xact lock, skip-locked cleanup):
--   teaser:  60/h per user, 120/h per shop, 20/h per (shop, laser)
--   request: 20/24h per shop, 5/24h per (shop, clinic)
--   email:   10/24h per clinic (taken by the server route, service_role)
-- Requests: one pending per (clinic, shop, laser) (partial unique index);
-- expire after 14 days (lazily, no pg_cron); 30-day cooldown per (clinic, shop)
-- after a denial.
--
-- Requires 000920 and 000921 (preflight below), and should follow 000923.
-- Safe to re-run.
-- Rollback: 20261017_000922_service_history_access_requests_rollback.sql
-- Proof: web/supabase/tests/20261017_service_history_access_requests.sql

DO $$
BEGIN
  IF to_regprocedure('public.grant_service_history(bigint,bigint,bigint)') IS NULL
     OR to_regprocedure('public.service_history_owner_admin(bigint)') IS NULL
     OR to_regclass('public.organization_customer_link_blocks') IS NULL
     OR to_regclass('public.service_history_grants') IS NULL THEN
    RAISE EXCEPTION '000922 requires 000920 and 000921';
  END IF;
  IF to_regprocedure('extensions.hmac(bytea,bytea,text)') IS NULL
     OR to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    RAISE EXCEPTION '000922 requires pgcrypto in schema extensions';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Private HMAC key for teaser refs. Not exposed (no client grants).
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.service_history_ref_keys (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  secret bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE private.service_history_ref_keys FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO private.service_history_ref_keys (id, secret)
VALUES (1, extensions.gen_random_bytes(32))
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Rate limiter.
CREATE TABLE IF NOT EXISTS public.service_history_slots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket text NOT NULL,
  scope_key text NOT NULL,
  taken_at timestamptz NOT NULL,
  CONSTRAINT service_history_slots_bucket_check CHECK (bucket IN (
    'teaser_user', 'teaser_shop', 'teaser_equipment',
    'request_shop', 'request_pair', 'request_email_owner'
  )),
  CONSTRAINT service_history_slots_key_not_blank CHECK (scope_key <> '')
);
COMMENT ON TABLE public.service_history_slots IS
  'One row per taken slot for the service history teaser / request / email caps. Written only by take_service_history_slot. No client policies.';
CREATE INDEX IF NOT EXISTS service_history_slots_bucket_key_taken
  ON public.service_history_slots (bucket, scope_key, taken_at);
CREATE INDEX IF NOT EXISTS service_history_slots_taken
  ON public.service_history_slots (taken_at);
ALTER TABLE public.service_history_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.service_history_slots FROM PUBLIC, anon, authenticated, service_role;
DO $$
DECLARE
  seq text;
BEGIN
  seq := pg_catalog.pg_get_serial_sequence('public.service_history_slots', 'id');
  IF seq IS NOT NULL THEN
    EXECUTE pg_catalog.format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', seq);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.take_service_history_slot(
  p_bucket text,
  p_key text,
  p_max integer,
  p_window interval
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bucket text := pg_catalog.btrim(coalesce(p_bucket, ''));
  v_key text := pg_catalog.btrim(coalesce(p_key, ''));
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_count integer;
BEGIN
  IF v_bucket = '' OR v_key = '' OR p_max IS NULL OR p_max < 1
     OR p_window IS NULL OR p_window <= interval '0' OR p_window > interval '24 hours' THEN
    RETURN false;
  END IF;

  -- Rows older than the longest window never count again.
  DELETE FROM public.service_history_slots AS slot
  WHERE slot.id IN (
    SELECT expired.id
    FROM public.service_history_slots AS expired
    WHERE expired.taken_at <= v_now - interval '24 hours'
    ORDER BY expired.id
    LIMIT 500
    FOR UPDATE SKIP LOCKED
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tsp.history_slot:' || v_bucket || ':' || v_key, 0)
  );

  SELECT count(*)::integer INTO v_count
  FROM public.service_history_slots
  WHERE bucket = v_bucket
    AND scope_key = v_key
    AND taken_at > v_now - p_window;

  IF v_count >= p_max THEN
    RETURN false;
  END IF;

  INSERT INTO public.service_history_slots (bucket, scope_key, taken_at)
  VALUES (v_bucket, v_key, v_now);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.take_service_history_slot(text, text, integer, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_service_history_slot(text, text, integer, interval) TO service_role;

-- ---------------------------------------------------------------------------
-- Requests.
CREATE TABLE IF NOT EXISTS public.service_history_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_org_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requester_shop_org_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  equipment_id bigint NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  requested_report_id uuid REFERENCES public.service_reports(id) ON DELETE SET NULL,
  teaser_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '336 hours',
  responded_by uuid,
  responded_at timestamptz,
  approved_scope text,
  grant_id bigint REFERENCES public.service_history_grants(id) ON DELETE SET NULL,
  close_reason text,
  notified_at timestamptz,
  CONSTRAINT service_history_requests_status_check CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  CONSTRAINT service_history_requests_scope_check CHECK (approved_scope IS NULL OR approved_scope IN ('equipment', 'all')),
  CONSTRAINT service_history_requests_close_reason_check CHECK (close_reason IS NULL OR close_reason IN ('expired', 'equipment_moved', 'blocked', 'link_removed', 'covered')),
  CONSTRAINT service_history_requests_not_self CHECK (owner_org_id <> requester_shop_org_id),
  CONSTRAINT service_history_requests_response CHECK ((status IN ('approved', 'denied')) = (responded_at IS NOT NULL)),
  CONSTRAINT service_history_requests_approved_scope CHECK (status <> 'approved' OR approved_scope IS NOT NULL)
);
COMMENT ON TABLE public.service_history_requests IS
  'A shop asks a clinic (owner) to share one laser''s past service history. Written only by request_service_history_access / respond_to_service_history_request. Approval creates a service_history_grants row via grant_service_history. No client policies.';

CREATE UNIQUE INDEX IF NOT EXISTS service_history_requests_one_pending
  ON public.service_history_requests (owner_org_id, requester_shop_org_id, equipment_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS service_history_requests_owner
  ON public.service_history_requests (owner_org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS service_history_requests_shop
  ON public.service_history_requests (requester_shop_org_id, equipment_id, created_at DESC);

ALTER TABLE public.service_history_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.service_history_requests FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.service_history_requests TO service_role;
GRANT UPDATE (notified_at) ON TABLE public.service_history_requests TO service_role;
DO $$
DECLARE
  seq text;
BEGIN
  seq := pg_catalog.pg_get_serial_sequence('public.service_history_requests', 'id');
  IF seq IS NOT NULL THEN
    EXECUTE pg_catalog.format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', seq);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Internal helpers (no client EXECUTE).

-- Rule A. p_shop is the caller's active shop (checked by the callers).
CREATE OR REPLACE FUNCTION public.service_history_teaser_eligible(p_shop bigint, p_owner bigint, p_equipment bigint)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  -- 'ok', 'unclaimed' (linked, own laser, but nobody can approve yet), or 'no'.
  SELECT CASE
    WHEN p_shop IS NULL OR p_owner IS NULL OR p_equipment IS NULL OR p_shop = p_owner THEN 'no'
    WHEN NOT EXISTS (
      SELECT 1 FROM public.organizations s
      WHERE s.id = p_shop AND lower(btrim(coalesce(s.type, ''))) IN ('service_company', 'service')
    ) THEN 'no'
    WHEN NOT EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = p_owner AND lower(btrim(coalesce(o.type, ''))) IN ('customer', 'laser_clinic', 'laser_rental', 'laser_reseller')
    ) THEN 'no'
    WHEN NOT EXISTS (
      SELECT 1 FROM public.organization_customers oc
      WHERE oc.service_organization_id = p_shop AND oc.customer_organization_id = p_owner
    ) THEN 'no'
    WHEN EXISTS (
      SELECT 1 FROM public.organization_customer_link_blocks b
      WHERE b.owner_org_id = p_owner AND b.shop_org_id = p_shop
    ) THEN 'no'
    WHEN NOT EXISTS (
      SELECT 1 FROM public.equipment e
      WHERE e.id = p_equipment AND e.customer_organization_id = p_owner
    ) THEN 'no'
    -- Claimed FOR THIS SHOP: at least one approver who is not also a member of
    -- the shop (M-1: a dual member may never approve its own shop).
    WHEN NOT EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.organization_id = p_owner
        AND lower(btrim(coalesce(m.role, ''))) IN ('owner', 'company_admin', 'admin', 'manager')
        AND NOT EXISTS (
          SELECT 1 FROM public.organization_memberships sm
          WHERE sm.organization_id = p_shop AND sm.user_id = m.user_id
        )
    ) THEN 'unclaimed'
    ELSE 'ok'
  END;
$$;
REVOKE ALL ON FUNCTION public.service_history_teaser_eligible(bigint, bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.service_history_title(p_service_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE lower(btrim(coalesce(p_service_type, '')))
    WHEN 'pm' THEN 'Preventive maintenance'
    WHEN 'repair' THEN 'Repair'
    WHEN 'pm+repair' THEN 'PM + repair'
    WHEN 'pm + repair' THEN 'PM + repair'
    WHEN 'pm and repair' THEN 'PM + repair'
    ELSE 'Service report'
  END;
$$;
REVOKE ALL ON FUNCTION public.service_history_title(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_history_title(text) TO authenticated, service_role;

-- Locked rows for (shop, owner, laser). Eligibility is checked by callers.
CREATE OR REPLACE FUNCTION public.service_history_teaser_rows(p_shop bigint, p_owner bigint, p_equipment bigint)
RETURNS TABLE (report_id uuid, ref text, title text, service_date date)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.id,
         left(encode(extensions.hmac(convert_to(r.id::text || ':' || p_shop::text, 'UTF8'), k.secret, 'sha256'), 'hex'), 32),
         public.service_history_title(r.service_type),
         r.date_out
  FROM public.equipment e
  CROSS JOIN private.service_history_ref_keys k
  JOIN public.service_reports r
    ON r.customer_organization_id = p_owner
   AND (
     r.equipment_id = e.id
     OR (
       r.equipment_id IS NULL
       AND btrim(coalesce(e.serial_number, '')) <> ''
       AND lower(btrim(e.serial_number)) = lower(btrim(r.serial_number))
     )
   )
  WHERE e.id = p_equipment
    AND e.customer_organization_id = p_owner
    AND k.id = 1
    AND r.organization_id IS DISTINCT FROM p_shop
    AND (lower(btrim(coalesce(r.status, ''))) = 'complete' OR r.finalized_at IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1
      FROM public.service_history_grants g
      LEFT JOIN public.equipment ge ON ge.id = g.equipment_id
      WHERE g.owner_org_id = p_owner
        AND g.grantee_shop_org_id = p_shop
        AND g.revoked_at IS NULL
        AND (
          g.equipment_id IS NULL
          OR g.equipment_id = r.equipment_id
          OR (
            r.equipment_id IS NULL
            AND ge.serial_number IS NOT NULL
            AND btrim(ge.serial_number) <> ''
            AND lower(btrim(ge.serial_number)) = lower(btrim(r.serial_number))
          )
        )
    )
  ORDER BY r.date_out DESC NULLS LAST, 2
  LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.service_history_teaser_rows(bigint, bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;

-- Caller may send requests for (shop, owner): shop owner/admin/manager, or a
-- tech currently assigned to one of the shop's tickets for that clinic. L-3
-- bound: the ticket is not Cancelled, and is either still open (status not
-- Completed/Closed) or was serviced in the last 90 days (service date, or
-- creation date when unset; never a future date).
CREATE OR REPLACE FUNCTION public.service_history_can_request(p_shop bigint, p_owner bigint)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.organization_memberships m
        WHERE m.user_id = auth.uid()
          AND m.organization_id = p_shop
          AND lower(btrim(coalesce(m.role, ''))) IN ('owner', 'company_admin', 'admin', 'manager', 'service_manager')
      )
      OR (
        EXISTS (
          SELECT 1 FROM public.organization_memberships m
          WHERE m.user_id = auth.uid() AND m.organization_id = p_shop
        )
        AND EXISTS (
          SELECT 1 FROM public.service_tickets t
          WHERE t.organization_id = p_shop
            AND t.customer_organization_id = p_owner
            AND t.assigned_to = auth.uid()
            AND lower(btrim(coalesce(t.status, ''))) NOT IN ('cancelled', 'canceled')
            AND (
              lower(btrim(coalesce(t.status, ''))) NOT IN ('completed', 'closed')
              OR coalesce(t.service_date, t.created_at::date)
                   BETWEEN (now() - interval '90 days')::date AND now()::date
            )
        )
      )
    );
$$;
REVOKE ALL ON FUNCTION public.service_history_can_request(bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Client RPCs.

CREATE OR REPLACE FUNCTION public.get_locked_service_history_teaser(p_owner_org bigint, p_equipment_id bigint)
RETURNS TABLE (ref text, title text, service_date date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  shop bigint;
  elig text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  shop := public.get_my_org_id();
  IF shop IS NULL OR NOT public.is_active_org_member(shop) THEN
    RAISE EXCEPTION 'not available for this laser' USING ERRCODE = '42501';
  END IF;
  elig := public.service_history_teaser_eligible(shop, p_owner_org, p_equipment_id);
  IF elig = 'unclaimed' THEN
    RAISE EXCEPTION 'clinic_unclaimed' USING ERRCODE = '42501';
  ELSIF elig <> 'ok' THEN
    RAISE EXCEPTION 'not available for this laser' USING ERRCODE = '42501';
  END IF;
  IF NOT public.take_service_history_slot('teaser_user', uid::text, 60, interval '1 hour')
     OR NOT public.take_service_history_slot('teaser_shop', shop::text, 120, interval '1 hour')
     OR NOT public.take_service_history_slot('teaser_equipment', shop::text || ':' || p_equipment_id::text, 20, interval '1 hour') THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
    SELECT t.ref, t.title, t.service_date
    FROM public.service_history_teaser_rows(shop, p_owner_org, p_equipment_id) t;
END;
$$;
REVOKE ALL ON FUNCTION public.get_locked_service_history_teaser(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_locked_service_history_teaser(bigint, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_service_history_access(
  p_owner_org bigint,
  p_equipment_id bigint,
  p_ref text DEFAULT NULL
)
RETURNS TABLE (request_id bigint, status text, created boolean, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  shop bigint;
  elig text;
  n_rows integer;
  existing record;
  last_denied timestamptz;
  report uuid;
  new_id bigint;
  new_exp timestamptz;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  shop := public.get_my_org_id();
  IF shop IS NULL OR NOT public.is_active_org_member(shop) THEN
    RAISE EXCEPTION 'not available for this laser' USING ERRCODE = '42501';
  END IF;
  elig := public.service_history_teaser_eligible(shop, p_owner_org, p_equipment_id);
  IF elig = 'unclaimed' THEN
    RAISE EXCEPTION 'clinic_unclaimed' USING ERRCODE = '42501';
  ELSIF elig <> 'ok' THEN
    RAISE EXCEPTION 'not available for this laser' USING ERRCODE = '42501';
  END IF;
  IF NOT public.service_history_can_request(shop, p_owner_org) THEN
    RAISE EXCEPTION 'only a shop owner or admin, or a tech assigned to this clinic, can ask for history' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tsp.history_req:' || p_owner_org::text || ':' || shop::text || ':' || p_equipment_id::text, 0)
  );

  UPDATE public.service_history_requests q
     SET status = 'expired', close_reason = 'expired'
   WHERE q.owner_org_id = p_owner_org
     AND q.requester_shop_org_id = shop
     AND q.equipment_id = p_equipment_id
     AND q.status = 'pending'
     AND q.expires_at <= now();

  -- Dedupe: the open request answers again, nothing new is sent.
  SELECT q.id, q.status, q.expires_at INTO existing
  FROM public.service_history_requests q
  WHERE q.owner_org_id = p_owner_org
    AND q.requester_shop_org_id = shop
    AND q.equipment_id = p_equipment_id
    AND q.status = 'pending';
  IF FOUND THEN
    RETURN QUERY SELECT existing.id, existing.status, false, existing.expires_at;
    RETURN;
  END IF;

  -- Already shared (this laser or all): nothing to ask.
  IF EXISTS (
    SELECT 1 FROM public.service_history_grants g
    WHERE g.owner_org_id = p_owner_org
      AND g.grantee_shop_org_id = shop
      AND g.revoked_at IS NULL
      AND (g.equipment_id IS NULL OR g.equipment_id = p_equipment_id)
  ) THEN
    RETURN QUERY SELECT NULL::bigint, 'approved'::text, false, NULL::timestamptz;
    RETURN;
  END IF;

  -- L-2: the cooldown is per (clinic, shop), whichever laser was denied.
  SELECT max(q.responded_at) INTO last_denied
  FROM public.service_history_requests q
  WHERE q.owner_org_id = p_owner_org
    AND q.requester_shop_org_id = shop
    AND q.status = 'denied';
  IF last_denied IS NOT NULL AND last_denied > now() - interval '720 hours' THEN
    RAISE EXCEPTION 'request_cooldown' USING ERRCODE = 'P0001',
      DETAIL = 'retry_after=' || to_char((last_denied + interval '720 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  END IF;

  SELECT count(*)::integer INTO n_rows
  FROM public.service_history_teaser_rows(shop, p_owner_org, p_equipment_id);
  IF n_rows = 0 THEN
    RAISE EXCEPTION 'no locked history on this laser' USING ERRCODE = '22023';
  END IF;

  IF NOT public.take_service_history_slot('request_shop', shop::text, 20, interval '24 hours')
     OR NOT public.take_service_history_slot('request_pair', shop::text || ':' || p_owner_org::text, 5, interval '24 hours') THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;

  IF p_ref IS NOT NULL AND btrim(p_ref) <> '' THEN
    SELECT t.report_id INTO report
    FROM public.service_history_teaser_rows(shop, p_owner_org, p_equipment_id) t
    WHERE t.ref = lower(btrim(p_ref))
    LIMIT 1;
  END IF;

  INSERT INTO public.service_history_requests
    (owner_org_id, requester_shop_org_id, equipment_id, requested_by, requested_report_id, teaser_count)
  VALUES (p_owner_org, shop, p_equipment_id, uid, report, n_rows)
  RETURNING service_history_requests.id, service_history_requests.expires_at INTO new_id, new_exp;

  RETURN QUERY SELECT new_id, 'pending'::text, true, new_exp;
END;
$$;
REVOKE ALL ON FUNCTION public.request_service_history_access(bigint, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_service_history_access(bigint, bigint, text) TO authenticated;

-- Shop side: the caller's active shop's requests (no user ids).
CREATE OR REPLACE FUNCTION public.list_my_service_history_requests(p_equipment_id bigint DEFAULT NULL)
RETURNS TABLE (
  id bigint,
  owner_org_id bigint,
  equipment_id bigint,
  status text,
  created_at timestamptz,
  expires_at timestamptz,
  responded_at timestamptz,
  approved_scope text,
  retry_after timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  WITH me AS (SELECT public.get_my_org_id() AS shop)
  SELECT q.id, q.owner_org_id, q.equipment_id,
         CASE WHEN q.status = 'pending' AND q.expires_at <= now() THEN 'expired' ELSE q.status END,
         q.created_at, q.expires_at, q.responded_at, q.approved_scope,
         -- L-2: retry_after is the pair-level cooldown end, on every row of that clinic.
         (SELECT max(d.responded_at) + interval '720 hours'
            FROM public.service_history_requests d
           WHERE d.owner_org_id = q.owner_org_id
             AND d.requester_shop_org_id = q.requester_shop_org_id
             AND d.status = 'denied'
             AND d.responded_at > now() - interval '720 hours')
  FROM me
  JOIN public.service_history_requests q ON q.requester_shop_org_id = me.shop
  WHERE me.shop IS NOT NULL
    AND public.is_active_org_member(me.shop)
    AND (p_equipment_id IS NULL OR q.equipment_id = p_equipment_id)
  ORDER BY q.created_at DESC, q.id DESC
  LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.list_my_service_history_requests(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_service_history_requests(bigint) TO authenticated;

-- Owner side: requests to a clinic. p_status 'pending' | 'closed' | 'all'.
CREATE OR REPLACE FUNCTION public.list_incoming_service_history_requests(
  p_owner_org bigint,
  p_status text DEFAULT 'pending',
  p_equipment_id bigint DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id bigint,
  requester_shop_org_id bigint,
  shop_name text,
  equipment_id bigint,
  manufacturer text,
  model text,
  serial_number text,
  teaser_count integer,
  requested_title text,
  requested_date date,
  requested_by_name text,
  status text,
  close_reason text,
  created_at timestamptz,
  expires_at timestamptz,
  responded_at timestamptz,
  approved_scope text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.service_history_owner_admin(p_owner_org) THEN
    RAISE EXCEPTION 'only an owner or admin of this facility can see its history requests' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    WITH eff AS (
      SELECT q.*,
             CASE
               WHEN q.status <> 'pending' THEN q.status
               WHEN q.expires_at <= now() THEN 'expired'
               WHEN EXISTS (SELECT 1 FROM public.organization_customer_link_blocks b
                            WHERE b.owner_org_id = q.owner_org_id AND b.shop_org_id = q.requester_shop_org_id) THEN 'expired'
               WHEN NOT EXISTS (SELECT 1 FROM public.organization_customers oc
                                WHERE oc.customer_organization_id = q.owner_org_id
                                  AND oc.service_organization_id = q.requester_shop_org_id) THEN 'expired'
               WHEN NOT EXISTS (SELECT 1 FROM public.equipment e2
                                WHERE e2.id = q.equipment_id AND e2.customer_organization_id = q.owner_org_id) THEN 'expired'
               ELSE 'pending'
             END AS eff_status,
             CASE
               WHEN q.status <> 'pending' THEN q.close_reason
               WHEN q.expires_at <= now() THEN 'expired'
               WHEN EXISTS (SELECT 1 FROM public.organization_customer_link_blocks b
                            WHERE b.owner_org_id = q.owner_org_id AND b.shop_org_id = q.requester_shop_org_id) THEN 'blocked'
               WHEN NOT EXISTS (SELECT 1 FROM public.organization_customers oc
                                WHERE oc.customer_organization_id = q.owner_org_id
                                  AND oc.service_organization_id = q.requester_shop_org_id) THEN 'link_removed'
               WHEN NOT EXISTS (SELECT 1 FROM public.equipment e2
                                WHERE e2.id = q.equipment_id AND e2.customer_organization_id = q.owner_org_id) THEN 'equipment_moved'
               ELSE NULL
             END AS eff_reason
      FROM public.service_history_requests q
      WHERE q.owner_org_id = p_owner_org
        AND (p_equipment_id IS NULL OR q.equipment_id = p_equipment_id)
    ),
    sel AS (
      SELECT * FROM eff
      WHERE coalesce(p_status, 'pending') = 'all'
         OR (coalesce(p_status, 'pending') = 'pending' AND eff.eff_status = 'pending')
         OR (coalesce(p_status, 'pending') = 'closed' AND eff.eff_status <> 'pending')
    )
    SELECT s.id, s.requester_shop_org_id, so.name, s.equipment_id,
           e.manufacturer, e.model, e.serial_number, s.teaser_count,
           CASE WHEN rr.id IS NOT NULL THEN public.service_history_title(rr.service_type) END,
           rr.date_out,
           NULLIF(btrim(coalesce(up.first_name, '') || ' ' || coalesce(up.last_name, '')), ''),
           s.eff_status, s.eff_reason, s.created_at, s.expires_at, s.responded_at, s.approved_scope,
           count(*) OVER ()
    FROM sel s
    LEFT JOIN public.organizations so ON so.id = s.requester_shop_org_id
    LEFT JOIN public.equipment e ON e.id = s.equipment_id
    LEFT JOIN public.service_reports rr ON rr.id = s.requested_report_id
    LEFT JOIN public.user_profiles up ON up.id = s.requested_by
    ORDER BY (s.eff_status = 'pending') DESC, s.created_at DESC, s.id DESC
    LIMIT LEAST(GREATEST(coalesce(p_limit, 50), 1), 200)
    OFFSET GREATEST(coalesce(p_offset, 0), 0);
END;
$$;
REVOKE ALL ON FUNCTION public.list_incoming_service_history_requests(bigint, text, bigint, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_incoming_service_history_requests(bigint, text, bigint, integer, integer) TO authenticated;

-- Owner side: active grants with real shop names (the Shared-with list).
CREATE OR REPLACE FUNCTION public.list_owner_service_history_grants(p_owner_org bigint, p_equipment_id bigint DEFAULT NULL)
RETURNS TABLE (
  id bigint,
  grantee_shop_org_id bigint,
  shop_name text,
  equipment_id bigint,
  granted_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.service_history_owner_admin(p_owner_org) THEN
    RAISE EXCEPTION 'only an owner or admin of this facility can list its shared history' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT g.id, g.grantee_shop_org_id, s.name, g.equipment_id, g.granted_at
    FROM public.service_history_grants g
    LEFT JOIN public.organizations s ON s.id = g.grantee_shop_org_id
    WHERE g.owner_org_id = p_owner_org
      AND g.revoked_at IS NULL
      AND (p_equipment_id IS NULL OR g.equipment_id IS NULL OR g.equipment_id = p_equipment_id)
    ORDER BY g.granted_at DESC, g.id DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.list_owner_service_history_grants(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_owner_service_history_grants(bigint, bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- M-1: redefine 000920 grant_service_history with the dual-member guard.
-- Everything else is the live body (prod md5 c4b6de797b5e6ee4efcb918aa5137d69);
-- the rollback restores that body verbatim.
DO $$
BEGIN
  IF md5(pg_catalog.pg_get_functiondef('public.grant_service_history(bigint,bigint,bigint)'::regprocedure))
     NOT IN ('c4b6de797b5e6ee4efcb918aa5137d69') THEN
    RAISE NOTICE '000922: grant_service_history body differs from the recorded live body (already patched or drifted)';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.grant_service_history(p_owner_org bigint, p_grantee_shop bigint, p_equipment_id bigint DEFAULT NULL::bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  uid uuid := auth.uid();
  grant_id bigint;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_owner_org IS NULL OR p_grantee_shop IS NULL THEN
    RAISE EXCEPTION 'owner and service company are required' USING ERRCODE = '22023';
  END IF;
  IF p_owner_org = p_grantee_shop THEN
    RAISE EXCEPTION 'an organization cannot grant itself' USING ERRCODE = '22023';
  END IF;
  IF NOT public.service_history_owner_admin(p_owner_org) THEN
    RAISE EXCEPTION 'only an owner or admin of this facility can share its service history' USING ERRCODE = '42501';
  END IF;
  -- M-1 (000922): a clinic approver who is also a member of the grantee shop
  -- may not share the clinic's history with that shop.
  IF EXISTS (
    SELECT 1 FROM public.organization_memberships sm
    WHERE sm.organization_id = p_grantee_shop AND sm.user_id = uid
  ) THEN
    RAISE EXCEPTION 'only an owner or admin who is not part of that service company can share with it' USING ERRCODE = '42501';
  END IF;
  -- I-2 (000922): never share with a shop this facility has blocked.
  IF EXISTS (
    SELECT 1 FROM public.organization_customer_link_blocks b
    WHERE b.owner_org_id = p_owner_org AND b.shop_org_id = p_grantee_shop
  ) THEN
    RAISE EXCEPTION 'this facility has blocked that service company' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations s
    WHERE s.id = p_grantee_shop
      AND lower(btrim(COALESCE(s.type, ''))) IN ('service_company', 'service')
  ) THEN
    RAISE EXCEPTION 'service history can only be shared with a service company' USING ERRCODE = '22023';
  END IF;
  IF p_equipment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.equipment e
    WHERE e.id = p_equipment_id AND e.customer_organization_id = p_owner_org
  ) THEN
    RAISE EXCEPTION 'that equipment does not belong to this facility' USING ERRCODE = '22023';
  END IF;

  SELECT g.id INTO grant_id
  FROM public.service_history_grants g
  WHERE g.owner_org_id = p_owner_org
    AND g.grantee_shop_org_id = p_grantee_shop
    AND COALESCE(g.equipment_id, 0) = COALESCE(p_equipment_id, 0)
    AND g.revoked_at IS NULL;
  IF grant_id IS NOT NULL THEN
    RETURN grant_id;
  END IF;

  INSERT INTO public.service_history_grants (owner_org_id, grantee_shop_org_id, equipment_id, granted_by)
  VALUES (p_owner_org, p_grantee_shop, p_equipment_id, uid)
  ON CONFLICT DO NOTHING
  RETURNING id INTO grant_id;
  IF grant_id IS NULL THEN
    SELECT g.id INTO grant_id
    FROM public.service_history_grants g
    WHERE g.owner_org_id = p_owner_org
      AND g.grantee_shop_org_id = p_grantee_shop
      AND COALESCE(g.equipment_id, 0) = COALESCE(p_equipment_id, 0)
      AND g.revoked_at IS NULL;
  END IF;
  RETURN grant_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.grant_service_history(bigint, bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_service_history(bigint, bigint, bigint) TO authenticated;
-- (CREATE OR REPLACE keeps the existing ACL, incl. the live service_role grant.)

-- Owner approves or denies. The owner comes from the request row, never a parameter.
CREATE OR REPLACE FUNCTION public.respond_to_service_history_request(
  p_request_id bigint,
  p_decision text,
  p_scope text DEFAULT 'equipment'
)
RETURNS TABLE (status text, grant_id bigint, close_reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  q public.service_history_requests%ROWTYPE;
  decision text := lower(btrim(coalesce(p_decision, '')));
  scope text := lower(btrim(coalesce(p_scope, 'equipment')));
  gid bigint;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO q FROM public.service_history_requests r WHERE r.id = p_request_id FOR UPDATE;
  IF q.id IS NULL OR NOT public.service_history_owner_admin(q.owner_org_id) THEN
    RAISE EXCEPTION 'only an owner or admin of this facility can answer this request' USING ERRCODE = '42501';
  END IF;
  IF decision NOT IN ('approve', 'deny') THEN
    RAISE EXCEPTION 'decision must be approve or deny' USING ERRCODE = '22023';
  END IF;
  IF scope NOT IN ('equipment', 'all') THEN
    RAISE EXCEPTION 'scope must be equipment or all' USING ERRCODE = '22023';
  END IF;
  IF q.status <> 'pending' OR q.expires_at <= now() THEN
    IF q.status = 'pending' THEN
      UPDATE public.service_history_requests r SET status = 'expired', close_reason = 'expired' WHERE r.id = q.id;
      RETURN QUERY SELECT 'expired'::text, NULL::bigint, 'expired'::text;
      RETURN;
    END IF;
    RAISE EXCEPTION 'request is no longer open' USING ERRCODE = '22023';
  END IF;

  -- M-1 / I-1: never answer (approve OR deny) your own shop's request.
  IF EXISTS (
    SELECT 1 FROM public.organization_memberships sm
    WHERE sm.organization_id = q.requester_shop_org_id AND sm.user_id = uid
  ) THEN
    RAISE EXCEPTION 'only an owner or admin who is not part of the requesting company can answer this request' USING ERRCODE = '42501';
  END IF;

  -- L-1: a blocked (or unlinked) shop can no longer be approved.
  IF decision = 'approve' AND EXISTS (
    SELECT 1 FROM public.organization_customer_link_blocks b
    WHERE b.owner_org_id = q.owner_org_id AND b.shop_org_id = q.requester_shop_org_id
  ) THEN
    UPDATE public.service_history_requests r SET status = 'expired', close_reason = 'blocked' WHERE r.id = q.id;
    RETURN QUERY SELECT 'expired'::text, NULL::bigint, 'blocked'::text;
    RETURN;
  END IF;
  IF decision = 'approve' AND NOT EXISTS (
    SELECT 1 FROM public.organization_customers oc
    WHERE oc.customer_organization_id = q.owner_org_id AND oc.service_organization_id = q.requester_shop_org_id
  ) THEN
    UPDATE public.service_history_requests r SET status = 'expired', close_reason = 'link_removed' WHERE r.id = q.id;
    RETURN QUERY SELECT 'expired'::text, NULL::bigint, 'link_removed'::text;
    RETURN;
  END IF;

  IF decision = 'approve' AND NOT EXISTS (
    SELECT 1 FROM public.equipment e WHERE e.id = q.equipment_id AND e.customer_organization_id = q.owner_org_id
  ) THEN
    UPDATE public.service_history_requests r SET status = 'expired', close_reason = 'equipment_moved' WHERE r.id = q.id;
    RETURN QUERY SELECT 'expired'::text, NULL::bigint, 'equipment_moved'::text;
    RETURN;
  END IF;

  IF decision = 'deny' THEN
    UPDATE public.service_history_requests r
       SET status = 'denied', responded_by = uid, responded_at = now()
     WHERE r.id = q.id;
    RETURN QUERY SELECT 'denied'::text, NULL::bigint, NULL::text;
    RETURN;
  END IF;

  gid := public.grant_service_history(
    q.owner_org_id,
    q.requester_shop_org_id,
    CASE WHEN scope = 'all' THEN NULL ELSE q.equipment_id END
  );
  UPDATE public.service_history_requests r
     SET status = 'approved', responded_by = uid, responded_at = now(), approved_scope = scope, grant_id = gid
   WHERE r.id = q.id;
  IF scope = 'all' THEN
    UPDATE public.service_history_requests r
       SET status = 'approved', responded_by = uid, responded_at = now(), approved_scope = 'all',
           grant_id = gid, close_reason = 'covered'
     WHERE r.owner_org_id = q.owner_org_id
       AND r.requester_shop_org_id = q.requester_shop_org_id
       AND r.status = 'pending'
       AND r.id <> q.id;
  END IF;
  RETURN QUERY SELECT 'approved'::text, gid, NULL::text;
END;
$$;
REVOKE ALL ON FUNCTION public.respond_to_service_history_request(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_service_history_request(bigint, text, text) TO authenticated;

-- Server route only (service_role): who to notify, and what to say.
-- Owner recipients = the roles that can approve (service_history_owner_admin).
-- Shop recipients = the requester plus the shop's owner/admin members.
-- email_ok honours user_profiles.notification_prefs: notif_email = false
-- (all email) or notif_history_request_email = false (this kind) opts out.
CREATE OR REPLACE FUNCTION public.service_history_request_notice(p_request_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', q.id,
    'status', q.status,
    'owner_org_id', q.owner_org_id,
    'owner_name', o.name,
    'shop_org_id', q.requester_shop_org_id,
    'shop_name', s.name,
    'equipment_id', q.equipment_id,
    'laser', NULLIF(btrim(coalesce(e.manufacturer, '') || ' ' || coalesce(e.model, '')), ''),
    'serial_number', e.serial_number,
    'teaser_count', q.teaser_count,
    'requested_by', q.requested_by,
    'requested_by_name', NULLIF(btrim(coalesce(rp.first_name, '') || ' ' || coalesce(rp.last_name, '')), ''),
    'notified_at', q.notified_at,
    'owner_recipients', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'user_id', up.id, 'email', up.email, 'first_name', up.first_name,
               'email_ok', coalesce((up.notification_prefs ->> 'notif_email')::boolean, true)
                       AND coalesce((up.notification_prefs ->> 'notif_history_request_email')::boolean, true))
             ORDER BY up.id)
      FROM public.organization_memberships m
      JOIN public.user_profiles up ON up.id = m.user_id
      WHERE m.organization_id = q.owner_org_id
        AND lower(btrim(coalesce(m.role, ''))) IN ('owner', 'company_admin', 'admin', 'manager')
        AND coalesce(up.is_active, true)
        -- I-1: members of the requesting shop are not asked to answer it.
        AND NOT EXISTS (
          SELECT 1 FROM public.organization_memberships sm
          WHERE sm.organization_id = q.requester_shop_org_id AND sm.user_id = m.user_id
        )
    ), '[]'::jsonb),
    'shop_recipients', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'user_id', up.id, 'email', up.email, 'first_name', up.first_name,
               'email_ok', coalesce((up.notification_prefs ->> 'notif_email')::boolean, true)
                       AND coalesce((up.notification_prefs ->> 'notif_history_request_email')::boolean, true),
               'is_requester', up.id = q.requested_by)
             ORDER BY up.id)
      FROM public.user_profiles up
      WHERE coalesce(up.is_active, true)
        AND EXISTS (
          SELECT 1 FROM public.organization_memberships m
          WHERE m.user_id = up.id
            AND m.organization_id = q.requester_shop_org_id
            AND (up.id = q.requested_by
                 OR lower(btrim(coalesce(m.role, ''))) IN ('owner', 'company_admin', 'admin'))
        )
    ), '[]'::jsonb)
  )
  FROM public.service_history_requests q
  LEFT JOIN public.organizations o ON o.id = q.owner_org_id
  LEFT JOIN public.organizations s ON s.id = q.requester_shop_org_id
  LEFT JOIN public.equipment e ON e.id = q.equipment_id
  LEFT JOIN public.user_profiles rp ON rp.id = q.requested_by
  WHERE q.id = p_request_id;
$$;
REVOKE ALL ON FUNCTION public.service_history_request_notice(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_history_request_notice(bigint) TO service_role;

-- ---------------------------------------------------------------------------
-- L-A: a user who gains a membership in a shop loses every active grant they
-- gave that shop (closes leave -> approve -> re-join). New object; rollback
-- drops it.
CREATE OR REPLACE FUNCTION public.revoke_conflicted_history_grants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.user_id IS NULL OR NEW.organization_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN
    RETURN NULL;
  END IF;
  UPDATE public.service_history_grants g
     SET revoked_at = greatest(now(), g.granted_at), revoked_by = NEW.user_id
   WHERE g.grantee_shop_org_id = NEW.organization_id
     AND g.granted_by = NEW.user_id
     AND g.revoked_at IS NULL;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_conflicted_history_grants() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_revoke_conflicted_history_grants ON public.organization_memberships;
CREATE TRIGGER trg_revoke_conflicted_history_grants
  AFTER INSERT OR UPDATE OF user_id, organization_id ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public.revoke_conflicted_history_grants();

NOTIFY pgrst, 'reload schema';
