-- Scheduled catch-up for manual_search_index.
--
-- Nothing indexed a manual automatically, so bulk imports (SQL or REST
-- inserts into public.manuals) stayed unsearchable until someone ran the
-- God button or scripts/index-missing-manuals.mjs. The Netlify scheduled
-- function web/netlify/functions/manual-index-catchup.mts calls these
-- functions with the service role:
--
--   manuals_missing_search_index(p_limit, p_max_bytes)  one cheap read:
--     published manuals with no complete index (no rows, or an in-progress
--     marker) whose PDF exists (live version: not archived, not a delete
--     marker) in the manuals bucket. Returns {"missing", "eligible",
--     "oversized", "oversized_ids", "unknown_size", "unknown_size_ids",
--     "no_file", "no_file_ids", "in_progress", "ids"}.
--     Never eligible, but counted and listed (up to 20 ids) for the log:
--     PDF bytes over p_max_bytes (default 20 MiB); a size that is missing or
--     not a number in storage metadata (unknown_size, never treated as
--     small); and published unindexed manuals with no live file at all
--     (no_file, not part of "missing"). A manual another writer is
--     indexing right now (marker < 10 min old) is not eligible either. Unindexed rows are found
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
-- Chunked writes. The REST role (authenticator) has statement_timeout = 8s.
-- replace_manual_search_index writes a whole manual in one statement, and
-- each row's generated search_tsv (to_tsvector over up to 1,500,000
-- characters) plus its GIN entries are computed inside that statement, so
-- dense manuals (1195, 1210 on Oct 16) hit the timeout. The script and the
-- scheduled job now write through:
--
--   begin_manual_search_index_append(p_manual_id, p_total_chunks)
--     Expect-empty claim. Refuses when the manual already has a complete
--     index (already_indexed) or another writer started < 10 min ago
--     (busy). A stale claim (>= 10 min, the writer died) is taken over and
--     its partial rows are deleted. Inserts the in-progress marker
--     public.manual_search_index_pending with a fresh token.
--   append_manual_search_index_chunks(p_manual_id, p_token,
--     p_expected_rows, p_chunks, p_clipped, p_page_max)
--     Inserts the next chunks (about 200,000 characters each, one per call)
--     only when the token matches and the manual has exactly
--     p_expected_rows rows.
--   finish_manual_search_index_append(p_manual_id, p_token)
--     Checks every chunk arrived and deletes the marker.
--   abort_manual_search_index_append(p_manual_id, p_token)
--     Deletes the partial rows and the marker (token must match, so it can
--     never delete a complete index).
--
-- While the marker exists the manual is NOT indexed for every reader:
-- search_manual_catalog and manuals_missing_search_index (here), and the
-- app/edge readers, which drop ids with a marker row.
-- replace_manual_search_index also clears the marker when it replaces the
-- rows, so a God reindex wins over a writer in progress (that writer's next
-- call fails its token check and it stops).
--
-- public.manual_search_index_failures holds that backoff. It has RLS on and
-- no policies. Only service_role can read or write it.
--
-- SECURITY DEFINER with an empty search_path. Tables are schema-qualified.
-- count, sum, max, bool_or, coalesce, jsonb_build_object, jsonb_agg,
-- starts_with, lower, right, rtrim, left, greatest, least, power, md5,
-- string_agg, gen_random_uuid, cardinality, generate_subscripts and now
-- stay unqualified.
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

