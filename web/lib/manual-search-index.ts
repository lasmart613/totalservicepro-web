/**
 * Server-only: extract PDF text from the manuals Storage bucket and upsert
 * public.manual_search_index. Do not import from client components.
 */

import { createHash } from 'node:crypto';
import {
  chunkIndexText,
  extractPdfPageSlice,
  joinIndexChunks,
  looksLikePdf,
  manualPdfByteLimitError,
  singleLetterTokenRatio,
  stampPdfPages,
  summarizeIndexChunks,
  type IndexChunk,
  type PdfPageText,
  type StoredIndexText,
} from './manual-pdf-text.ts';
import { containsTextImatch } from './email-match.ts';
import { chapterMetadataWithPageCounts } from './manual-page-map.ts';
import { isMissingColumn, isPublishedColumnMissing } from './manual-published.ts';

export const MANUALS_BUCKET = 'manuals';
export const MANUAL_REINDEX_BATCH = 4;

export { manualPdfByteLimitError };

export type ManualIndexRow = {
  id?: string | number | null;
  storage_path?: string | null;
  is_folder?: unknown;
  chapter_metadata?: unknown;
  entry_file_path?: string | null;
};

export type ManualIndexResult = {
  manualId: string;
  ok: boolean;
  chars: number;
  files: number;
  skipped?: string;
};

/** Live public.manuals.id is bigint, not uuid. */
export function asManualCatalogId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  const s = String(value ?? '').trim();
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

type StorageObject = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  text?: () => Promise<string>;
  size?: number;
};

type StorageBucket = {
  download: (path: string) => Promise<{ data: StorageObject | null; error: { message?: string } | null }>;
  list: (
    path?: string,
    options?: { limit?: number; offset?: number }
  ) => Promise<{ data: Array<{ name: string; id?: string | null }> | null; error: { message?: string } | null }>;
  upload?: (
    path: string,
    body: string,
    options?: { upsert?: boolean; contentType?: string }
  ) => Promise<{ error: { message?: string } | null }>;
  remove?: (paths: string[]) => Promise<{ error: { message?: string } | null }>;
};

type StorageClient = {
  from: (bucket: string) => StorageBucket;
};

type TableClient = {
  from: (table: string) => any;
  rpc?: (fn: string, args: Record<string, unknown>) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

function truthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 't';
}

/** Storage object keys are case-sensitive. Do not fold case — mixed-case PDFs (Xeo 105) 404. */
function clipPath(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/[?#].*$/, '');
}

export function chapterPathsFromMetadata(meta: unknown): string[] {
  if (!Array.isArray(meta)) return [];
  const out: string[] = [];
  for (const item of meta) {
    if (!item || typeof item !== 'object') continue;
    const path = clipPath((item as { storage_path?: unknown }).storage_path);
    if (path && /\.pdf$/i.test(path)) out.push(path);
  }
  return out;
}

export function pdfPathsForManual(manual: ManualIndexRow): string[] {
  const chapters = chapterPathsFromMetadata(manual.chapter_metadata);
  if (chapters.length) return [...new Set(chapters)];
  const path = clipPath(manual.storage_path);
  if (path && /\.pdf$/i.test(path)) return [path];
  return path ? [] : [];
}

/** Numeric so chapter "2" sorts before "10". Path bytes stay unchanged. */
function compareStoragePath(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'variant' });
}

export function folderPrefixForManual(manual: ManualIndexRow): string | null {
  const path = clipPath(manual.storage_path);
  if (!path) return null;
  if (/\.pdf$/i.test(path)) return null;
  if (truthyFlag(manual.is_folder) || !/\.[a-z0-9]+$/i.test(path)) return path.replace(/\/+$/, '');
  return null;
}

async function listPdfPaths(storage: StorageClient, prefix: string, depth = 0): Promise<string[]> {
  const out: string[] = [];
  const folders: string[] = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const { data, error } = await storage.from(MANUALS_BUCKET).list(prefix, { limit, offset });
    if (error || !data?.length) break;
    for (const obj of data) {
      const name = String(obj.name || '').trim();
      if (!name || name === '.emptyFolderPlaceholder') continue;
      const full = `${prefix}/${name}`.replace(/\/{2,}/g, '/');
      if (/\.pdf$/i.test(name)) out.push(full);
      else if (depth < 4 && !obj.id) folders.push(full);
    }
    if (data.length < limit) break;
    offset += data.length;
  }
  for (const folder of folders) {
    out.push(...(await listPdfPaths(storage, folder, depth + 1)));
  }
  return depth === 0 ? out.sort(compareStoragePath) : out;
}

type PdfDownload = { bytes?: Uint8Array; error?: string };

async function downloadPdfBytes(storage: StorageClient, path: string): Promise<PdfDownload> {
  const { data, error } = await storage.from(MANUALS_BUCKET).download(path);
  if (error || !data) return {};
  if (typeof data.size === 'number') {
    const reported = manualPdfByteLimitError(data.size);
    if (reported) return { error: reported };
  }
  const buf = new Uint8Array(await data.arrayBuffer());
  const tooBig = manualPdfByteLimitError(buf.byteLength);
  if (tooBig) return { error: tooBig };
  if (!looksLikePdf(buf)) return {};
  return { bytes: buf };
}

