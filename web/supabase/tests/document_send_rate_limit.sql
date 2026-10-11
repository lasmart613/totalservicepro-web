-- Executes take_document_send_slot and release_document_send_slot.
-- Not a migration. Apply 20261010_000910_document_send_rate_limit.sql first,
-- then run this file in its own transaction. The last statement raises
-- document_send_rate_limit_ok on purpose so the slot rows roll back.
-- A different exception means an assertion failed and the rows roll back too.
--
-- Do not run this against production. It writes slot rows until the raise.

DO $$
DECLARE
  v jsonb;
  v_id bigint;
  i integer;
BEGIN
  FOR i IN 1..5 LOOP
    v := public.take_document_send_slot('sql-test-org', 'invoice', '40');
    IF (v->>'ok')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'invoice take % should succeed, got %', i, v;
    END IF;
    IF v->>'id' IS NULL OR v->>'stamp' IS NULL THEN
      RAISE EXCEPTION 'invoice take % should return id and stamp, got %', i, v;
    END IF;
    IF (v->>'stamp')::numeric < 1000000000000 THEN
      RAISE EXCEPTION 'stamp should be epoch milliseconds, got %', v->>'stamp';
    END IF;
    IF i = 5 THEN
      v_id := (v->>'id')::bigint;
    END IF;
  END LOOP;

  v := public.take_document_send_slot('sql-test-org', 'invoice', '40');
  IF (v->>'ok')::boolean IS DISTINCT FROM false OR v->>'scope' IS DISTINCT FROM 'document' THEN
    RAISE EXCEPTION 'document cap: 6th invoice 40 should be refused, got %', v;
  END IF;

  v := public.take_document_send_slot('sql-test-org', 'estimate', '40');
  IF (v->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'estimate 40 should not share the invoice 40 bucket, got %', v;
  END IF;

  -- 5 invoice slots + 1 estimate slot. 14 more distinct documents reach 20.
  FOR i IN 1..14 LOOP
    v := public.take_document_send_slot('sql-test-org', 'report', 'doc-' || i);
    IF (v->>'ok')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'org fill % should succeed, got %', i, v;
    END IF;
  END LOOP;

  v := public.take_document_send_slot('sql-test-org', 'purchase_order', 'new');
  IF (v->>'ok')::boolean IS DISTINCT FROM false OR v->>'scope' IS DISTINCT FROM 'organization' THEN
    RAISE EXCEPTION 'organization cap: 21st send should be refused, got %', v;
  END IF;

  PERFORM public.release_document_send_slot('sql-test-org', 'invoice', '40', v_id);

  v := public.take_document_send_slot('sql-test-org', 'invoice', '40');
  IF (v->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'release should free one invoice slot, got %', v;
  END IF;

  v := public.take_document_send_slot('sql-test-other', 'invoice', '40');
  IF (v->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'another organization should have its own cap, got %', v;
  END IF;

  RAISE NOTICE 'document_send_rate_limit assertions passed';
  RAISE EXCEPTION 'document_send_rate_limit_ok';
END $$;
