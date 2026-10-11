/**
 * Backfill manuals.chapter_metadata page_count and page_start for folder rows.
 *
 * Each chapter PDF is counted with pdf.js (document.numPages). That is the same
 * count the search indexer writes. Files are walked in chapter_metadata array
 * order, and an exact duplicate path is counted once. page_start is the joined
 * index page of that file. A row is updated when the sum of those counts
 * equals max [[pdfpage:N]] in manual_search_index, or when the index is known
 * to be clipped and the sum is still at least that max (pages before the clip
 * use the same offsets). A sum below the index max is skipped. An unclipped
 * sum above the max is skipped.
 *
 * Dry-run is the default. Nothing is written unless --apply is passed.
 * Do not run --apply against production unless you intend to update
 * chapter_metadata. This script does not reindex and does not deploy.
 *
 * Usage (from web/):
 *   node scripts/backfill-chapter-page-counts.mjs
 *   node scripts/backfill-chapter-page-counts.mjs --counts /path/counts.json
 *   node scripts/backfill-chapter-page-counts.mjs --apply
 *
 * Replay a pdf.js measurement without downloading. This path cannot --apply:
 *   node scripts/backfill-chapter-page-counts.mjs \
 *     --counts /path/counts.json \
 *     --index-max /path/index-max.json
 *
 * Live reads need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * counts.json is the CEO measurement: files[].pi is the pdf.js page count,
 * files[].pr is the retired cleartext /Count parser, files[].p is the storage path.
 * --index-max is a JSON array of { id, max_page, clipped?, chars? }.
 * clipped true, or chars >= 1499000, accepts a row whose pdf.js sum is above
 * max_page. An explicit clipped false does not. Live reads detect the clip
 * from manual_search_index.index_clipped, or from search_text length when
 * that column is not there yet.
 */

import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

/** Same threshold as 20261011_000912_manual_search_index_clip.sql. */
export const INDEX_CLIPPED_CHAR_LENGTH = 1_499_000;

globalThis.pdfjsWorker ??= pdfjsWorker;