/**
 * Chapter metadata order when present, otherwise every PDF under a folder
 * (natural path order), otherwise entry_file_path. A folder is never reduced
 * to its first file.
 */
async function resolveManualPdfPaths(storage: StorageClient, manual: ManualIndexRow): Promise<string[]> {
  const listed = pdfPathsForManual(manual);
  if (listed.length) return listed;
  const folder = folderPrefixForManual(manual);
  if (folder) {
    const nested = await listPdfPaths(storage, folder);
    if (nested.length) return nested;
  }
  const entry = clipPath(manual.entry_file_path);
  if (entry && /\.pdf$/i.test(entry)) return [entry];
  return [];
}

export type IndexedPdfPart = { path: string; pageCount: number };

export async function extractManualBodyText(
  storage: StorageClient,
  manual: ManualIndexRow
): Promise<{
  text: string;
  files: number;
  fileCounts: IndexedPdfPart[];
  clip?: StoredIndexText;
  chunks?: IndexChunk[];
  skipped?: string;
  fatal?: string;
}> {
  const paths = await resolveManualPdfPaths(storage, manual);
  if (!paths.length) {
    return { text: '', files: 0, fileCounts: [], skipped: 'no_pdf_path' };
  }

  const chunks: string[] = [];
  const fileCounts: IndexedPdfPart[] = [];
  let files = 0;
  let pageOffset = 0;
  for (const path of paths) {
    const got = await downloadPdfBytes(storage, path);
    if (got.error) return { text: '', files, fileCounts, fatal: got.error };
    if (!got.bytes) continue;
    try {
      const sliced = await extractPdfPageSlice(got.bytes);
      fileCounts.push({ path, pageCount: sliced.total });
      if (!sliced.total) continue;
      const shifted = sliced.pages.map((page) => ({ page: page.page + pageOffset, text: page.text }));
      pageOffset += sliced.total;
      const text = stampPdfPages(shifted);
      if (text) {
        chunks.push(text);
        files += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not extract PDF text.';
      return { text: '', files, fileCounts, fatal: message };
    }
  }
  if (!files) return { text: '', files: 0, fileCounts, skipped: 'no_extractable_text' };
  const storedChunks = chunkIndexText(chunks.join('\f'));
  const stored = summarizeIndexChunks(storedChunks);
  return { text: stored.text, files, fileCounts, clip: stored, chunks: storedChunks };
}

/** Store pdf.js page_count and page_start on the folder's chapter_metadata. */
async function persistChapterPageCounts(
  client: TableClient,
  manual: ManualIndexRow,
  fileCounts: readonly IndexedPdfPart[],
): Promise<void> {
  const next = chapterMetadataWithPageCounts(
    manual.chapter_metadata,
    fileCounts.map((part) => ({ storagePath: part.path, pageCount: part.pageCount })),
  );
  const id = asManualCatalogId(manual.id);
  if (!next || id == null) return;
  const table = client.from('manuals');
  if (!table || typeof table.update !== 'function') return;
  const updated = await table.update({ chapter_metadata: next }).eq('id', id);
  if (updated?.error) {
    console.warn('chapter page counts not stored', updated.error.message || updated.error);
  }
}

/** Replace one physical-page slice inside a stamped index. Unstamped text is dropped. */
export function mergeStampedManualPages(
  existing: string,
  updates: Array<Pick<PdfPageText, 'page' | 'text'>>,
  totalPages?: number
): string {
  const map = new Map<number, string>();
  for (const part of String(existing || '').split('\f')) {
    const match = part.match(/\[\[pdfpage:(\d{1,4})\]\]\s*([\s\S]*)$/);
    if (!match) continue;
    const page = Number(match[1]);
    if (page >= 1) map.set(page, match[2].trim());
  }
  for (const update of updates) {
    const page = Math.floor(Number(update?.page));
    if (!Number.isFinite(page) || page < 1) continue;
    const text = String(update.text || '').replace(/\s+/g, ' ').trim();
    const prev = map.get(page) || '';
    if (!text && prev) continue;
    map.set(page, text);
  }
  let max = 0;
  for (const page of map.keys()) if (page > max) max = page;
  const total = Math.floor(Number(totalPages) || 0);
  if (total > max) max = total;
  if (!max) return '';
  const pages: PdfPageText[] = [];
  for (let page = 1; page <= max; page++) pages.push({ page, text: map.get(page) || '' });
  return joinIndexChunks(chunkIndexText(stampPdfPages(pages)));
}

export type ManualPageReindexResult = {
  ok: boolean;
  manualId: string;
  pageFrom: number;
  pageTo: number;
  totalPages: number;
  nextPage: number | null;
  done: boolean;
  chars: number;
  path?: string;
  error?: string;
};

/** JSON object in the manuals bucket. Not a PDF, so folder listing will not index it. */
export function manualReindexStagePath(manualId: number): string {
  return `manual-index-staging/${manualId}.json`;
}

type StagePart = { path: string; pages: number };

type ReindexStage = {
  manualId: number;
  totalPages: number;
  path?: string;
  parts?: StagePart[];
  pages: Record<string, string>;
  /** md5 of the joined index when this reindex started at page 1. Null when there was no row. */
  expectedMd5?: string | null;
};

function stagePageMap(stage: ReindexStage | null): Map<number, string> {
  const map = new Map<number, string>();
  for (const [key, value] of Object.entries(stage?.pages || {})) {
    const page = Number(key);
    if (page >= 1) map.set(page, String(value || ''));
  }
  return map;
}

function stampedPageMap(existing: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const part of String(existing || '').split('\f')) {
    const match = part.match(/\[\[pdfpage:(\d{1,4})\]\]\s*([\s\S]*)$/);
    if (!match) continue;
    const page = Number(match[1]);
    if (page >= 1) map.set(page, match[2].trim());
  }
  return map;
}

