-- Scheduled catch-up for manual_search_index.
--
-- Nothing indexed a manual automatically, so bulk imports (SQL or REST
-- inserts into public.manuals) stayed unsearchable until someone ran the
-- God button or scripts/index-missing-manuals.mjs. The Netlify scheduled
-- function web/netlify/functions/manual-index-catchup.mts calls these
-- functions with the service role:
--
--   manuals_missing_search_index(p_limit, p_max_bytes)  one cheap read:
--     published manuals with no index row whose PDF exists (live version:
--     not archived, not a delete marker) in the manuals bucket. Returns
--     {"missing", "eligible", "oversized", "oversized_ids", "ids"}.
--     Manuals whose PDF bytes exceed p_max_bytes (default 20 MiB) are never
--     eligible; they are counted and listed so the job can log them, and are
--     left to scripts/index-missing-manuals.mjs. Unindexed rows are found
--     first (anti-join), then only those are checked against storage.objects,
--     so the idle case is a few milliseconds.
--   record_manual_search_index_attempt(p_manual_id, p_note)  called BEFORE
--     extracting. Bumps attempts and pushes retry_after out (15 min,
--     doubling, capped at 24 h). If the function is then killed (30 s
--     timeout, out of memory), the manual is already backed off, so one
--     bad PDF cannot be picked first on every run. Success deletes the row.
--   record_manual_search_index_failure(p_manual_id, p_error)  stores the
--     reason after a failed extraction. Does not bump attempts again.
--
-- public.manual_search_index_failures holds that backoff. It has RLS on and
-- no policies. Only service_role can read or write it.
--
-- SECURITY DEFINER with an empty search_path. Tables are schema-qualified.
-- count, sum, max, coalesce, jsonb_build_object, jsonb_agg, starts_with,
-- lower, right, rtrim, left, greatest, least, power and now stay unqualified.
-- EXECUTE is service_role only.
--
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- One transaction. Safe to re-run. Rollback:
-- 20261016_000918_manual_search_index_catchup_rollback.sql

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.manual_search_index_failures (
  manual_id bigint PRIMARY KEY REFERENCES public.manuals(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  last_error text NOT NULL DEFAULT '',
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  retry_after timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.manual_search_index_failures IS
  'Backoff for the scheduled manual_search_index catch-up. One row per manual with an attempt that did not succeed (written before extraction, so timeouts and crashes count). service_role only.';

ALTER TABLE public.manual_search_index_failures ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.manual_search_index_failures FROM PUBLIC;

-- An earlier draft of this migration took (integer) only. It was never
-- applied anywhere, but drop it so a re-run can't leave an ambiguous overload.
DROP FUNCTION IF EXISTS public.manuals_missing_search_index(integer);

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
    SELECT m.id, m.storage_path, m.entry_file_path, m.is_folder
    FROM public.manuals AS m
    WHERE m.published = true
      AND NOT EXISTS (
        SELECT 1 FROM public.manual_search_index AS i WHERE i.manual_id = m.id
      )
  ),
  missing AS MATERIALIZED (
    SELECT u.id, greatest(coalesce(f.bytes, 0), coalesce(d.bytes, 0)) AS bytes
    FROM unindexed AS u
    CROSS JOIN LATERAL (
      SELECT count(*) AS n,
             max(CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,18}$' THEN (o.metadata->>'size')::bigint END) AS bytes
      FROM storage.objects AS o
      WHERE o.bucket_id = 'manuals'
        AND o.name IN (u.storage_path, u.entry_file_path)
        AND o.archived_at IS NULL
        AND o.is_delete_marker IS NOT TRUE
    ) AS f
    CROSS JOIN LATERAL (
      SELECT count(*) AS n,
             sum(CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,18}$' THEN (o.metadata->>'size')::bigint END) AS bytes
      FROM storage.objects AS o
      WHERE u.is_folder IS TRUE
        AND o.bucket_id = 'manuals'
        AND starts_with(o.name, rtrim(u.storage_path, '/') || '/')
        AND lower(right(o.name, 4)) = '.pdf'
        AND o.archived_at IS NULL
        AND o.is_delete_marker IS NOT TRUE
    ) AS d
    WHERE f.n > 0 OR d.n > 0
  ),
  oversized AS MATERIALIZED (
    SELECT x.id
    FROM missing AS x
    WHERE x.bytes > greatest(1, coalesce(p_max_bytes, 20971520))
  ),
  eligible AS MATERIALIZED (
    SELECT x.id
    FROM missing AS x
    WHERE x.bytes <= greatest(1, coalesce(p_max_bytes, 20971520))
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

COMMENT ON FUNCTION public.manuals_missing_search_index(integer, bigint) IS
  'Published manuals with a live PDF in the manuals bucket and no manual_search_index row. Returns missing, eligible (not backed off, not over p_max_bytes), oversized (+ up to 20 ids) and up to p_limit (max 50) eligible ids. service_role only.';

CREATE OR REPLACE FUNCTION public.record_manual_search_index_attempt(
  p_manual_id bigint,
  p_note text
)
RETURNS timestamptz
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.manual_search_index_failures AS f (
    manual_id, attempts, last_error, last_attempt_at, retry_after
  )
  VALUES (
    p_manual_id, 1, left(coalesce(p_note, ''), 500), now(), now() + interval '15 minutes'
  )
  ON CONFLICT (manual_id) DO UPDATE SET
    attempts = f.attempts + 1,
    last_error = left(coalesce(p_note, ''), 500),
    last_attempt_at = now(),
    retry_after = now() + least(
      interval '24 hours',
      interval '15 minutes' * power(2, least(f.attempts, 7))
    )
  RETURNING f.retry_after;
$$;

COMMENT ON FUNCTION public.record_manual_search_index_attempt(bigint, text) IS
  'Called before a scheduled extraction. Bumps attempts and backs the manual off (15 min, doubling, capped at 24 h) so a timeout or crash is still recorded. Success deletes the row. service_role only.';

CREATE OR REPLACE FUNCTION public.record_manual_search_index_failure(
  p_manual_id bigint,
  p_error text
)
RETURNS timestamptz
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.manual_search_index_failures AS f (
    manual_id, attempts, last_error, last_attempt_at, retry_after
  )
  VALUES (
    p_manual_id, 1, left(coalesce(p_error, ''), 500), now(), now() + interval '15 minutes'
  )
  ON CONFLICT (manual_id) DO UPDATE SET
    last_error = left(coalesce(p_error, ''), 500),
    last_attempt_at = now()
  RETURNING f.retry_after;
$$;

COMMENT ON FUNCTION public.record_manual_search_index_failure(bigint, text) IS
  'Stores why a scheduled extraction failed. The attempt (and backoff) was already recorded by record_manual_search_index_attempt, so attempts is not bumped again. service_role only.';

REVOKE ALL ON FUNCTION public.manuals_missing_search_index(integer, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_manual_search_index_attempt(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_manual_search_index_failure(bigint, text) FROM PUBLIC;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.manual_search_index_failures FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.manuals_missing_search_index(integer, bigint) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.record_manual_search_index_attempt(bigint, text) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.record_manual_search_index_failure(bigint, text) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.manual_search_index_failures FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.manuals_missing_search_index(integer, bigint) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.record_manual_search_index_attempt(bigint, text) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.record_manual_search_index_failure(bigint, text) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.manual_search_index_failures TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.manuals_missing_search_index(integer, bigint) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.record_manual_search_index_attempt(bigint, text) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.record_manual_search_index_failure(bigint, text) TO service_role';
  END IF;
END
$grant$;

NOTIFY pgrst, 'reload schema';