function clipPath(value) {
  return String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/[?#].*$/, '');
}

export function maxStampPage(text) {
  let max = 0;
  for (const match of String(text || '').matchAll(/\[\[pdfpage:(\d{1,4})\]\]/g)) {
    const n = Number(match[1]);
    if (n > max) max = n;
  }
  return max || null;
}

/** Unique PDF paths in metadata array order, with an optional stored count. */
export function chapterPdfPaths(metadata) {
  if (!Array.isArray(metadata)) return [];
  const out = [];
  const seen = new Set();
  for (const item of metadata) {
    if (!item || typeof item !== 'object') continue;
    const path = clipPath(item.storage_path || item.path || '');
    if (!path || !/\.pdf$/i.test(path) || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/**
 * @param {unknown[]} metadata
 * @param {Array<{ path: string, pageCount: number }>} counts
 */
export function metadataWithPageCounts(metadata, counts) {
  const known = new Map();
  for (const part of counts) {
    const key = clipPath(part.path);
    if (!key || known.has(key)) continue;
    if (!Number.isFinite(part.pageCount) || part.pageCount < 0) continue;
    known.set(key, Math.floor(part.pageCount));
  }
  let next = 1;
  const start = new Map();
  for (const [path, pageCount] of known) {
    if (pageCount < 1) continue;
    start.set(path, next);
    next += pageCount;
  }
  return metadata.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const key = clipPath(item.storage_path || item.path || '');
    if (!known.has(key)) return item;
    const pageCount = known.get(key);
    const copy = { ...item, page_count: pageCount };
    if (start.has(key)) copy.page_start = start.get(key);
    else delete copy.page_start;
    return copy;
  });
}

/**
 * Explicit index_clipped wins. When the column is absent, a stored text at
 * the 1,500,000-character slice (Postgres char_length can be a few code
 * points under that) is the pre-marker clip.
 * @param {unknown} text
 * @param {unknown} columnFlag
 */
export function indexRowClipped(text, columnFlag) {
  if (columnFlag === true) return true;
  if (columnFlag === false) return false;
  return String(text || '').length >= INDEX_CLIPPED_CHAR_LENGTH;
}

/**
 * @returns {'match' | 'clipped' | 'mismatch' | 'skipped'}
 */
export function backfillStatus(opts) {
  const { pageSum, maxPage, countedFiles, expectedFiles, clipped } = opts;
  if (expectedFiles != null && countedFiles !== expectedFiles) return 'skipped';
  if (maxPage == null || countedFiles < 1 || pageSum == null) return 'skipped';
  if (pageSum < maxPage) return 'mismatch';
  if (pageSum === maxPage) return 'match';
  if (clipped) return 'clipped';
  return 'mismatch';
}

/** match and clipped both write chapter_metadata. mismatch and skipped do not. */
export function backfillWrites(status) {
  return status === 'match' || status === 'clipped';
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return '';
  return process.argv[index + 1] || '';
}

function loadCountsFile(file) {
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  const byId = new Map();
  for (const row of rows) {
    byId.set(Number(row.id), row);
  }
  return byId;
}

function replayClipped(row) {
  if (row.clipped === true) return true;
  if (row.clipped === false) return false;
  const chars = row.chars == null ? null : Number(row.chars);
  return chars != null && chars >= INDEX_CLIPPED_CHAR_LENGTH;
}

function loadIndexMax(file) {
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  const byId = new Map();
  for (const row of rows) {
    byId.set(Number(row.id), {
      maxPage: row.max_page == null ? null : Number(row.max_page),
      clipped: replayClipped(row),
    });
  }
  return byId;
}

async function countPdfJsPages(bytes) {
  const task = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    return doc.numPages || 0;
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

async function supabaseFetch(url, key, path, init) {
  const res = await fetch(`${url.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status} ${path} ${detail.slice(0, 180)}`);
  }
  return res;
}

function printRow(row) {
  const countsNote = row.countsSum == null ? '-' : String(row.countsSum);
  const parserNote = row.parserSum == null ? '-' : String(row.parserSum);
  console.log(
    [
      String(row.id).padStart(4),
      row.status.toUpperCase().padEnd(9),
      `files ${String(row.files).padStart(3)}`,
      `pdf.js ${String(row.pageSum ?? '-').padStart(5)}`,
      `index ${String(row.maxPage ?? '-').padStart(5)}`,
      `counts.json ${countsNote.padStart(5)}`,
      `parser ${parserNote.padStart(5)}`,
      row.note || '',
    ].join('  '),
  );
}

async function replay(countsFile, indexMaxFile) {
  const counts = loadCountsFile(countsFile);
  const maxes = loadIndexMax(indexMaxFile);
  const ids = [...counts.keys()].sort((a, b) => a - b);
  const report = [];
  for (const id of ids) {
    const row = counts.get(id);
    const files = Array.isArray(row.files) ? row.files : [];
    let pageSum = 0;
    let parserSum = 0;
    let parserKnown = true;
    let missingPi = 0;
    for (const file of files) {
      if (file.pi == null) missingPi += 1;
      else pageSum += Number(file.pi);
      if (file.pr == null || file.pr === 'ERR') parserKnown = false;
      else parserSum += Number(file.pr);
    }
    const bound = maxes.has(id) ? maxes.get(id) : null;
    const maxPage = bound ? bound.maxPage : null;
    const clipped = bound ? bound.clipped : false;
    const status = missingPi
      ? 'skipped'
      : backfillStatus({
          pageSum,
          maxPage,
          countedFiles: files.length,
          expectedFiles: files.length,
          clipped,
        });
    const note = [
      missingPi ? `${missingPi} files without pi` : '',
      status === 'clipped' ? 'clipped index; pages before the clip still line up' : '',
      parserKnown && parserSum !== pageSum ? `cleartext parser sum ${parserSum}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    const line = {
      id,
      status,
      files: files.length,
      pageSum: missingPi ? null : pageSum,
      maxPage,
      countsSum: missingPi ? null : pageSum,
      parserSum: parserKnown ? parserSum : null,
      note,
    };
    report.push(line);
    printRow(line);
  }
  return report;
}

async function live(countsFile, apply) {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --counts and --index-max for a replay.');
  }
  const counts = countsFile ? loadCountsFile(countsFile) : null;
  const manualsRes = await supabaseFetch(
    url,
    key,
    '/rest/v1/manuals?is_folder=eq.true&select=id,chapter_metadata,storage_path&order=id.asc',
    { headers: { Accept: 'application/json' } },
  );
  const manuals = await manualsRes.json();
  const ids = manuals.map((row) => Number(row.id)).filter((id) => id > 0);
  const indexRows = await loadIndexRows(url, key, ids);
  const indexes = new Map();
  for (const row of indexRows) {
    const text = String(row.search_text || '');
    indexes.set(Number(row.manual_id), {
      text,
      clipped: indexRowClipped(text, row.index_clipped),
    });
  }

  const report = [];
  for (const manual of manuals) {
    const id = Number(manual.id);
    const paths = chapterPdfPaths(manual.chapter_metadata);
    const measured = counts?.get(id);
    const measuredByPath = new Map((measured?.files || []).map((file) => [clipPath(file.p), file]));
    const fileCounts = [];
    let failed = '';
    for (const path of paths) {
      try {
        const encoded = path.split('/').map(encodeURIComponent).join('/');
        const res = await supabaseFetch(url, key, `/storage/v1/object/manuals/${encoded}`, {});
        const bytes = new Uint8Array(await res.arrayBuffer());
        const pageCount = await countPdfJsPages(bytes);
        fileCounts.push({ path, pageCount });
      } catch (err) {
        failed = err instanceof Error ? err.message : 'download failed';
        break;
      }
    }
    const pageSum = failed ? null : fileCounts.reduce((sum, part) => sum + part.pageCount, 0);
    const index = indexes.get(id);
    const maxPage = maxStampPage(index?.text || '');
    const clipped = index ? index.clipped : false;
    let countsSum = null;
    let parserSum = null;
    let parserKnown = true;
    if (measured?.files) {
      countsSum = 0;
      parserSum = 0;
      for (const file of measured.files) {
        if (file.pi == null) countsSum = null;
        else if (countsSum != null) countsSum += Number(file.pi);
        if (file.pr == null || file.pr === 'ERR') parserKnown = false;
        else parserSum += Number(file.pr);
      }
      if (!parserKnown) parserSum = null;
    }
    const differ = [];
    if (!failed && measured) {
      for (const part of fileCounts) {
        const prior = measuredByPath.get(clipPath(part.path));
        if (prior && prior.pi != null && Number(prior.pi) !== part.pageCount) {
          differ.push(`${part.path} pdf.js ${part.pageCount} counts.json ${prior.pi}`);
        }
      }
    }
    const status = failed
      ? 'skipped'
      : backfillStatus({
          pageSum,
          maxPage,
          countedFiles: fileCounts.length,
          expectedFiles: paths.length,
          clipped,
        });
    const note = [
      failed,
      status === 'clipped' ? 'clipped index; pages before the clip still line up' : '',
      differ.length ? `${differ.length} files differ from counts.json` : '',
    ].filter(Boolean).join('; ');
    const line = { id, status, files: paths.length, pageSum, maxPage, countsSum, parserSum, note };
    report.push(line);
    printRow(line);
    if (apply && backfillWrites(status)) {
      const next = metadataWithPageCounts(manual.chapter_metadata, fileCounts);
      const patch = await supabaseFetch(url, key, `/rest/v1/manuals?id=eq.${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ chapter_metadata: next }),
      });
      await patch.text().catch(() => '');
      console.log(`  wrote manual ${id}`);
    }
  }
  return report;
}

