-- 000944: Manual search index - mark oversize PDFs as skipped (Oct 24 Stats).
--
-- Why: 37 published manuals had no manual_search_index rows and the
-- overnight check reported the catch-up as stuck (55 runs, 0 indexed). All 37
-- are PDFs over the 20 MiB cron cap (smallest 2701 at 20,991,515 bytes), so
-- the cron correctly never extracts them, but manuals_missing_search_index
-- still counted them in "missing" and re-checked them against storage.objects
-- on every 15-minute run.
--
-- What changes (no new column; reuses public.manual_search_index_failures,
-- the 000918 backoff table):
--   * NEW record_manual_search_index_oversize(p_max_bytes) marks every
--     published, unindexed, not-in-progress manual whose live PDF bytes are
--     known and over the cap: one failures row per manual with
--     last_error 'oversize_skipped: <bytes> bytes > <cap>; ...' and
--     retry_after = now() + 24 h. Existing attempts are kept. Returns the
--     number of rows marked. The server computes the sizes; it takes no ids.
--   * manuals_missing_search_index(p_limit, p_max_bytes) (000918 body plus):
--     a manual with a live oversize mark (retry_after > now()) is left out of
--     the storage scan and out of "missing"/"oversized", and is reported in
--     two new keys, "oversize_skipped" and "oversize_skipped_ids" (up to 20).
--     Every other key and its meaning is unchanged. After 24 h the mark
--     expires, the row is re-checked once and re-marked if still oversize, so
--     a replaced (smaller, OCR'd) PDF becomes eligible within a day.
--   * The shared sizing logic moves into
--     manual_search_index_unindexed_sizes(p_skip_oversize_marked), used by
--     both functions so they can never disagree.
--
-- scripts/index-missing-manuals.mjs does not read the failures table or this
-- RPC, so marked manuals stay eligible for it. When it indexes a manual the
-- anti-join drops it from every count; the stale mark is harmless.
--
-- Drift guards: 000918 tables present; manuals_missing_search_index body is
-- exactly the 000918 body (md5 6175e1c20eeb81eecb2cb757add3478c, checked
-- against prod on Oct 24); the two new functions do not exist yet.
-- SECURITY DEFINER, search_path ''. EXECUTE: service_role only.
-- Bookkeeping: after applying, record version 20261024_000944 in
-- supabase_migrations.schema_migrations (name
-- manual_search_index_oversize_skipped), same as 000939.
-- Local proof: web/supabase/tests/20261024_manual_search_index_oversize_skipped.sql
-- (PG17). APPLY ON LIVE SUPABASE only after Larry's yes. Rollback:
-- 20261024_000944_manual_search_index_oversize_skipped_rollback.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.manual_search_index_failures') IS NULL
     OR to_regclass('public.manual_search_index_pending') IS NULL
     OR to_regclass('public.manual_search_index') IS NULL THEN
    RAISE EXCEPTION '000944 drift: 000918 tables are missing';
  END IF;
  IF to_regprocedure('public.manuals_missing_search_index(integer,bigint)') IS NULL THEN
    RAISE EXCEPTION '000944 drift: manuals_missing_search_index(integer, bigint) is missing';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc
       WHERE oid = to_regprocedure('public.manuals_missing_search_index(integer,bigint)'))
     IS DISTINCT FROM '6175e1c20eeb81eecb2cb757add3478c' THEN
    RAISE EXCEPTION '000944 drift: manuals_missing_search_index is not the 000918 body; refusing';
  END IF;
  IF to_regprocedure('public.record_manual_search_index_oversize(bigint)') IS NOT NULL
     OR to_regprocedure('public.manual_search_index_unindexed_sizes(boolean)') IS NOT NULL THEN
    RAISE EXCEPTION '000944 drift: 000944 functions already exist; refusing';
  END IF;
END $$;

