/**
 * Server-only: extract PDF text from the manuals Storage bucket and upsert
 * public.manual_search_index. Do not import from client components.
 */

import {
  clipManualSearchText,
  extractPdfPageSlice,
  extractPdfSearchText,
  looksLikePdf,
  MANUAL_SEARCH_PDF_MAX_BYTES,
  PDF_INDEX_TEXT_MAX,
  stampPdfPages,
  type PdfPageText,
} from './manual-pdf-text.ts';

export const MANUALS_BUCKET = 'manuals';
export const MANUAL_REINDEX_BATCH = 4;
export const MANUAL_INDEX_FILE_CAP = 24;

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

type StorageClient = {
  from: (bucket: string) => {
    download: (path: string) => Promise<{ data: Blob | null; error: { message?: string } | null }>;
    list: (
      path?: string,
      options?: { limit?: number; offset?: number }
    ) => Promise<{ data: Array<{ name: string; id?: string | null }> | null; error: { message?: string } | null }>;
  };
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
  if (chapters.length) return [...new Set(chapters)].slice(0, MANUAL_INDEX_FILE_CAP);
  const path = clipPath(manual.storage_path);
  if (path && /\.pdf$/i.test(path)) return [path];
  return path ? [] : [];
}

export function folderPrefixForManual(manual: ManualIndexRow): string | null {
  const path = clipPath(manual.storage_path);
  if (!path) return null;
  if (/\.pdf$/i.test(path)) return null;
  if (truthyFlag(manual.is_folder) || !/\.[a-z0-9]+$/i.test(path)) return path.replace(/\/+$/, '');
  return null;
}

async function listPdfPaths(storage: StorageClient, prefix: string, depth = 0): Promise<string[]> {
  const { data, error } = await storage.from(MANUALS_BUCKET).list(prefix, { limit: 80, offset: 0 });
  if (error || !data) return [];
  const out: string[] = [];
  for (const obj of data) {
    const name = String(obj.name || '').trim();
    if (!name || name === '.emptyFolderPlaceholder') continue;
    const full = `${prefix}/${name}`.replace(/\/{2,}/g, '/');
    if (/\.pdf$/i.test(name)) {
      out.push(full);
    } else if (depth < 1 && !obj.id) {
      const nested = await listPdfPaths(storage, full, depth + 1);
      out.push(...nested);
    }
    if (out.length >= MANUAL_INDEX_FILE_CAP) break;
  }
  return out.slice(0, MANUAL_INDEX_FILE_CAP);
}

async function downloadPdfBytes(storage: StorageClient, path: string): Promise<Uint8Array | null> {
  const { data, error } = await storage.from(MANUALS_BUCKET).download(path);
  if (error || !data) return null;
  const buf = new Uint8Array(await data.arrayBuffer());
  if (buf.byteLength > MANUAL_SEARCH_PDF_MAX_BYTES) return buf.subarray(0, MANUAL_SEARCH_PDF_MAX_BYTES);
  return buf;
}

export async function extractManualBodyText(
  storage: StorageClient,
  manual: ManualIndexRow
): Promise<{ text: string; files: number; skipped?: string }> {
  let paths = pdfPathsForManual(manual);
  const folder = folderPrefixForManual(manual);
  if (!paths.length && folder) {
    paths = await listPdfPaths(storage, folder);
  }
  if (!paths.length) {
    return { text: '', files: 0, skipped: 'no_pdf_path' };
  }

  const chunks: string[] = [];
  let files = 0;
  for (const path of paths) {
    const bytes = await downloadPdfBytes(storage, path);
    if (!bytes || !looksLikePdf(bytes)) continue;
    const text = extractPdfSearchText(bytes);
    if (text) {
      chunks.push(text);
      files += 1;
    }
  }
  if (!files) return { text: '', files: 0, skipped: 'no_extractable_text' };
  return { text: chunks.join('\n'), files };
}

/**
 * Keep a richer existing index row. The in-app FlateDecode extractor can
 * return empty or much shorter text than a prior good extraction and must
 * not wipe it. A comparable or longer extraction still replaces the row.
 */
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
    map.set(page, String(update.text || '').replace(/\s+/g, ' ').trim());
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

/**
 * Rewrite one manuals.id search row from physical PDF pages.
 * Bypasses shouldKeepExistingSearchText. Does not attach a Grok collection.
 * Call again with nextPage until done. pageCount is capped at 40.
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

  let paths = pdfPathsForManual(manual);
  const entry = clipPath(manual.entry_file_path);
  if (!paths.length && entry && /\.pdf$/i.test(entry)) paths = [entry];
  const folder = folderPrefixForManual(manual);
  if (!paths.length && folder) paths = await listPdfPaths(client.storage, folder);
  if (!paths.length) return empty('no_pdf_path');

  const path = paths[0];
  const bytes = await downloadPdfBytes(client.storage, path);
  if (!bytes || !looksLikePdf(bytes)) return empty('no_pdf');

  const sliced = extractPdfPageSlice(bytes, { from: pageFrom, count: pageCount });
  if (!sliced.total) return empty('no_pages');
  const existing = await readExistingSearchText(client, catalogId);
  const merged = mergeStampedManualPages(existing, sliced.pages, sliced.total);
  const saved = await upsertManualSearchIndex(client, catalogId, merged);
  if (!saved.ok) return { ...empty(saved.error || 'upsert failed'), path, totalPages: sliced.total };
  const pageTo = sliced.pages.length ? sliced.pages[sliced.pages.length - 1].page : Math.min(sliced.total, pageFrom + pageCount - 1);
  const next = pageFrom + pageCount;
  const done = next > sliced.total;
  return {
    ok: true,
    manualId,
    pageFrom,
    pageTo,
    totalPages: sliced.total,
    nextPage: done ? null : next,
    done,
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
  return prev.length >= 500 && next.length * 2 < prev.length;
}

async function readExistingSearchText(db: TableClient, manualId: number): Promise<string> {
  try {
    const { data, error } = await db
      .from('manual_search_index')
      .select('search_text')
      .eq('manual_id', manualId)
      .maybeSingle();
    if (error || !data?.search_text) return '';
    return String(data.search_text);
  } catch {
    return '';
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
  const existingText = await readExistingSearchText(client, catalogId);
  if (shouldKeepExistingSearchText(existingText, extracted.text || '')) {
    return {
      manualId,
      ok: true,
      chars: existingText.trim().length,
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
