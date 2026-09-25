/**
 * Server-only: extract PDF text from the manuals Storage bucket and upsert
 * public.manual_search_index. Do not import from client components.
 */

import {
  clipManualSearchText,
  extractPdfPageSlice,
  looksLikePdf,
  manualPdfByteLimitError,
  PDF_INDEX_TEXT_MAX,
  singleLetterTokenRatio,
  stampPdfPages,
  type PdfPageText,
} from './manual-pdf-text.ts';

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

export async function extractManualBodyText(
  storage: StorageClient,
  manual: ManualIndexRow
): Promise<{ text: string; files: number; skipped?: string; fatal?: string }> {
  const paths = await resolveManualPdfPaths(storage, manual);
  if (!paths.length) {
    return { text: '', files: 0, skipped: 'no_pdf_path' };
  }

  const chunks: string[] = [];
  let files = 0;
  let pageOffset = 0;
  for (const path of paths) {
    const got = await downloadPdfBytes(storage, path);
    if (got.error) return { text: '', files, fatal: got.error };
    if (!got.bytes) continue;
    try {
      const sliced = await extractPdfPageSlice(got.bytes);
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
      return { text: '', files, fatal: message };
    }
  }
  if (!files) return { text: '', files: 0, skipped: 'no_extractable_text' };
  return { text: clipManualSearchText(chunks.join('\f'), PDF_INDEX_TEXT_MAX), files };
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
  return clipManualSearchText(stampPdfPages(pages), PDF_INDEX_TEXT_MAX);
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

/**
 * Build the stamped row from a finished stage. A blank new page keeps text
 * the existing row already has for that physical page.
 */
export function assembleReindexedManual(
  staged: Map<number, string>,
  totalPages: number,
  existing: string
): string {
  const prev = stampedPageMap(existing);
  let total = Math.max(0, Math.floor(Number(totalPages) || 0));
  for (const page of prev.keys()) if (page > total) total = page;
  for (const page of staged.keys()) if (page > total) total = page;
  if (!total) return '';
  const pages: PdfPageText[] = [];
  for (let page = 1; page <= total; page++) {
    const fresh = (staged.get(page) || '').trim();
    const old = (prev.get(page) || '').trim();
    pages.push({ page, text: fresh || old });
  }
  return clipManualSearchText(stampPdfPages(pages), PDF_INDEX_TEXT_MAX);
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
 * Chunks are staged in the manuals bucket and the search row is written once,
 * after every page has been extracted. A lower-quality result is refused.
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
  const merged = assembleReindexedManual(map, sliced.total, existing.text);
  const refusal = searchTextWriteRefusal(existing.text, merged);
  if (refusal) return { ...empty(refusal), path, totalPages: sliced.total, chars: merged.length };
  const saved = await upsertManualSearchIndex(client, catalogId, merged);
  if (!saved.ok) return { ...empty(saved.error || 'upsert failed'), path, totalPages: sliced.total };
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
    chars: merged.length,
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

type ExistingSearchRead = { ok: true; text: string } | { ok: false; error: string };

function existingRowReadError(detail: string): ExistingSearchRead {
  const message = detail.trim() || 'read failed';
  return {
    ok: false,
    error: `Refused to replace the manual index: could not read the existing row (${message}).`,
  };
}

/** Fail closed: a read error must not look like an empty row that can be overwritten. */
async function readExistingSearchText(db: TableClient, manualId: number): Promise<ExistingSearchRead> {
  try {
    const { data, error } = await db
      .from('manual_search_index')
      .select('search_text')
      .eq('manual_id', manualId)
      .maybeSingle();
    if (error) return existingRowReadError(error.message || 'read failed');
    return { ok: true, text: data?.search_text ? String(data.search_text) : '' };
  } catch (err) {
    return existingRowReadError(err instanceof Error ? err.message : 'read failed');
  }
}

export async function upsertManualSearchIndex(
  db: TableClient,
  manualId: string | number,
  searchText: string
): Promise<{ ok: boolean; error?: string }> {
  const id = asManualCatalogId(manualId);
  if (id == null) return { ok: false, error: 'manual_id must be a bigint catalog id' };
  const payload = {
    manual_id: id,
    search_text: searchText,
    indexed_at: new Date().toISOString(),
  };
  const { error } = await db.from('manual_search_index').upsert(payload, { onConflict: 'manual_id' });
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
  const saved = await upsertManualSearchIndex(client, catalogId, extracted.text || '');
  if (!extracted.text) {
    return { manualId, ok: false, chars: 0, files: extracted.files, skipped: extracted.skipped || saved.error };
  }
  if (!saved.ok) {
    return { manualId, ok: false, chars: extracted.text.length, files: extracted.files, skipped: saved.error };
  }
  return { manualId, ok: true, chars: extracted.text.length, files: extracted.files };
}

export function escapeIlike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}

/**
 * Find catalog ids whose indexed PDF body contains every token.
 * Selects only manual_id — never returns search_text to the client.
 */
export async function findManualIdsByBodyText(
  db: TableClient,
  tokens: string[]
): Promise<{ ids: string[]; available: boolean; error?: string }> {
  const clean = tokens.map((t) => t.trim()).filter((t) => t.length >= 2);
  if (!clean.length) return { ids: [], available: true };

  const fts = clean.join(' ');
  const viaFts = await db
    .from('manual_search_index')
    .select('manual_id')
    .textSearch('search_tsv', fts, { type: 'plain', config: 'simple' });
  if (!viaFts.error) {
    const ids: string[] = [];
    for (const row of viaFts.data || []) {
      const id = String((row as { manual_id?: unknown })?.manual_id || '').trim();
      if (id) ids.push(id);
    }
    return { ids: [...new Set(ids)], available: true };
  }

  // Column / table missing (migration not applied) or textSearch unavailable.
  if (/schema cache|does not exist|column|relation/i.test(viaFts.error.message || '')) {
    return { ids: [], available: false, error: viaFts.error.message };
  }

  let ilike = db.from('manual_search_index').select('manual_id');
  for (const token of clean) {
    ilike = ilike.ilike('search_text', `%${escapeIlike(token)}%`);
  }
  const viaLike = await ilike;
  if (viaLike.error) {
    if (/schema cache|does not exist|column|relation/i.test(viaLike.error.message || '')) {
      return { ids: [], available: false, error: viaLike.error.message };
    }
    return { ids: [], available: false, error: viaLike.error.message };
  }
  const ids: string[] = [];
  for (const row of viaLike.data || []) {
    const id = String((row as { manual_id?: unknown })?.manual_id || '').trim();
    if (id) ids.push(id);
  }
  return { ids: [...new Set(ids)], available: true };
}
