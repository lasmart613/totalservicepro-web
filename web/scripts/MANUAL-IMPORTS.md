# Manual imports: index every new manual

`public.manuals` rows are only searchable (library body search, the repair
assistant's excerpts) once `public.manual_search_index` has a row for them.
Inserting a catalog row does **not** index it. Bulk imports between Sep 28 and
Oct 16, 2026 (ids 1168+) were never indexed because nothing ran the indexer.

Two layers now cover this:

1. **The import flow indexes what it inserts (required).**
2. **A scheduled catch-up** (`web/netlify/functions/manual-index-catchup.mts`,
   every 15 minutes, up to 5 manuals per run) indexes any published manual
   with a PDF in Storage and no index row. It is a safety net, not the plan.
   See "Scheduled catch-up" below.

## After inserting manuals

Upload the PDF to the `manuals` bucket **before** inserting the row. Then,
from `web/` with Node 22 and the service-role key in the environment:

```sh
# REST inserts: right after each insert returns its id
node scripts/index-missing-manuals.mjs --apply --ids=1794

# SQL inserts (execute_sql / psql) cannot call the indexer. At the end of
# the flow, index the ids the INSERT ... RETURNING id gave back:
node scripts/index-missing-manuals.mjs --apply --ids-file=inserted_ids.json --report=index_report.json
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must be set. Without `--apply`
the script is a read-only dry run.

The write is expect-empty: a manual that already has index rows is skipped and
reported as `already_indexed`, never overwritten. Re-running is safe.

### Chunked writes (migration 000918)

PostgREST runs as `authenticator`, which has an 8 s `statement_timeout`.
Writing a large, text-dense manual in one `replace_manual_search_index` call
can exceed it (ids 1195 and 1210 did on Oct 16, 2026), so with 000918
applied both this script and the scheduled catch-up write in pieces:

1. `begin_manual_search_index_append(id, total_chunks)` creates a marker row
   in `public.manual_search_index_pending` and returns a token. It returns
   `already_indexed` if the manual has rows and no marker, and `busy` if
   another writer holds a marker younger than 10 minutes. An older marker is
   treated as a crashed write: its partial rows are deleted and it is taken
   over.
2. `append_manual_search_index_chunks(id, token, expected_rows, ...)` inserts
   about 200k characters per call. It writes only if the token matches and
   the manual has exactly `expected_rows` rows, so a duplicate or out-of-order
   call writes nothing. A call that hits the statement timeout is retried
   (twice).
3. `finish_manual_search_index_append(id, token)` checks the row count equals
   `total_chunks` and deletes the marker. Only then is the manual indexed.
4. On any failure, `abort_manual_search_index_append(id, token)` deletes the
   partial rows and the marker. If the abort itself fails, the skip reason
   says so, and the stale-marker takeover cleans up later.

While the marker exists the manual counts as **not indexed** everywhere:
`search_manual_catalog`, library body search, `get-manual-url` page bounds,
the repair assistant's excerpts, and `manuals_missing_search_index` (it
reports these as `in_progress`). A God → Manuals reindex
(`replace_manual_search_index`) replaces the rows and clears the marker.

Without 000918 the script falls back to the single
`replace_manual_search_index` call (`p_expected_md5 NULL`).

The edge functions `get-manual-url` and `grok-assistant` read the marker.
Deploy them after applying 000918; until then they treat a missing marker
table as "nothing in progress".

Check the last line of output:

- `indexed`: manuals that got searchable text.
- `emptyText`: image-only PDFs. They get one empty row, so they are not
  retried. OCR the PDF and reindex from God → Manuals if search matters.
- `failed`: nothing was written (pdf.js error, over the size limit, missing
  file). The scheduled catch-up retries with backoff; fix the file if it
  keeps failing.

Exit code 2 means at least one manual failed.

## Paths that already index

- God → Manuals "Add catalog row" (`POST /api/god/manuals`) indexes the row
  it creates.
- God → Manuals "Index PDF text" (`POST /api/god/manuals/reindex`) indexes
  published rows with no index row, 4 per request.

## Scheduled catch-up

Needs migration 000918 applied (without it the function logs
`missing read failed` and writes nothing).

- Each run makes one RPC (`manuals_missing_search_index`) and stops there when
  nothing is missing.
- Up to 5 manuals per run, and no new manual is started after 18 s (Netlify
  stops scheduled functions at 30 s).
- **Before** extracting a manual it calls
  `record_manual_search_index_attempt`, which bumps `attempts` and sets
  `retry_after` (15 min, doubling, capped at 24 h) in
  `public.manual_search_index_failures`. A run killed mid-extraction (timeout,
  out of memory) therefore still backs that manual off. Success deletes the
  row; a failure stores the reason in `last_error`. A row whose `last_error`
  is `attempt started; no result recorded (timeout or crash?)` means the
  function died on that manual.
- Manuals whose PDF bytes in Storage exceed 20 MiB (summed for folders) are
  never picked. Each run logs them (`manual-index-catchup-oversized`, up to 20
  ids). Index them with the script above.
- A file whose Storage size is missing or not a number is never treated as
  small: the manual is not picked and is logged as `unknown_size`
  (`manual-index-catchup-unknown-size`). Check the object's metadata, then
  index it with the script.
- Published manuals with no file in Storage are counted and logged as
  `no_file` (`manual-index-catchup-no-file`). Upload the PDF or fix
  `storage_path`; the catch-up picks them up after that.
- Deleted Storage files (archived versions, delete markers) count as absent.
- Manuals with a chunked write in progress (`in_progress`) are skipped until
  the marker is 10 minutes old.

### Rollout: clear the backlog with the script first

At 5 manuals per run the catch-up would need days to work through a large
backlog (609 manuals on Oct 16, 2026, 27 of them over 20 MiB). Clear it with
the #306 backfill first:

```sh
node scripts/index-missing-manuals.mjs            # dry run: counts and sizes
node scripts/index-missing-manuals.mjs --apply    # writes; expect-empty, safe to re-run
```

Until that finishes, keep `MANUAL_INDEX_CATCHUP_DISABLED=1` set in the Netlify
environment (Functions scope). The function then logs `disabled` and does
nothing. Unset it (and redeploy, or wait for the next deploy) once the dry run
reports nothing missing except files that keep failing.