async function loadIndexRows(url, key, ids) {
  const wide = `/rest/v1/manual_search_index?select=manual_id,search_text,index_clipped,indexed_page_max&manual_id=in.(${ids.join(',')})`;
  try {
    const res = await supabaseFetch(url, key, wide, { headers: { Accept: 'application/json' } });
    return await res.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (!/index_clipped|indexed_page_max|column/i.test(message)) throw err;
    const narrow = `/rest/v1/manual_search_index?select=manual_id,search_text&manual_id=in.(${ids.join(',')})`;
    const res = await supabaseFetch(url, key, narrow, { headers: { Accept: 'application/json' } });
    return await res.json();
  }
}

function summarize(report) {
  const tally = { match: 0, clipped: 0, mismatch: 0, skipped: 0 };
  for (const row of report) tally[row.status] += 1;
  console.log(
    `rows ${report.length}  match ${tally.match}  clipped ${tally.clipped}  mismatch ${tally.mismatch}  skipped ${tally.skipped}`,
  );
  if (!process.argv.includes('--apply')) console.log('dry-run: no chapter_metadata was written');
}

async function main() {
  const apply = process.argv.includes('--apply');
  const countsFile = argValue('--counts');
  const indexMaxFile = argValue('--index-max');
  if (apply && indexMaxFile) {
    console.error('--apply counts the PDFs with pdf.js. A --index-max replay cannot write.');
    process.exit(1);
  }
  const report = indexMaxFile
    ? await replay(countsFile, indexMaxFile)
    : await live(countsFile, apply);
  summarize(report);
}

const isMain = process.argv[1] && process.argv[1].endsWith('backfill-chapter-page-counts.mjs');
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
