-- Document email caps (invoice, estimate, service report, purchase order).
--
-- The app used to count sends in process memory (20 per organization and
-- 5 per document per hour). A new warm instance started at zero, so the
-- cap was per process, not per shop. This table is one row per taken slot.
-- The key is organization + document type + document id, so invoice 40 and
-- estimate 40 do not share a bucket. Releasing a slot deletes that row
-- (provider failure). A slot that is kept (the provider accepted the mail,
-- or an invoice Checkout session was already created) stays until it is
-- older than one hour, then the next take deletes it.
--
-- Limits match web/lib/billing/send-rate-limit.ts:
--   DOCUMENT_SENDS_PER_ORG_PER_HOUR = 20
--   DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR = 5
--   DOCUMENT_SEND_WINDOW_MS = 1 hour (sliding)
-- A row counts while taken_at > clock - 1 hour. A row exactly one hour old
-- does not count, same as the in-memory prune (now - stamp < window).
--
-- take_document_send_slot locks the organization, then counts and inserts
-- in that same transaction. Two takes for one organization cannot both
-- pass the checks. release_document_send_slot takes the same lock so a
-- release cannot land between the count and the insert.
--
-- Both functions are SECURITY DEFINER with an empty search_path. Every
-- reference is schema-qualified. EXECUTE is service_role only. The send
-- routes call them with the service-role client, not the user JWT.
--
-- RLS is on and there are no policies. anon and authenticated therefore
-- see no rows. Table privileges are revoked from PUBLIC, anon,
-- authenticated, and service_role, so PostgREST does not expose the table.
-- The function owner (the migration role) bypasses RLS and is the only
-- writer. service_role reaches the rows only by calling the functions.
--
-- Deploy order: ship this migration before or with the code. The code
-- falls back to the in-memory limiter when take_document_send_slot is not
-- in the schema yet (undefined function / PostgREST schema cache), so a
-- code deploy that arrives first keeps the old per-instance cap instead of
-- failing every send. Any other database error fails closed (HTTP 503)
-- and does not send. Apply this file before expecting the shared cap.
--
-- 000910 was free on main (latest migration there is 000908). 000909 was
-- also unused on main; this file keeps 000910 as requested.
--
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- The migration runner applies this file as one transaction. Safe to re-run.
-- Do not apply from the app deploy.

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.document_send_slots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL,
  document_type text NOT NULL,
  document_id text NOT NULL,
  taken_at timestamptz NOT NULL,
  CONSTRAINT document_send_slots_document_type_check CHECK (
    document_type IN ('invoice', 'estimate', 'report', 'purchase_order')
  ),
  CONSTRAINT document_send_slots_keys_not_blank CHECK (
    organization_id <> '' AND document_id <> ''
  )
);

COMMENT ON TABLE public.document_send_slots IS
  'One row per document email slot. 20 per organization and 5 per document (organization + type + id) in a sliding hour. Service role calls take_document_send_slot and release_document_send_slot. No client policies.';

COMMENT ON COLUMN public.document_send_slots.taken_at IS
  'When the slot was taken. Rows older than 1 hour are deleted on the next take and do not count toward the cap.';

CREATE INDEX IF NOT EXISTS document_send_slots_org_taken_idx
  ON public.document_send_slots (organization_id, taken_at);

CREATE INDEX IF NOT EXISTS document_send_slots_document_taken_idx
  ON public.document_send_slots (organization_id, document_type, document_id, taken_at);

CREATE INDEX IF NOT EXISTS document_send_slots_taken_at_idx
  ON public.document_send_slots (taken_at);