export type AssembledIndex = StoredIndexText & { chunks: IndexChunk[] };

/**
 * Build the stamped index from a finished stage. A blank new page keeps text
 * the existing row already has for that physical page. Pages already in the
 * index past totalPages are not carried forward: a reindex that started at
 * page 1 must not merge an old tail back in (manual 72 stored 519 stamps for
 * a 517-page PDF). A staged page past totalPages still extends the total.
 * Text past 1,500,000 characters is split on page boundaries. Stamps stay
 * continuous. `clipped` is true only when a single page was sliced.
 */
export function assembleReindexedManualStored(
  staged: Map<number, string>,
  totalPages: number,
  existing: string
): AssembledIndex {
  const prev = stampedPageMap(existing);
  let total = Math.max(0, Math.floor(Number(totalPages) || 0));
  for (const page of staged.keys()) if (page > total) total = page;
  if (!total) return { text: '', clipped: false, indexedPageMax: null, chunks: [] };
  const pages: PdfPageText[] = [];
  for (let page = 1; page <= total; page++) {
    const fresh = (staged.get(page) || '').trim();
    const old = (prev.get(page) || '').trim();
    pages.push({ page, text: fresh || old });
  }
  const chunks = chunkIndexText(stampPdfPages(pages));
  return { ...summarizeIndexChunks(chunks), chunks };
}

export function assembleReindexedManual(
  staged: Map<number, string>,
  totalPages: number,
  existing: string
): string {
  return assembleReindexedManualStored(staged, totalPages, existing).text;
}

const DICTIONARY_WORDS = new Set(
  `a an the and or of to in on for with from by at as is are was were be been being it its this that these those
if then than not no yes you your we our they their he she his her can may will shall must should would could
into over under after before between out up down off about each only also such using used use when where what
which who how new old all any some more most same page section figure table note warning caution error laser
power high low reset check replace connection module service manual calibration procedure voltage current board
sensor temperature cooling optical beam fiber handpiece energy pulse mode system install remove connect
disconnect measure adjust align clean filter pump lamp shutter interlock display software firmware cable
connector fuse supply ground safety patient treatment wavelength spot water flow reservoir collimator
troubleshooting thermopile assembly circuit inspect overview sample search term`.split(/\s+/).filter(Boolean)
);

function isDictionaryLikeToken(token: string): boolean {
  const word = token.toLowerCase().replace(/'/g, '');
  if (!word) return false;
  if (DICTIONARY_WORDS.has(word)) return true;
  if (!/^[a-z][a-z-]{2,23}$/.test(word)) return false;
  if (!/[aeiouy]/.test(word)) return false;
  if (/[^aeiouy]{5,}/.test(word)) return false;
  if (/(.)\1{3,}/.test(word)) return false;
  return true;
}

function isGarbageToken(token: string): boolean {
  if (isDictionaryLikeToken(token)) return false;
  if (token.length >= 24) return true;
  if (/(.)\1{3,}/i.test(token)) return true;
  const letters = token.replace(/[^A-Za-z]/g, '');
  const alnum = token.replace(/[^A-Za-z0-9]/g, '');
  if (letters.length >= 4 && !/[aeiouy]/i.test(letters)) return true;
  if (token.length >= 3 && alnum.length * 2 < token.length) return true;
  return false;
}

/** Ratio of dictionary-like words and of garbage tokens. Empty text is all garbage. */
export function manualTextQuality(text: string): { dictionaryRatio: number; garbageRatio: number } {
  const tokens = String(text || '')
    .replace(/\[\[pdfpage:\d+\]\]/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ''))
    .filter(Boolean);
  if (!tokens.length) return { dictionaryRatio: 0, garbageRatio: 1 };
  let dictionary = 0;
  let garbage = 0;
  for (const token of tokens) {
    if (isDictionaryLikeToken(token)) dictionary += 1;
    else if (isGarbageToken(token)) garbage += 1;
  }
  return { dictionaryRatio: dictionary / tokens.length, garbageRatio: garbage / tokens.length };
}

/**
 * Shorter OCR text is allowed when it is cleaner than the row it would replace:
 * a higher dictionary-word ratio or a lower garbage ratio, without a drop in
 * dictionary ratio. A shorter extract of the same quality is still refused so a
 * partial read cannot wipe a full index.
 */
export function extractQualityImproves(existing: string, incoming: string): boolean {
  const prev = manualTextQuality(existing);
  const next = manualTextQuality(incoming);
  if (next.dictionaryRatio + 0.02 < prev.dictionaryRatio) return false;
  const dictUp = next.dictionaryRatio > prev.dictionaryRatio + 0.02;
  const garbageDown = next.garbageRatio < prev.garbageRatio - 0.02;
  return dictUp || garbageDown;
}