CREATE FUNCTION public.manual_search_index_unindexed_sizes(p_skip_oversize_marked boolean)
RETURNS TABLE(id bigint, pending_since timestamptz, files bigint, size_unknown boolean, bytes bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH unindexed AS MATERIALIZED (
    SELECT m.id, m.storage_path, m.entry_file_path, m.is_folder, p.started_at AS pending_since
    FROM public.manuals AS m
    LEFT JOIN public.manual_search_index_pending AS p ON p.manual_id = m.id
    WHERE m.published = true
      AND (
        p.manual_id IS NOT NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.manual_search_index AS i WHERE i.manual_id = m.id
        )
      )
      AND NOT (
        coalesce(p_skip_oversize_marked, false)
        AND EXISTS (
          SELECT 1 FROM public.manual_search_index_failures AS f
          WHERE f.manual_id = m.id
            AND starts_with(f.last_error, 'oversize_skipped:')
            AND f.retry_after > now()
        )
      )
  )
  SELECT
    u.id,
    u.pending_since,
    f.n + d.n,
    (f.n > 0 AND f.known < f.n) OR (d.n > 0 AND d.known < d.n),
    greatest(coalesce(f.bytes, 0), coalesce(d.bytes, 0))::bigint
  FROM unindexed AS u
  CROSS JOIN LATERAL (
    SELECT count(*) AS n, count(z.size) AS known, max(z.size) AS bytes
    FROM storage.objects AS o
    CROSS JOIN LATERAL (
      SELECT CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,18}$' THEN (o.metadata->>'size')::bigint END AS size
    ) AS z
    WHERE o.bucket_id = 'manuals'
      AND o.name IN (u.storage_path, u.entry_file_path)
      AND o.archived_at IS NULL
      AND o.is_delete_marker IS NOT TRUE
  ) AS f
  CROSS JOIN LATERAL (
    SELECT count(*) AS n, count(z.size) AS known, sum(z.size) AS bytes
    FROM storage.objects AS o
    CROSS JOIN LATERAL (
      SELECT CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,18}$' THEN (o.metadata->>'size')::bigint END AS size
    ) AS z
    WHERE u.is_folder IS TRUE
      AND o.bucket_id = 'manuals'
      AND starts_with(o.name, rtrim(u.storage_path, '/') || '/')
      AND lower(right(o.name, 4)) = '.pdf'
      AND o.archived_at IS NULL
      AND o.is_delete_marker IS NOT TRUE
  ) AS d;
$$;

COMMENT ON FUNCTION public.manual_search_index_unindexed_sizes(boolean) IS
  '000944: published manuals with no complete index, with live PDF file count and bytes in the manuals bucket (same rules as 000918). p_skip_oversize_marked leaves out manuals with a live oversize_skipped mark. service_role only.';

