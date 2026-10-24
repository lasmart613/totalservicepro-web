-- Rollback for 000944: restores the exact 000918 manuals_missing_search_index
-- body (md5 6175e1c20eeb81eecb2cb757add3478c), drops the two 000944
-- functions and clears the oversize_skipped marks it wrote. Other
-- manual_search_index_failures rows (real backoff) are kept. Grants on
-- manuals_missing_search_index are unchanged by CREATE OR REPLACE.
-- Deploy-order note: the web code treats the new keys and the mark RPC as
-- optional, so this rollback needs no code revert. Safe to re-run.
-- Bookkeeping: delete version 20261024_000944 from
-- supabase_migrations.schema_migrations after running.
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regprocedure('public.record_manual_search_index_oversize(bigint)') IS NOT NULL
     AND coalesce(obj_description(to_regprocedure('public.record_manual_search_index_oversize(bigint)'), 'pg_proc'), '') NOT LIKE '000944:%' THEN
    RAISE EXCEPTION '000944 rollback drift: record_manual_search_index_oversize is not the 000944 function; refusing';
  END IF;
  IF to_regprocedure('public.manual_search_index_unindexed_sizes(boolean)') IS NOT NULL
     AND coalesce(obj_description(to_regprocedure('public.manual_search_index_unindexed_sizes(boolean)'), 'pg_proc'), '') NOT LIKE '000944:%' THEN
    RAISE EXCEPTION '000944 rollback drift: manual_search_index_unindexed_sizes is not the 000944 function; refusing';
  END IF;
END $$;

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
  ),
  sized AS MATERIALIZED (
    SELECT
      u.id,
      u.pending_since,
      f.n + d.n AS files,
      (f.n > 0 AND f.known < f.n) OR (d.n > 0 AND d.known < d.n) AS size_unknown,
      greatest(coalesce(f.bytes, 0), coalesce(d.bytes, 0)) AS bytes
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
    ) AS d
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

DROP FUNCTION IF EXISTS public.record_manual_search_index_oversize(bigint);
DROP FUNCTION IF EXISTS public.manual_search_index_unindexed_sizes(boolean);

DELETE FROM public.manual_search_index_failures WHERE starts_with(last_error, 'oversize_skipped:');

DO $$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc
       WHERE oid = to_regprocedure('public.manuals_missing_search_index(integer,bigint)'))
     IS DISTINCT FROM '6175e1c20eeb81eecb2cb757add3478c' THEN
    RAISE EXCEPTION '000944 rollback: restored body does not match 000918';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
