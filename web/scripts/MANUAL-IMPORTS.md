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

The write is expect-empty (`replace_manual_search_index` with
`p_expected_md5 NULL`): a manual that already has index rows is skipped and
reported as `already_indexed`, never overwritten. Re-running is safe.

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