/**
 * Refuse an empty, lower-quality, or letter-spaced replacement.
 * A shorter row is written when extractQualityImproves says the new text is cleaner.
 * Returns a clear error, or null when the row may be written.
 */
export function searchTextWriteRefusal(existing: string, incoming: string): string | null {
  const next = String(incoming || '').trim();
  const prev = String(existing || '').trim();
  const nextBody = next.replace(/\[\[pdfpage:\d+\]\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!nextBody) return 'Refused to replace the manual index: extracted text is empty.';
  if (prev.length >= 500 && next.length < prev.length * 0.8 && !extractQualityImproves(prev, next)) {
    return 'Refused to replace the manual index: shorter result does not have a higher dictionary-word ratio or a lower garbage ratio than the existing row.';
  }
  const nextRatio = singleLetterTokenRatio(next);
  const prevRatio = prev ? singleLetterTokenRatio(prev) : 0;
  if (nextRatio > 0.25 && nextRatio > prevRatio + 0.05) {
    return 'Refused to replace the manual index: too many single-letter tokens to replace the existing row.';
  }
  return null;
}

function applyPageUpdates(map: Map<number, string>, updates: PdfPageText[]): void {
  for (const update of updates) {
    const page = Math.floor(Number(update?.page));
    if (!Number.isFinite(page) || page < 1) continue;
    const text = String(update.text || '').replace(/\s+/g, ' ').trim();
    const prev = map.get(page) || '';
    if (!text && prev) continue;
    map.set(page, text);
  }
}

function missingStagePages(map: Map<number, string>, totalPages: number): number[] {
  const missing: number[] = [];
  for (let page = 1; page <= totalPages; page++) {
    if (!map.has(page)) missing.push(page);
  }
  return missing;
}

async function readReindexStage(storage: StorageClient, manualId: number): Promise<ReindexStage | null> {
  const { data, error } = await storage.from(MANUALS_BUCKET).download(manualReindexStagePath(manualId));
  if (error || !data) return null;
  try {
    const raw = typeof data.text === 'function'
      ? await data.text()
      : Buffer.from(await data.arrayBuffer()).toString('utf8');
    const parsed = JSON.parse(raw) as ReindexStage;
    if (!parsed || typeof parsed !== 'object' || !parsed.pages) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeReindexStage(storage: StorageClient, stage: ReindexStage): Promise<string | null> {
  const bucket = storage.from(MANUALS_BUCKET);
  if (typeof bucket.upload !== 'function') return 'staging_unavailable';
  const { error } = await bucket.upload(manualReindexStagePath(stage.manualId), JSON.stringify(stage), {
    upsert: true,
    contentType: 'application/json',
  });
  return error ? error.message || 'staging_write_failed' : null;
}

/**
 * Physical pages across every PDF of a manual, in path order.
 * Stamps are global: the second file continues where the first file stopped.
 * `known` is the part list stored on the first chunk so later chunks do not
 * renumber if the folder listing shifts.
 */
async function extractManualPageSlice(
  storage: StorageClient,
  paths: string[],
  from: number,
  count: number,
  known: StagePart[] | null
): Promise<{ total: number; pages: PdfPageText[]; parts: StagePart[]; path: string; error?: string }> {
  const to = from + count - 1;
  const empty = (path: string, error: string, total = 0, parts: StagePart[] = []): {
    total: number;
    pages: PdfPageText[];
    parts: StagePart[];
    path: string;
    error: string;
  } => ({ total, pages: [], parts, path, error });

  if (known?.length) {
    const parts = known;
    const total = parts.reduce((sum, part) => sum + Math.max(0, part.pages), 0);
    const pages: PdfPageText[] = [];
    let cursor = 1;
    for (const part of parts) {
      const start = cursor;
      const end = cursor + part.pages - 1;
      cursor = end + 1;
      if (part.pages < 1 || end < from || start > to) continue;
      const got = await downloadPdfBytes(storage, part.path);
      if (got.error) return empty(part.path, got.error, total, parts);
      if (!got.bytes) return empty(part.path, 'no_pdf', total, parts);
      const localFrom = Math.max(from, start) - start + 1;
      const localTo = Math.min(to, end) - start + 1;
      try {
        const sliced = await extractPdfPageSlice(got.bytes, { from: localFrom, count: localTo - localFrom + 1 });
        if (sliced.total !== part.pages) {
          return empty(part.path, 'Refused to write a partial index: staged page count does not match this PDF.', sliced.total, parts);
        }
        for (const page of sliced.pages) pages.push({ page: start + page.page - 1, text: page.text });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not extract PDF text.';
        return empty(part.path, message, total, parts);
      }
    }
    return { total, pages, parts, path: parts[0]?.path || '' };
  }

  const parts: StagePart[] = [];
  const pages: PdfPageText[] = [];
  let total = 0;
  for (const path of paths) {
    const got = await downloadPdfBytes(storage, path);
    if (got.error) return empty(path, got.error, total, parts);
    if (!got.bytes) continue;
    const start = total + 1;
    const localFrom = start > to ? 1 : Math.max(1, from - start + 1);
    const localCount = start > to ? 0 : to - Math.max(from, start) + 1;
    try {
      const sliced = await extractPdfPageSlice(got.bytes, { from: localFrom, count: localCount });
      parts.push({ path, pages: sliced.total });
      for (const page of sliced.pages) pages.push({ page: start + page.page - 1, text: page.text });
      total += sliced.total;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not extract PDF text.';
      return empty(path, message, total, parts);
    }
  }
  if (!parts.length) return empty(paths[0] || '', 'no_pdf');
  return { total, pages, parts, path: parts[0].path };
}

/**
 * Rewrite one manuals.id search row from physical PDF pages.
 * Folder manuals concatenate every PDF; stamps continue across files.
 * Pages are staged in the manuals bucket and the search rows are written once,
 * after every page has been extracted. Text past 1,500,000 characters is
 * stored as chunk_index 0, 1, ... with continuous [[pdfpage:N]] stamps.
 * The first call (page 1) records md5 of the joined index. The final write
 * calls replace_manual_search_index, which locks that manual and refuses
 * the write when the stored md5 changed. A lower-quality result is refused.
 * Does not attach a collection. Call again with nextPage until done. pageCount is capped at 40.
 */
export async function reindexManualPageRange(
  client: TableClient & { storage: StorageClient },
  manual: ManualIndexRow,
  opts?: { pageFrom?: number; pageCount?: number }
): Promise<ManualPageReindexResult> {
  const catalogId = asManualCatalogId(manual.id);
  const manualId = catalogId == null ? '' : String(catalogId);
  const pageFrom = Math.max(1, Math.floor(Number(opts?.pageFrom) || 1));
  const pageCount = Math.min(40, Math.max(1, Math.floor(Number(opts?.pageCount) || 40)));
  const empty = (error: string): ManualPageReindexResult => ({
    ok: false,
    manualId,
    pageFrom,
    pageTo: 0,
    totalPages: 0,
    nextPage: null,
    done: false,
    chars: 0,
    error,
  });
  if (catalogId == null) return empty('missing_id');

  let stage: ReindexStage | null = null;
  if (pageFrom > 1) {
    stage = await readReindexStage(client.storage, catalogId);
    if (!stage) return empty('Refused to write a partial index: staging data for earlier pages is missing.');
  }
  let expectedMd5: string | null | undefined;
  if (pageFrom === 1) {
    const prior = await readExistingSearchText(client, catalogId);
    if (!prior.ok) return empty(prior.error);
    expectedMd5 = prior.md5;
  } else if (stage && Object.prototype.hasOwnProperty.call(stage, 'expectedMd5')) {
    expectedMd5 = stage.expectedMd5 ?? null;
  }
  const known = pageFrom > 1 && stage?.parts?.length ? stage.parts : null;
  const paths = known ? known.map((part) => part.path) : await resolveManualPdfPaths(client.storage, manual);
  if (!paths.length) return empty('no_pdf_path');

  const sliced = await extractManualPageSlice(client.storage, paths, pageFrom, pageCount, known);
  const path = sliced.path;
  if (sliced.error) return { ...empty(sliced.error), path, totalPages: sliced.total };
  if (!sliced.total) return { ...empty('no_pages'), path };
  if (pageFrom > 1 && stage?.totalPages && stage.totalPages !== sliced.total) {
    return { ...empty('Refused to write a partial index: staged page count does not match this PDF.'), path, totalPages: sliced.total };
  }
  const pageTo = sliced.pages.length
    ? sliced.pages[sliced.pages.length - 1].page
    : Math.min(sliced.total, pageFrom + pageCount - 1);

  const map = pageFrom === 1 ? new Map<number, string>() : stagePageMap(stage);
  applyPageUpdates(map, sliced.pages);
  const pages: Record<string, string> = {};
  let stagedChars = 0;
  for (const [page, text] of map) {
    pages[String(page)] = text;
    stagedChars += text.length;
  }
  const nextStage: ReindexStage = {
    manualId: catalogId,
    totalPages: sliced.total,
    path,
    parts: sliced.parts,
    pages,
    ...(expectedMd5 !== undefined ? { expectedMd5 } : {}),
  };
  const stagedError = await writeReindexStage(client.storage, nextStage);
  if (stagedError) return { ...empty(stagedError), path, totalPages: sliced.total };

  const missing = missingStagePages(map, sliced.total);
  if (missing.length) {
    return {
      ok: true,
      manualId,
      pageFrom,
      pageTo,
      totalPages: sliced.total,
      nextPage: missing[0],
      done: false,
      chars: stagedChars,
      path,
    };
  }

  const existing = await readExistingSearchText(client, catalogId);
  if (!existing.ok) return { ...empty(existing.error), path, totalPages: sliced.total };
  const merged = assembleReindexedManualStored(map, sliced.total, existing.text);
  const refusal = searchTextWriteRefusal(existing.text, merged.text);
  if (refusal) return { ...empty(refusal), path, totalPages: sliced.total, chars: merged.text.length };
  const guardMd5 = expectedMd5 !== undefined ? expectedMd5 : existing.md5;
  const saved = await writeManualSearchIndex(client, catalogId, merged.chunks, guardMd5);
  if (!saved.ok) return { ...empty(saved.error || 'upsert failed'), path, totalPages: sliced.total };
  await persistChapterPageCounts(
    client,
    manual,
    sliced.parts.map((part) => ({ path: part.path, pageCount: part.pages })),
  );
  const bucket = client.storage.from(MANUALS_BUCKET);
  if (typeof bucket.remove === 'function') {
    await bucket.remove([manualReindexStagePath(catalogId)]).catch(() => undefined);
  }
  return {
    ok: true,
    manualId,
    pageFrom,
    pageTo,
    totalPages: sliced.total,
    nextPage: null,
    done: true,
    chars: merged.text.length,
    path,
  };
}

export function shouldKeepExistingSearchText(
  existing: string | null | undefined,
  incoming: string | null | undefined
): boolean {
  const prev = String(existing || '').trim();
  const next = String(incoming || '').trim();
  if (!prev) return false;
  if (!next) return true;
  return searchTextWriteRefusal(prev, next) != null;
}

type ExistingSearchRead =
  | { ok: true; text: string; chunks: string[]; md5: string | null }
  | { ok: false; error: string };

/** md5 of chunk texts joined with a form feed. No rows is null, matching string_agg of zero rows. */
export function indexTextMd5(chunks: readonly string[]): string | null {
  if (!chunks.length) return null;
  return createHash('md5').update(chunks.join('\f'), 'utf8').digest('hex');
}

function existingRowReadError(detail: string): ExistingSearchRead {
  const message = detail.trim() || 'read failed';
  return {
    ok: false,
    error: `Refused to replace the manual index: could not read the existing row (${message}).`,
  };
}

function chunksFromIndexRows(rows: Array<{ search_text?: unknown; chunk_index?: unknown }>): string[] {
  return [...rows]
    .sort((a, b) => (Number(a.chunk_index) || 0) - (Number(b.chunk_index) || 0))
    .map((row) => (row?.search_text == null ? '' : String(row.search_text)));
}

/** Fail closed: a read error must not look like an empty row that can be overwritten. */
async function readExistingSearchText(db: TableClient, manualId: number): Promise<ExistingSearchRead> {
  try {
    const wide = db.from('manual_search_index').select('search_text,chunk_index').eq('manual_id', manualId);
    if (wide && typeof wide.order === 'function') {
      const ordered = await wide.order('chunk_index', { ascending: true });
      if (!ordered?.error && Array.isArray(ordered.data)) {
        const chunks = chunksFromIndexRows(ordered.data);
        return { ok: true, chunks, text: chunks.join('\f'), md5: indexTextMd5(chunks) };
      }
      if (ordered?.error && !isMissingColumn(ordered.error, 'chunk_index')) {
        return existingRowReadError(String(ordered.error.message || 'read failed'));
      }
    }
    const { data, error } = await db
      .from('manual_search_index')
      .select('search_text')
      .eq('manual_id', manualId)
      .maybeSingle();
    if (error) return existingRowReadError(error.message || 'read failed');
    if (!data) return { ok: true, chunks: [], text: '', md5: null };
    const text = data.search_text == null ? '' : String(data.search_text);
    return { ok: true, chunks: [text], text, md5: indexTextMd5([text]) };
  } catch (err) {
    return existingRowReadError(err instanceof Error ? err.message : 'read failed');
  }
}

function rpcFunctionMissing(message: string): boolean {
  return /replace_manual_search_index/i.test(message)
    && /schema cache|does not exist|could not find the function|not found/i.test(message);
}

/**
 * Replace every chunk of one manual. Uses replace_manual_search_index when
 * that function exists so the md5 check, delete, and insert are one transaction.
 * A missing function still writes a single chunk. Several chunks are not
 * clipped into the old one-row column.
 */
export async function writeManualSearchIndex(
  db: TableClient,
  manualId: string | number,
  chunks: readonly IndexChunk[],
  expectedMd5: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const id = asManualCatalogId(manualId);
  if (id == null) return { ok: false, error: 'manual_id must be a bigint catalog id' };
  const rows = chunks.length
    ? chunks
    : [{ chunkIndex: 0, text: '', clipped: false, indexedPageMax: null }];
  if (typeof db.rpc === 'function') {
    const rpc = await db.rpc('replace_manual_search_index', {
      p_manual_id: id,
      p_chunks: rows.map((row) => row.text),
      p_clipped: rows.map((row) => row.clipped === true),
      p_page_max: rows.map((row) => (row.indexedPageMax == null ? null : row.indexedPageMax)),
      p_expected_md5: expectedMd5,
    });
    if (!rpc?.error) {
      if (rpc?.data === false) {
        return {
          ok: false,
          error: 'Refused to replace the manual index: stored text changed during reindex (md5).',
        };
      }
      return { ok: true };
    }
    const message = String(rpc.error.message || '');
    if (!rpcFunctionMissing(message)) return { ok: false, error: message || 'replace failed' };
  }
  if (rows.length > 1) {
    return {
      ok: false,
      error:
        'Refused to clip the manual index: replace_manual_search_index is unavailable, so text past 1,500,000 characters was not written.',
    };
  }
  return upsertManualSearchIndex(db, id, rows[0].text, rows[0], rows[0].chunkIndex);
}

export async function upsertManualSearchIndex(
  db: TableClient,
  manualId: string | number,
  searchText: string,
  clip?: StoredIndexText | null,
  chunkIndex = 0,
): Promise<{ ok: boolean; error?: string }> {
  const id = asManualCatalogId(manualId);
  if (id == null) return { ok: false, error: 'manual_id must be a bigint catalog id' };
  const indexedAt = new Date().toISOString();
  const full: Record<string, unknown> = {
    manual_id: id,
    chunk_index: Math.max(0, Math.floor(Number(chunkIndex) || 0)),
    search_text: searchText,
    indexed_at: indexedAt,
    index_clipped: clip?.clipped === true,
    indexed_page_max: clip?.indexedPageMax ?? null,
  };
  let onConflict = 'manual_id,chunk_index';
  let payload = { ...full };
  let result = await db.from('manual_search_index').upsert(payload, { onConflict });
  let error = result?.error;
  if (error && isMissingColumn(error, 'chunk_index')) {
    const { chunk_index: _chunk, ...rest } = full;
    payload = { ...rest };
    onConflict = 'manual_id';
    result = await db.from('manual_search_index').upsert(payload, { onConflict });
    error = result?.error;
  }
  if (error && /index_clipped|indexed_page_max/i.test(String(error.message || ''))) {
    const { index_clipped: _clipped, indexed_page_max: _max, ...rest } = payload;
    payload = { ...rest };
    result = await db.from('manual_search_index').upsert(payload, { onConflict });
    error = result?.error;
  }
  if (error) return { ok: false, error: error.message || 'upsert failed' };
  return { ok: true };
}

export async function indexManualSearchText(
  client: TableClient & { storage: StorageClient },
  manual: ManualIndexRow
): Promise<ManualIndexResult> {
  const catalogId = asManualCatalogId(manual.id);
  const manualId = catalogId == null ? '' : String(catalogId);
  if (catalogId == null) return { manualId: '', ok: false, chars: 0, files: 0, skipped: 'missing_id' };
  const extracted = await extractManualBodyText(client.storage, manual);
  if (extracted.fatal) {
    return { manualId, ok: false, chars: 0, files: extracted.files, skipped: extracted.fatal };
  }
  const existing = await readExistingSearchText(client, catalogId);
  if (!existing.ok) {
    return { manualId, ok: false, chars: 0, files: extracted.files, skipped: existing.error };
  }
  if (shouldKeepExistingSearchText(existing.text, extracted.text || '')) {
    return {
      manualId,
      ok: true,
      chars: existing.text.trim().length,
      files: extracted.files,
      skipped: 'kept_existing_index',
    };
  }
  const chunks = extracted.chunks?.length
    ? extracted.chunks
    : [{ chunkIndex: 0, text: extracted.text || '', clipped: false, indexedPageMax: null }];
  const saved = await writeManualSearchIndex(client, catalogId, chunks, existing.md5);
  if (!extracted.text) {
    return { manualId, ok: false, chars: 0, files: extracted.files, skipped: extracted.skipped || saved.error };
  }
  if (!saved.ok) {
    return { manualId, ok: false, chars: extracted.text.length, files: extracted.files, skipped: saved.error };
  }
  await persistChapterPageCounts(client, manual, extracted.fileCounts);
  return { manualId, ok: true, chars: extracted.text.length, files: extracted.files };
}

/**
 * Escapes `%`, `_`, and `\` for a PostgreSQL ILIKE pattern.
 * This does not stop PostgREST from rewriting `*` to `%`. Contains-search of
 * user text uses `containsTextImatch` with `imatch` instead.
 */
export function escapeIlike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}

/**
 * Part-number-like words from the raw query: a digit plus at least one inner
 * hyphen, e.g. `7111-00-2709`, `8501-00-1800`, `DP35-0643-906`.
 * The `simple` parser stores these as `7111`, `-00`, `-2709` (signed ints),
 * so splitting them at the hyphens can never match the index.
 */
export function manualPartNumberTokens(raw: unknown): string[] {
  const out: string[] = [];
  for (const word of String(raw ?? '').split(/\s+/)) {
    const token = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (token.length < 5 || token.length > 64) continue;
    if (!/\d/.test(token)) continue;
    if (!/^[\p{L}\p{N}]+(?:[-][\p{L}\p{N}]+)+$/u.test(token)) continue;
    if (!out.includes(token)) out.push(token);
  }
  return out.slice(0, 4);
}

/**
 * to_tsquery text for the trailing all-digit groups of each part number:
 * `7111-00-2709` → `'-00' & '-2709'`. Empty when no trailing group is all
 * digits (letter codes keep the token path).
 */
export function partNumberNarrowQuery(partNumbers: string[]): string {
  const lexemes: string[] = [];
  for (const token of partNumbers) {
    const groups = token.split('-').slice(1);
    for (const group of groups) {
      if (!/^\d{1,12}$/.test(group)) continue;
      const lexeme = `'-${group}'`;
      if (!lexemes.includes(lexeme)) lexemes.push(lexeme);
    }
  }
  return lexemes.join(' & ');
}

/**
 * Postgres regex for a part number standing on its own: not glued to another
 * letter or digit on either side, so `7111-00-2709` does not hit
 * `17111-00-27091`. Case-insensitive through imatch.
 */
export function exactPartNumberImatch(token: string): string {
  return `(^|[^[:alnum:]])${containsTextImatch(token)}($|[^[:alnum:]])`;
}

function idsFromRows(rows: unknown): string[] {
  const ids: string[] = [];
  for (const row of (Array.isArray(rows) ? rows : []) as Array<{ manual_id?: unknown }>) {
    const id = String(row?.manual_id || '').trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Find catalog ids whose indexed PDF body contains every token.
 * Selects only manual_id — never returns search_text to the client.
 *
 * rawQuery is the sanitized user text before tokenizing. When it holds a
 * part number, the raw text goes to plainto_tsquery('simple', ...) — the same
 * parser that built search_tsv — so `7111-00-2709` becomes
 * `'7111' & '-00' & '-2709'` and matches. (websearch_to_tsquery would make
 * that a phrase `<->` query, which misses rows where pdftotext split the
 * number.) If FTS still finds nothing, each part number is matched literally
 * in search_text (case-insensitive, regex-escaped). Plain word queries keep
 * the existing token path. Every path drops unpublished manuals and reads all
 * chunk rows (000913), since each chunk is its own row.
 */
export async function findManualIdsByBodyText(
  db: TableClient,
  tokens: string[],
  rawQuery?: string
): Promise<{ ids: string[]; available: boolean; error?: string }> {
  const clean = tokens.map((t) => t.trim()).filter((t) => t.length >= 2);
  if (!clean.length) return { ids: [], available: true };

  const raw = String(rawQuery ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const partNumbers = raw ? manualPartNumberTokens(raw) : [];
  if (partNumbers.length) {
    const viaRaw = await db
      .from('manual_search_index')
      .select('manual_id')
      .textSearch('search_tsv', raw, { type: 'plain', config: 'simple' });
    if (!viaRaw.error) {
      const ids = idsFromRows(viaRaw.data);
      if (ids.length > 1) {
        // plainto_tsquery ANDs the groups ('7111' & '-00' & '-2709'), so a
        // manual with '-00' and the other groups scattered also matches.
        // When some manuals hold the number as written, show only those.
        let exact = db
          .from('manual_search_index')
          .select('manual_id')
          .textSearch('search_tsv', raw, { type: 'plain', config: 'simple' });
        for (const token of partNumbers) {
          exact = exact.filter('search_text', 'imatch', exactPartNumberImatch(token));
        }
        const viaExact = await exact;
        if (!viaExact.error) {
          const exactIds = await keepPublishedManualIds(db, idsFromRows(viaExact.data));
          if (exactIds.length) return { ids: exactIds, available: true };
        }
      }
      if (ids.length) return { ids: await keepPublishedManualIds(db, ids), available: true };

      // Literal fallback, narrowed by the GIN index first. A seq-scan regex
      // over every chunk takes ~7–9 s on live; with the tsquery in front it
      // is ~0.1 s. The trailing all-digit groups are always stored as signed
      // lexemes ('-00', '-2709') even when the first group is glued to a
      // prefix (`PN7111-00-2709` → 'pn7111').
      const narrow = partNumberNarrowQuery(partNumbers);
      if (narrow) {
        let literal = db
          .from('manual_search_index')
          .select('manual_id')
          .textSearch('search_tsv', narrow, { config: 'simple' });
        for (const token of partNumbers) {
          literal = literal.filter('search_text', 'imatch', containsTextImatch(token));
        }
        const viaLiteral = await literal;
        if (!viaLiteral.error) {
          const literalIds = idsFromRows(viaLiteral.data);
          if (literalIds.length) return { ids: await keepPublishedManualIds(db, literalIds), available: true };
        }
      }
    } else if (/schema cache|does not exist|column|relation/i.test(viaRaw.error.message || '')) {
      return { ids: [], available: false, error: viaRaw.error.message };
    }
    // Nothing for the part number: fall through to the token search below.
  }

  const fts = clean.join(' ');
  const viaFts = await db
    .from('manual_search_index')
    .select('manual_id')
    .textSearch('search_tsv', fts, { type: 'plain', config: 'simple' });
  if (!viaFts.error) {
    return { ids: await keepPublishedManualIds(db, idsFromRows(viaFts.data)), available: true };
  }

  // Column / table missing (migration not applied) or textSearch unavailable.
  if (/schema cache|does not exist|column|relation/i.test(viaFts.error.message || '')) {
    return { ids: [], available: false, error: viaFts.error.message };
  }

  let body = db.from('manual_search_index').select('manual_id');
  for (const token of clean) {
    body = body.filter('search_text', 'imatch', containsTextImatch(token));
  }
  const viaLike = await body;
  if (viaLike.error) {
    return { ids: [], available: false, error: viaLike.error.message };
  }
  return { ids: await keepPublishedManualIds(db, idsFromRows(viaLike.data)), available: true };
}

/** Drop ids whose manuals.published is false. A missing column keeps the ids. */
async function keepPublishedManualIds(db: TableClient, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const allowed = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const numeric = chunk.map((id) => Number(id)).filter((n) => Number.isFinite(n));
    const { data, error } = await db.from('manuals').select('id,published').in('id', numeric.length ? numeric : chunk);
    if (error) {
      if (isPublishedColumnMissing(error)) return ids;
      return [];
    }
    for (const row of data || []) {
      const rec = row as { id?: unknown; published?: unknown };
      if (rec.published === false) continue;
      const id = String(rec.id ?? '').trim();
      if (id) allowed.add(id);
    }
  }
  return ids.filter((id) => allowed.has(id));
}
