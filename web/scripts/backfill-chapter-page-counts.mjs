/**
 * Backfill manuals.chapter_metadata page_count and page_start for folder rows.
 *
 * Each chapter PDF is counted with pdf.js (document.numPages). That is the same
 * count the search indexer writes. Files are walked in chapter_metadata array
 * order, and an exact duplicate path is counted once. page_start is the joined
 * index page of that file. A row is updated only when the sum of those counts
 * equals max [[pdfpage:N]] in manual_search_index. Any other row is skipped.
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
 * --index-max is a JSON array of { id, max_page }.
 */

import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

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
 * @returns {'match' | 'mismatch' | 'skipped'}
 */
export function backfillStatus(opts) {
  const { pageSum, maxPage, countedFiles, expectedFiles } = opts;
  if (expectedFiles != null && countedFiles !== expectedFiles) return 'skipped';
  if (maxPage == null || countedFiles < 1 || pageSum == null) return 'skipped';
  if (pageSum !== maxPage) return 'mismatch';
  return 'match';
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

function loadIndexMax(file) {
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  const byId = new Map();
  for (const row of rows) byId.set(Number(row.id), row.max_page == null ? null : Number(row.max_page));
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
    const maxPage = maxes.has(id) ? maxes.get(id) : null;
    const status = missingPi
      ? 'skipped'
      : backfillStatus({
          pageSum,
          maxPage,
          countedFiles: files.length,
          expectedFiles: files.length,
        });
    const note = [
      missingPi ? `${missingPi} files without pi` : '',
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
  const indexRes = await supabaseFetch(
    url,
    key,
    `/rest/v1/manual_search_index?select=manual_id,search_text&manual_id=in.(${ids.join(',')})`,
    { headers: { Accept: 'application/json' } },
  );
  const indexes = new Map();
  for (const row of await indexRes.json()) indexes.set(Number(row.manual_id), String(row.search_text || ''));

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
    const maxPage = maxStampPage(indexes.get(id) || '');
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
        });
    const note = [failed, differ.length ? `${differ.length} files differ from counts.json` : ''].filter(Boolean).join('; ');
    const line = { id, status, files: paths.length, pageSum, maxPage, countsSum, parserSum, note };
    report.push(line);
    printRow(line);
    if (apply && status === 'match') {
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

function summarize(report) {
  const tally = { match: 0, mismatch: 0, skipped: 0 };
  for (const row of report) tally[row.status] += 1;
  console.log(`rows ${report.length}  match ${tally.match}  mismatch ${tally.mismatch}  skipped ${tally.skipped}`);
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
