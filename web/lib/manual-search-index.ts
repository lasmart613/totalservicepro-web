/**
 * Server-only: extract PDF text from the manuals Storage bucket and upsert
 * public.manual_search_index. Do not import from client components.
 */

import { extractPdfSearchText, looksLikePdf, MANUAL_SEARCH_PDF_MAX_BYTES } from './manual-pdf-text.ts';

export const MANUALS_BUCKET = 'manuals';
export const MANUAL_REINDEX_BATCH = 4;
export const MANUAL_INDEX_FILE_CAP = 24;

export type ManualIndexRow = {
  id?: string | number | null;
  storage_path?: string | null;
  is_folder?: unknown;
  chapter_metadata?: unknown;
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

function clipPath(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^\/+/, '')
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