CREATE TABLE IF NOT EXISTS public.manual_search_index_pending (
  manual_id bigint PRIMARY KEY REFERENCES public.manuals(id) ON DELETE CASCADE,
  token uuid NOT NULL,
  total_chunks integer NOT NULL CHECK (total_chunks BETWEEN 1 AND 100),
  started_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.manual_search_index_pending IS
  'In-progress marker for a chunked manual_search_index write. While a row exists the manual is not indexed for any reader. service_role only.';

ALTER TABLE public.manual_search_index_pending ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.manual_search_index_pending FROM PUBLIC;

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

COMMENT ON FUNCTION public.manuals_missing_search_index(integer, bigint) IS
  'Published manuals with a live PDF in the manuals bucket and no complete manual_search_index (no rows, or an in-progress marker). Returns missing, eligible (not backed off, size known and within p_max_bytes, no fresh marker), oversized, unknown_size and no_file (each + up to 20 ids), in_progress, and up to p_limit (max 50) eligible ids. service_role only.';

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

CREATE OR REPLACE FUNCTION public.begin_manual_search_index_append(
  p_manual_id bigint,
  p_total_chunks integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  marker public.manual_search_index_pending%ROWTYPE;
  new_token uuid;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM pg_advisory_xact_lock(p_manual_id);

  IF p_total_chunks IS NULL OR p_total_chunks < 1 OR p_total_chunks > 100 THEN
    RAISE EXCEPTION 'begin_manual_search_index_append: p_total_chunks must be 1..100';
  END IF;

  SELECT * INTO marker FROM public.manual_search_index_pending WHERE manual_id = p_manual_id;
  IF FOUND THEN
    IF marker.started_at > now() - interval '10 minutes' THEN
      RETURN jsonb_build_object('status', 'busy');
    END IF;
    -- Stale claim: its writer died. Drop the partial rows it left.
    DELETE FROM public.manual_search_index WHERE manual_id = p_manual_id;
    DELETE FROM public.manual_search_index_pending WHERE manual_id = p_manual_id;
  ELSIF EXISTS (SELECT 1 FROM public.manual_search_index WHERE manual_id = p_manual_id) THEN
    RETURN jsonb_build_object('status', 'already_indexed');
  END IF;

  new_token := gen_random_uuid();
  INSERT INTO public.manual_search_index_pending (manual_id, token, total_chunks, started_at)
  VALUES (p_manual_id, new_token, p_total_chunks, now());
  RETURN jsonb_build_object('status', 'ok', 'token', new_token);
END;
$$;

COMMENT ON FUNCTION public.begin_manual_search_index_append(bigint, integer) IS
  'Expect-empty claim for a chunked index write. Returns {status: ok, token} | already_indexed | busy. Takes over a marker older than 10 minutes and deletes its partial rows. service_role only.';

CREATE OR REPLACE FUNCTION public.append_manual_search_index_chunks(
  p_manual_id bigint,
  p_token uuid,
  p_expected_rows integer,
  p_chunks text[],
  p_clipped boolean[],
  p_page_max integer[]
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  marker public.manual_search_index_pending%ROWTYPE;
  have integer;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM pg_advisory_xact_lock(p_manual_id);

  IF p_chunks IS NULL OR cardinality(p_chunks) = 0 THEN
    RAISE EXCEPTION 'append_manual_search_index_chunks requires p_chunks';
  END IF;

  SELECT * INTO marker FROM public.manual_search_index_pending WHERE manual_id = p_manual_id;
  IF NOT FOUND OR marker.token IS DISTINCT FROM p_token THEN
    RETURN false;
  END IF;

  SELECT count(*) INTO have FROM public.manual_search_index WHERE manual_id = p_manual_id;
  IF have IS DISTINCT FROM p_expected_rows
     OR p_expected_rows + cardinality(p_chunks) > marker.total_chunks THEN
    RETURN false;
  END IF;

  INSERT INTO public.manual_search_index (
    manual_id,
    chunk_index,
    search_text,
    index_clipped,
    indexed_page_max,
    indexed_at
  )
  SELECT
    p_manual_id,
    p_expected_rows + gs.i - 1,
    p_chunks[gs.i],
    coalesce(p_clipped[gs.i], false),
    p_page_max[gs.i],
    now()
  FROM generate_subscripts(p_chunks, 1) AS gs(i);

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.append_manual_search_index_chunks(bigint, uuid, integer, text[], boolean[], integer[]) IS
  'Appends the next chunks of a claimed chunked write. Refuses (false) unless the marker token matches and the manual has exactly p_expected_rows rows. Each call is its own statement, so it stays under the 8 s REST statement_timeout. service_role only.';

CREATE OR REPLACE FUNCTION public.finish_manual_search_index_append(
  p_manual_id bigint,
  p_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  marker public.manual_search_index_pending%ROWTYPE;
  have integer;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM pg_advisory_xact_lock(p_manual_id);

  SELECT * INTO marker FROM public.manual_search_index_pending WHERE manual_id = p_manual_id;
  IF NOT FOUND OR marker.token IS DISTINCT FROM p_token THEN
    RETURN false;
  END IF;
  SELECT count(*) INTO have FROM public.manual_search_index WHERE manual_id = p_manual_id;
  IF have IS DISTINCT FROM marker.total_chunks THEN
    RETURN false;
  END IF;
  DELETE FROM public.manual_search_index_pending WHERE manual_id = p_manual_id;
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.finish_manual_search_index_append(bigint, uuid) IS
  'Completes a chunked write: when every chunk is present, deletes the in-progress marker so readers see the manual. service_role only.';

CREATE OR REPLACE FUNCTION public.abort_manual_search_index_append(
  p_manual_id bigint,
  p_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM pg_advisory_xact_lock(p_manual_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.manual_search_index_pending
    WHERE manual_id = p_manual_id AND token = p_token
  ) THEN
    RETURN false;
  END IF;
  DELETE FROM public.manual_search_index WHERE manual_id = p_manual_id;
  DELETE FROM public.manual_search_index_pending WHERE manual_id = p_manual_id;
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.abort_manual_search_index_append(bigint, uuid) IS
  'Cleans up a failed chunked write: deletes its partial rows and marker. Does nothing unless the token matches, so it never deletes a complete index. service_role only.';

-- Same as 000913 plus: a successful replace also clears an in-progress
-- marker, so a God reindex wins over a chunked writer.
CREATE OR REPLACE FUNCTION public.replace_manual_search_index(
  p_manual_id bigint,
  p_chunks text[],
  p_clipped boolean[],
  p_page_max integer[],
  p_expected_md5 text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_md5 text;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM pg_advisory_xact_lock(p_manual_id);

  IF p_chunks IS NULL THEN
    RAISE EXCEPTION 'replace_manual_search_index requires p_chunks';
  END IF;

  SELECT md5(string_agg(i.search_text, E'\f' ORDER BY i.chunk_index))
  INTO current_md5
  FROM public.manual_search_index AS i
  WHERE i.manual_id = p_manual_id;

  IF current_md5 IS DISTINCT FROM p_expected_md5 THEN
    RETURN false;
  END IF;

  DELETE FROM public.manual_search_index WHERE manual_id = p_manual_id;
  DELETE FROM public.manual_search_index_pending WHERE manual_id = p_manual_id;

  INSERT INTO public.manual_search_index (
    manual_id,
    chunk_index,
    search_text,
    index_clipped,
    indexed_page_max,
    indexed_at
  )
  SELECT
    p_manual_id,
    gs.i - 1,
    p_chunks[gs.i],
    COALESCE(p_clipped[gs.i], false),
    p_page_max[gs.i],
    now()
  FROM generate_subscripts(p_chunks, 1) AS gs(i);

  RETURN true;
END;
$$;

-- Same as 000913 plus: a manual with an in-progress marker is not
-- searchable. search_path is now '' (every name was already qualified or
-- pg_catalog). CREATE OR REPLACE keeps the existing grants
-- (authenticated, service_role).
CREATE OR REPLACE FUNCTION public.search_manual_catalog(q text)
RETURNS TABLE(manual_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT i.manual_id
  FROM public.manual_search_index i
  JOIN public.manuals m ON m.id = i.manual_id
  WHERE m.published = true
    AND NOT EXISTS (
      SELECT 1 FROM public.manual_search_index_pending AS p WHERE p.manual_id = i.manual_id
    )
    AND nullif(btrim(q), '') IS NOT NULL
    AND char_length(btrim(q)) >= 2
    AND (
      i.search_tsv @@ plainto_tsquery('simple', q)
      OR i.search_text ILIKE '%' || replace(replace(btrim(q), '%', ''), '_', '') || '%'
    );
$$;

REVOKE ALL ON FUNCTION public.manuals_missing_search_index(integer, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_manual_search_index_attempt(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_manual_search_index_failure(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_manual_search_index_append(bigint, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_manual_search_index_chunks(bigint, uuid, integer, text[], boolean[], integer[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_manual_search_index_append(bigint, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.abort_manual_search_index_append(bigint, uuid) FROM PUBLIC;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.manual_search_index_failures FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.manuals_missing_search_index(integer, bigint) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.record_manual_search_index_attempt(bigint, text) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.record_manual_search_index_failure(bigint, text) FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE public.manual_search_index_pending FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.begin_manual_search_index_append(bigint, integer) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.append_manual_search_index_chunks(bigint, uuid, integer, text[], boolean[], integer[]) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.finish_manual_search_index_append(bigint, uuid) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.abort_manual_search_index_append(bigint, uuid) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.manual_search_index_failures FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.manuals_missing_search_index(integer, bigint) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.record_manual_search_index_attempt(bigint, text) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.record_manual_search_index_failure(bigint, text) FROM authenticated';
    EXECUTE 'REVOKE ALL ON TABLE public.manual_search_index_pending FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.begin_manual_search_index_append(bigint, integer) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.append_manual_search_index_chunks(bigint, uuid, integer, text[], boolean[], integer[]) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.finish_manual_search_index_append(bigint, uuid) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.abort_manual_search_index_append(bigint, uuid) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.manual_search_index_failures TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.manuals_missing_search_index(integer, bigint) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.record_manual_search_index_attempt(bigint, text) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.record_manual_search_index_failure(bigint, text) TO service_role';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.manual_search_index_pending TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.begin_manual_search_index_append(bigint, integer) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.append_manual_search_index_chunks(bigint, uuid, integer, text[], boolean[], integer[]) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.finish_manual_search_index_append(bigint, uuid) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.abort_manual_search_index_append(bigint, uuid) TO service_role';
  END IF;
END
$grant$;

NOTIFY pgrst, 'reload schema';