ALTER TABLE public.document_send_slots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.document_send_slots FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  seq text;
BEGIN
  seq := pg_catalog.pg_get_serial_sequence('public.document_send_slots', 'id');
  IF seq IS NOT NULL THEN
    EXECUTE format(
      'REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role',
      seq
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.take_document_send_slot(
  p_organization_id text,
  p_document_type text,
  p_document_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org text := pg_catalog.btrim(pg_catalog.coalesce(p_organization_id, ''));
  v_type text := pg_catalog.btrim(pg_catalog.coalesce(p_document_type, ''));
  v_doc text := pg_catalog.btrim(pg_catalog.coalesce(p_document_id, ''));
  v_now timestamptz;
  v_org_count integer;
  v_doc_count integer;
  v_id bigint;
  v_taken timestamptz;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);

  IF v_org = ''
     OR v_doc = ''
     OR v_type NOT IN ('invoice', 'estimate', 'report', 'purchase_order') THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'scope', 'organization',
      'message', 'Organization and document are required to send email.'
    );
  END IF;

  v_now := pg_catalog.clock_timestamp();

  -- Expired rows do not count. Skip rows another take is already deleting
  -- so two organizations cannot wait on each other's cleanup.
  DELETE FROM public.document_send_slots AS slot
  WHERE slot.id IN (
    SELECT expired.id
    FROM public.document_send_slots AS expired
    WHERE expired.taken_at <= v_now - interval '1 hour'
    ORDER BY expired.id
    FOR UPDATE SKIP LOCKED
  );

  -- Held until this transaction commits. The counts and the insert below
  -- cannot interleave with another take or release for this organization.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tsp.document_send:' || v_org, 0)
  );

  SELECT count(*)::integer
    INTO v_org_count
  FROM public.document_send_slots
  WHERE organization_id = v_org
    AND taken_at > v_now - interval '1 hour';

  IF v_org_count >= 20 THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'scope', 'organization',
      'message', 'This organization has reached the limit of 20 document emails per hour. Try again later.'
    );
  END IF;

  SELECT count(*)::integer
    INTO v_doc_count
  FROM public.document_send_slots
  WHERE organization_id = v_org
    AND document_type = v_type
    AND document_id = v_doc
    AND taken_at > v_now - interval '1 hour';

  IF v_doc_count >= 5 THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'scope', 'document',
      'message', 'This document has reached the limit of 5 emails per hour. Try again later.'
    );
  END IF;

  INSERT INTO public.document_send_slots (organization_id, document_type, document_id, taken_at)
  VALUES (v_org, v_type, v_doc, v_now)
  RETURNING id, taken_at INTO v_id, v_taken;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'id', v_id,
    'stamp', (pg_catalog.extract(epoch FROM v_taken) * 1000)::bigint
  );
END;
$$;

COMMENT ON FUNCTION public.take_document_send_slot(text, text, text) IS
  'Service-role only. Takes one document email slot if the organization is under 20 and this document (type + id) is under 5 in the last hour. Deletes expired rows. Returns jsonb {ok, id, stamp} or {ok:false, scope, message}.';

CREATE OR REPLACE FUNCTION public.release_document_send_slot(
  p_organization_id text,
  p_document_type text,
  p_document_id text,
  p_slot_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org text := pg_catalog.btrim(pg_catalog.coalesce(p_organization_id, ''));
  v_type text := pg_catalog.btrim(pg_catalog.coalesce(p_document_type, ''));
  v_doc text := pg_catalog.btrim(pg_catalog.coalesce(p_document_id, ''));
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);

  IF v_org = '' OR v_doc = '' OR v_type = '' OR p_slot_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tsp.document_send:' || v_org, 0)
  );

  DELETE FROM public.document_send_slots
  WHERE id = p_slot_id
    AND organization_id = v_org
    AND document_type = v_type
    AND document_id = v_doc;
END;
$$;

COMMENT ON FUNCTION public.release_document_send_slot(text, text, text, bigint) IS
  'Service-role only. Drops one taken slot after the email provider did not accept the send. Does not drop a slot once an invoice Checkout session exists; the route simply does not call this. No-op when the row is already gone.';

REVOKE ALL ON FUNCTION public.take_document_send_slot(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_document_send_slot(text, text, text, bigint) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.take_document_send_slot(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_document_send_slot(text, text, text, bigint) TO service_role;

NOTIFY pgrst, 'reload schema';
