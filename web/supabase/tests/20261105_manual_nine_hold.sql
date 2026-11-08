-- Proves the migration's manual_bom_sweep_hold trigger, with the 37 seeded
-- source files already loaded. Does not run a sweep.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF (SELECT count(*) FROM public.manual_nine_source) <> 37 THEN
    RAISE EXCEPTION 'expected the 37 migration source rows';
  END IF;
  IF EXISTS (SELECT 1 FROM public.manual_nine_source WHERE status <> 'pending') THEN
    RAISE EXCEPTION 'seeded sources must start pending';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE t.tgname = 'manual_bom_sweep_hold'
       AND p.proname = 'manual_bom_sweep_hold'
       AND t.tgrelid = 'public.manual_bom_sweep'::regclass
  ) THEN
    RAISE EXCEPTION 'actual manual_bom_sweep_hold trigger is not installed';
  END IF;
  IF position('OLD.status IN (''extracted'', ''no_bom'')' IN pg_get_functiondef('public.manual_bom_sweep_hold()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'installed function is not the migration hold trigger';
  END IF;
END $$;

INSERT INTO public.manual_bom_sweep (manual_id, status, priority) VALUES (9, 'pending', 0);
INSERT INTO public.manual_bom_sweep (manual_id, status, priority) VALUES (42, 'held', 10);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.manual_bom_sweep (manual_id, status, priority) VALUES (43, 'extracted', 10);
    RAISE EXCEPTION 'direct extracted insert was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%refusing to queue manual 43%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.manual_bom_sweep (manual_id, status, priority) VALUES (43, 'no_bom', 10);
    RAISE EXCEPTION 'direct no_bom insert was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%refusing to queue manual 43%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.manual_bom_sweep (manual_id, status, priority) VALUES (43, 'pending', 10);
    RAISE EXCEPTION 'direct pending insert was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%refusing to queue manual 43%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.manual_bom_sweep (manual_id, status, priority) VALUES (43, 'error', 10);
    RAISE EXCEPTION 'direct error insert was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%refusing to queue manual 43%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.manual_bom_sweep SET status = 'extracted' WHERE manual_id = 42;
    RAISE EXCEPTION 'held to extracted was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%refusing to queue manual 42%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.manual_bom_sweep SET status = 'no_bom' WHERE manual_id = 42;
    RAISE EXCEPTION 'held to no_bom was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%refusing to queue manual 42%' THEN RAISE; END IF;
  END;
END $$;

DO $$
BEGIN
  SET LOCAL ROLE service_role;
  BEGIN
    INSERT INTO public.manual_bom_sweep (manual_id, status, priority) VALUES (44, 'extracted', 10);
    RAISE EXCEPTION 'service role extracted insert was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%refusing to queue manual 44%' THEN RAISE; END IF;
  END;
END $$;

DO $$
BEGIN
  DELETE FROM public.manual_bom_sweep WHERE manual_id = 9;
  BEGIN
    INSERT INTO public.manual_bom_sweep (manual_id, status, priority) VALUES (44, 'extracted', 10);
    RAISE EXCEPTION 'extracted insert was allowed with manual 9 missing';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%refusing to queue manual 44%' THEN RAISE; END IF;
  END;
  INSERT INTO public.manual_bom_sweep (manual_id, status, priority) VALUES (9, 'no_bom', 0);
  BEGIN
    INSERT INTO public.manual_bom_sweep (manual_id, status, priority) VALUES (44, 'extracted', 10);
    RAISE EXCEPTION 'no_bom on manual 9 released another manual while sources are pending';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%refusing to queue manual 44%' THEN RAISE; END IF;
  END;
  UPDATE public.manual_nine_source SET status = 'no_line_items';
  UPDATE public.manual_bom_sweep SET status = 'pending' WHERE manual_id = 9;
  BEGIN
    UPDATE public.manual_bom_sweep SET status = 'extracted' WHERE manual_id = 42;
    RAISE EXCEPTION 'complete sources released another manual while manual 9 is pending';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%refusing to queue manual 42%' THEN RAISE; END IF;
  END;
  UPDATE public.manual_bom_sweep SET status = 'no_bom' WHERE manual_id = 9;
  UPDATE public.manual_bom_sweep SET status = 'extracted', parts_added = 2 WHERE manual_id = 42;
  IF NOT EXISTS (
    SELECT 1 FROM public.manual_bom_sweep WHERE manual_id = 42 AND status = 'extracted' AND parts_added = 2
  ) THEN
    RAISE EXCEPTION 'no_bom plus complete sources did not allow a terminal update';
  END IF;
  UPDATE public.manual_nine_source SET status = 'pending' WHERE storage_path = (
    SELECT storage_path FROM public.manual_nine_source ORDER BY storage_path LIMIT 1
  );
  UPDATE public.manual_bom_sweep SET parts_added = 4 WHERE manual_id = 42;
  IF NOT EXISTS (
    SELECT 1 FROM public.manual_bom_sweep WHERE manual_id = 42 AND status = 'extracted' AND parts_added = 4
  ) THEN
    RAISE EXCEPTION 'preexisting extracted history was overwritten or blocked';
  END IF;
  BEGIN
    UPDATE public.manual_bom_sweep SET status = 'pending' WHERE manual_id = 42;
    RAISE EXCEPTION 'preexisting extracted row was moved back to pending while a source is pending';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%refusing to queue manual 42%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.manual_bom_sweep (manual_id, status, priority) VALUES (44, 'extracted', 10);
    RAISE EXCEPTION 'new extracted insert was allowed after one source returned to pending';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%refusing to queue manual 44%' THEN RAISE; END IF;
  END;
END $$;

DO $$
DECLARE
  v_path text;
BEGIN
  SELECT storage_path INTO v_path FROM public.manual_nine_source ORDER BY storage_path LIMIT 1;
  UPDATE public.manual_nine_source SET status = 'extracted' WHERE storage_path <> v_path;
  UPDATE public.manual_nine_source SET status = 'no_line_items' WHERE storage_path = v_path;
  UPDATE public.manual_bom_sweep SET status = 'extracted' WHERE manual_id = 9;
  ALTER TABLE public.manual_nine_source DISABLE TRIGGER manual_nine_source_guard;
  DELETE FROM public.manual_nine_source WHERE storage_path = v_path;
  ALTER TABLE public.manual_nine_source ENABLE TRIGGER manual_nine_source_guard;
  BEGIN
    INSERT INTO public.manual_bom_sweep (manual_id, status, priority) VALUES (44, 'no_bom', 10);
    RAISE EXCEPTION 'terminal insert was allowed with a source row missing';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%refusing to queue manual 44%' THEN RAISE; END IF;
  END;
  ALTER TABLE public.manual_nine_source DISABLE TRIGGER manual_nine_source_guard;
  INSERT INTO public.manual_nine_source (storage_path, role, title, status)
  VALUES (v_path, 'parts_list', 'restored', 'no_line_items');
  ALTER TABLE public.manual_nine_source ENABLE TRIGGER manual_nine_source_guard;
  INSERT INTO public.manual_bom_sweep (manual_id, status, priority) VALUES (44, 'extracted', 10);
  IF NOT EXISTS (SELECT 1 FROM public.manual_bom_sweep WHERE manual_id = 44 AND status = 'extracted') THEN
    RAISE EXCEPTION 'complete inventory with manual 9 extracted did not accept a terminal insert';
  END IF;
END $$;

DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.manual_bom_sweep (manual_id, status, priority) VALUES (45, 'held', 100);
    RAISE EXCEPTION 'authenticated insert was allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;