CREATE OR REPLACE FUNCTION public.manuals_missing_search_index(
  p_limit integer DEFAULT 5,
  p_max_bytes bigint DEFAULT 20971520
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH sized AS MATERIALIZED (
    SELECT * FROM public.manual_search_index_unindexed_sizes(true)
  ),
  marked AS MATERIALIZED (
    SELECT m.id
    FROM public.manuals AS m
    JOIN public.manual_search_index_failures AS f ON f.manual_id = m.id
    WHERE m.published = true
      AND starts_with(f.last_error, 'oversize_skipped:')
      AND f.retry_after > now()
      AND NOT EXISTS (SELECT 1 FROM public.manual_search_index AS i WHERE i.manual_id = m.id)
  ),
  no_file AS MATERIALIZED (
    SELECT x.id FROM sized AS x WHERE x.files = 0
  ),
  missing AS MATERIALIZED (
    SELECT x.id, x.bytes, x.size_unknown, x.pending_since FROM sized AS x WHERE x.files > 0
  ),
  unknown_size AS MATERIALIZED (
    SELECT x.id FROM missing AS x WHERE x.size_unknown
  ),
  oversized AS MATERIALIZED (
    SELECT x.id
    FROM missing AS x
    WHERE NOT x.size_unknown
      AND x.bytes > greatest(1, coalesce(p_max_bytes, 20971520))
  ),
  eligible AS MATERIALIZED (
    SELECT x.id
    FROM missing AS x
    WHERE NOT x.size_unknown
      AND x.bytes <= greatest(1, coalesce(p_max_bytes, 20971520))
      AND (x.pending_since IS NULL OR x.pending_since <= now() - interval '10 minutes')
      AND NOT EXISTS (
        SELECT 1 FROM public.manual_search_index_failures AS f
        WHERE f.manual_id = x.id AND f.retry_after > now()
      )
  )
  SELECT jsonb_build_object(
    'missing', (SELECT count(*) FROM missing),
    'eligible', (SELECT count(*) FROM eligible),
    'oversized', (SELECT count(*) FROM oversized),
    'oversized_ids', coalesce(
      (SELECT jsonb_agg(z.id ORDER BY z.id) FROM (SELECT id FROM oversized ORDER BY id LIMIT 20) AS z),
      '[]'::jsonb
    ),
    'oversize_skipped', (SELECT count(*) FROM marked),
    'oversize_skipped_ids', coalesce(
      (SELECT jsonb_agg(z.id ORDER BY z.id) FROM (SELECT id FROM marked ORDER BY id LIMIT 20) AS z),
      '[]'::jsonb
    ),
    'unknown_size', (SELECT count(*) FROM unknown_size),
    'unknown_size_ids', coalesce(
      (SELECT jsonb_agg(z.id ORDER BY z.id) FROM (SELECT id FROM unknown_size ORDER BY id LIMIT 20) AS z),
      '[]'::jsonb
    ),
    'no_file', (SELECT count(*) FROM no_file),
    'no_file_ids', coalesce(
      (SELECT jsonb_agg(z.id ORDER BY z.id) FROM (SELECT id FROM no_file ORDER BY id LIMIT 20) AS z),
      '[]'::jsonb
    ),
    'in_progress', (SELECT count(*) FROM missing WHERE pending_since IS NOT NULL),
    'ids', coalesce(
      (
        SELECT jsonb_agg(e.id ORDER BY e.id)
        FROM (
          SELECT id FROM eligible
          ORDER BY id
          LIMIT greatest(0, least(coalesce(p_limit, 5), 50))
        ) AS e
      ),
      '[]'::jsonb
    )
  );
$$;

CREATE FUNCTION public.record_manual_search_index_oversize(p_max_bytes bigint DEFAULT 20971520)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cap bigint := greatest(1, coalesce(p_max_bytes, 20971520));
  marked integer;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  INSERT INTO public.manual_search_index_failures AS f (manual_id, attempts, last_error, last_attempt_at, retry_after)
  SELECT
    s.id,
    1,
    'oversize_skipped: ' || s.bytes || ' bytes > ' || cap || '; index with scripts/index-missing-manuals.mjs --apply',
    now(),
    now() + interval '24 hours'
  FROM public.manual_search_index_unindexed_sizes(true) AS s
  WHERE s.files > 0
    AND NOT s.size_unknown
    AND s.pending_since IS NULL
    AND s.bytes > cap
  ON CONFLICT (manual_id) DO UPDATE
    SET last_error = EXCLUDED.last_error,
        last_attempt_at = EXCLUDED.last_attempt_at,
        retry_after = greatest(f.retry_after, EXCLUDED.retry_after);
  GET DIAGNOSTICS marked = ROW_COUNT;
  RETURN marked;
END;
$$;

COMMENT ON FUNCTION public.record_manual_search_index_oversize(bigint) IS
  '000944: marks published, unindexed manuals whose live PDF is over p_max_bytes as oversize_skipped for 24 h (manual_search_index_failures), so the catch-up stops re-scanning and reporting them. Left to scripts/index-missing-manuals.mjs. service_role only.';

REVOKE ALL ON FUNCTION public.manual_search_index_unindexed_sizes(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_manual_search_index_oversize(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.manuals_missing_search_index(integer, bigint) FROM PUBLIC;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.manual_search_index_unindexed_sizes(boolean) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.record_manual_search_index_oversize(bigint) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.manual_search_index_unindexed_sizes(boolean) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.record_manual_search_index_oversize(bigint) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.manual_search_index_unindexed_sizes(boolean) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.record_manual_search_index_oversize(bigint) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.manuals_missing_search_index(integer, bigint) TO service_role';
  END IF;
END
$grant$;

NOTIFY pgrst, 'reload schema';

COMMIT;
