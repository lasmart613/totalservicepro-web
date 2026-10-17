-- Scheduled catch-up for manual_search_index.
--
-- Nothing indexed a manual automatically, so bulk imports (SQL or REST
-- inserts into public.manuals) stayed unsearchable until someone ran the
-- God button or scripts/index-missing-manuals.mjs. The Netlify scheduled
-- function web/netlify/functions/manual-index-catchup.mts calls these two
-- functions with the service role:
--
--   manuals_missing_search_index(p_limit)  one cheap read: published
--     manuals with no index row whose PDF exists in the manuals bucket.
--     Returns {"missing": n, "eligible": n, "ids": [...]}. Unindexed rows are
--     found first (hash anti-join), then only those are checked against
--     storage.objects, so the idle case is a few milliseconds.
--   record_manual_search_index_failure(p_manual_id, p_error)  backs a
--     manual off after a failed extraction (15 min, doubling, capped at
--     24 h), so one broken PDF cannot block every run.
--
-- public.manual_search_index_failures holds that backoff. It has RLS on and
-- no policies. Only service_role can read or write it.
--
-- SECURITY DEFINER with an empty search_path. Tables are schema-qualified.
-- count, coalesce, jsonb_build_object, jsonb_agg, starts_with, lower, right,
-- rtrim, greatest, least, power and now stay unqualified. EXECUTE is
-- service_role only.
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
  'Backoff for the scheduled manual_search_index catch-up. One row per manual whose last extraction failed. service_role only.';

ALTER TABLE public.manual_search_index_failures ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.manual_search_index_failures FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.manuals_missing_search_index(p_limit integer DEFAULT 5)
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
    SELECT u.id
    FROM unindexed AS u
    WHERE EXISTS (
        SELECT 1 FROM storage.objects AS o
        WHERE o.bucket_id = 'manuals'
          AND o.name IN (u.storage_path, u.entry_file_path)
      )
      OR (
        u.is_folder IS TRUE
        AND EXISTS (
          SELECT 1 FROM storage.objects AS o
          WHERE o.bucket_id = 'manuals'
            AND starts_with(o.name, rtrim(u.storage_path, '/') || '/')
            AND lower(right(o.name, 4)) = '.pdf'
        )
      )
  ),
  eligible AS MATERIALIZED (
    SELECT x.id
    FROM missing AS x
    WHERE NOT EXISTS (
      SELECT 1 FROM public.manual_search_index_failures AS f
      WHERE f.manual_id = x.id AND f.retry_after > now()
    )
  )
  SELECT jsonb_build_object(
    'missing', (SELECT count(*) FROM missing),
    'eligible', (SELECT count(*) FROM eligible),
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

COMMENT ON FUNCTION public.manuals_missing_search_index(integer) IS
  'Published manuals with a PDF in the manuals bucket and no manual_search_index row. Returns missing, eligible (not backed off) and up to p_limit (max 50) eligible ids. service_role only.';

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
    attempts = f.attempts + 1,
    last_error = left(coalesce(p_error, ''), 500),
    last_attempt_at = now(),
    retry_after = now() + least(
      interval '24 hours',
      interval '15 minutes' * power(2, least(f.attempts, 7))
    )
  RETURNING f.retry_after;
$$;

COMMENT ON FUNCTION public.record_manual_search_index_failure(bigint, text) IS
  'Records a failed scheduled extraction and returns retry_after (15 min, doubling, capped at 24 h). service_role only.';

REVOKE ALL ON FUNCTION public.manuals_missing_search_index(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_manual_search_index_failure(bigint, text) FROM PUBLIC;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.manual_search_index_failures FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.manuals_missing_search_index(integer) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.record_manual_search_index_failure(bigint, text) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.manual_search_index_failures FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.manuals_missing_search_index(integer) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.record_manual_search_index_failure(bigint, text) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.manual_search_index_failures TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.manuals_missing_search_index(integer) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.record_manual_search_index_failure(bigint, text) TO service_role';
  END IF;
END
$grant$;

NOTIFY pgrst, 'reload schema';
