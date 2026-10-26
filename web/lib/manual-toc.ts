/**
 * Chapter navigation and table-of-contents links for the in-app manual viewer.
 *
 * Multi-file manuals (more than one chapter PDF) link each chapter tile to
 * that file. Single-PDF manuals link an extracted TOC, or the PDF outline
 * when extraction has no page targets. Missing data yields no links.
 */

import { MANUAL_VIEW_PATH } from './manuals.ts';

export type TocEntry = {
  title: string;
  /** 1-based page in the open PDF. */
  page: number;
  depth: number;
};

export type PdfOutlineItem = {
  title?: unknown;
  dest?: unknown;
  url?: unknown;
  items?: PdfOutlineItem[] | null;
};

/** Enough of pdf.js to turn an outline destination into a page. */
export type OutlinePageSource = {
  getDestination?: (name: string) => Promise<unknown> | unknown;
  getPageIndex?: (ref: unknown) => Promise<number> | number;
};

const MAX_TOC = 500;
const MAX_DEPTH = 12;

const NESTED_KEYS = ['items', 'children', 'toc', 'outline', 'bookmarks', 'entries'] as const;
const PAGE_KEYS = ['page', 'page_number', 'pageNumber', 'dest_page', 'printed_page', 'dest'] as const;

export function sameManualStoragePath(a?: string | null, b?: string | null): boolean {
  const norm = (value?: string | null) =>
    String(value || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
  const left = norm(a);
  return left !== '' && left === norm(b);
}

const DOC_NUMBER_KEYS = ['doc_number', 'docNumber', 'document_number'] as const;

/** "Section 12 — Water cooling" → 12. Other titles have no section number. */
export function sectionNumberFromTitle(title: unknown): number | null {
  const match = String(title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .match(/^Section\s+(\d+)\b/i);
  if (!match) return null;
  const section = Math.floor(Number(match[1]));
  return Number.isFinite(section) && section >= 1 ? section : null;
}

/**
 * Document number Scout stores beside the rewritten title.
 * Accepts doc_number, docNumber, and document_number.
 */
export function readChapterDocNumber(chapter: unknown): string | null {
  if (!chapter || typeof chapter !== 'object') return null;
  const rec = chapter as Record<string, unknown>;
  for (const key of DOC_NUMBER_KEYS) {
    const value = rec[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      const text = String(value).trim();
      if (text) return text.slice(0, 80);
    }
    if (typeof value !== 'string') continue;
    const text = value.replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 80);
  }
  return null;
}

export type ChapterCardCopy = {
  /** Main line. "Section N — <title>" for a Scout title, otherwise the stored title. */
  title: string;
  /** Small secondary text beside the page range. Null when Scout stored no document number. */
  docNumber: string | null;
};

/**
 * Chapter card text. A Scout title "Section N — <descriptive title>" stays in
 * that form. Any other title is shown as stored. The document number is
 * separate, and only present when metadata has one.
 */
export function chapterCardCopy(chapter: {
  title?: unknown;
  label?: unknown;
  storage_path?: unknown;
  doc_number?: unknown;
  docNumber?: unknown;
  document_number?: unknown;
} | null | undefined): ChapterCardCopy {
  const raw = String(chapter?.title || chapter?.label || chapter?.storage_path || '')
    .replace(/\s+/g, ' ')
    .trim();
  const docNumber = readChapterDocNumber(chapter);
  const match = raw.match(/^Section\s+(\d+)\s*[—–:-]\s+(\S.*)$/i);
  if (!match) return { title: raw, docNumber };
  const section = Math.floor(Number(match[1]));
  const descriptive = match[2].trim();
  if (!Number.isFinite(section) || section < 1 || !descriptive) return { title: raw, docNumber };
  return { title: `Section ${section} — ${descriptive}`, docNumber };
}

/** Joined page start used for reading order. Missing or non-numeric values sort last. */
export function chapterPageOrderKey(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const start = Math.floor(value);
    return start >= 1 ? start : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const start = Math.floor(Number(trimmed));
  return Number.isFinite(start) && start >= 1 ? start : null;
}

/**
 * Chapter list and Previous/Next order.
 * Joined page start wins, numerically, so 10 follows 9. A chapter with no page
 * sorts after every numbered page. Among those, "Section N" is the numeric key
 * (Section 10 follows Section 9). Equal keys and titles with neither keep
 * arrival order.
 */
export function chaptersInReadingOrder<T extends { pageStart?: unknown; title?: unknown }>(
  chapters: readonly T[] | null | undefined,
): T[] {
  if (!Array.isArray(chapters)) return [];
  if (chapters.length < 2) return [...chapters];
  return chapters
    .map((chapter, index) => ({
      chapter,
      index,
      page: chapterPageOrderKey(chapter?.pageStart),
      section: sectionNumberFromTitle(chapter?.title),
    }))
    .sort((a, b) => {
      if (a.page != null && b.page != null) {
        if (a.page !== b.page) return a.page - b.page;
        return a.index - b.index;
      }
      if (a.page != null) return -1;
      if (b.page != null) return 1;
      if (a.section != null && b.section != null) {
        if (a.section !== b.section) return a.section - b.section;
        return a.index - b.index;
      }
      if (a.section != null) return -1;
      if (b.section != null) return 1;
      return a.index - b.index;
    })
    .map((row) => row.chapter);
}

/**
 * Previous and next chapter in the order given.
 * Pass chaptersInReadingOrder so the ends follow page order.
 * index is -1 when this file is not in a multi-file list, and the missing
 * end is null so the viewer can hide that control.
 */
export function chapterNeighbors<T extends { storage_path?: string | null }>(
  chapters: readonly T[] | null | undefined,
  openPath: string | null | undefined,
): { index: number; previous: T | null; next: T | null } {
  if (!Array.isArray(chapters) || chapters.length < 2) {
    return { index: -1, previous: null, next: null };
  }
  const index = chapters.findIndex((chapter) => sameManualStoragePath(chapter?.storage_path, openPath));
  if (index < 0) return { index: -1, previous: null, next: null };
  return {
    index,
    previous: index > 0 ? chapters[index - 1] : null,
    next: index + 1 < chapters.length ? chapters[index + 1] : null,
  };
}

function queryId(id: string | number | null | undefined): string {
  if (id == null) return '';
  const text = String(id).trim();
  return text;
}

function queryTitle(title: string | null | undefined): string {
  return String(title || '').trim().slice(0, 160);
}

/**
 * Viewer URL for one open chapter.
 * Null when the path is empty or the location already names that chapter.
 * A chapter change drops the previous file's page. The landing entry can keep it.
 */
export function chapterHistoryUrl(
  currentHref: string,
  opts: {
    manualId?: string | number | null;
    storagePath?: string | null;
    /** New chapter title. Omit to leave the current title= parameter alone. */
    title?: string | null;
    keepPage?: boolean;
  },
): string | null {
  const storagePath = String(opts.storagePath || '').trim();
  if (!storagePath) return null;
  let url: URL;
  try {
    url = new URL(currentHref, 'http://localhost');
  } catch {
    return null;
  }
  const id = queryId(opts.manualId);
  if (id) url.searchParams.set('id', id);
  url.searchParams.set('storage_path', storagePath);
  if (opts.title !== undefined) {
    const title = queryTitle(opts.title);
    if (title) url.searchParams.set('title', title);
    else url.searchParams.delete('title');
  }
  if (!opts.keepPage) {
    url.searchParams.delete('page');
    url.hash = '';
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  let current: URL;
  try {
    current = new URL(currentHref, 'http://localhost');
  } catch {
    return next;
  }
  if (`${current.pathname}${current.search}${current.hash}` === next) return null;
  return next;
}

/** Opens one chapter file of a multi-file manual. Null when there is no path. */
export function manualChapterHref(opts: {
  id?: string | number | null;
  storagePath?: string | null;
  title?: string | null;
}): string | null {
  const storagePath = String(opts.storagePath || '').trim();
  if (!storagePath) return null;
  const qs = new URLSearchParams();
  const id = queryId(opts.id);
  if (id) qs.set('id', id);
  const title = queryTitle(opts.title);
  if (title) qs.set('title', title);
  qs.set('storage_path', storagePath);
  return `${MANUAL_VIEW_PATH}?${qs.toString()}`;
}

/**
 * Opens one page of a single PDF. The query is the viewer deep link; the
 * hash is the same page for a URL that is copied without the query.
 */
export function manualTocPageHref(opts: {
  id?: string | number | null;
  page?: number | null;
  title?: string | null;
}): string | null {
  const page = Math.floor(Number(opts.page));
  if (!Number.isFinite(page) || page < 1 || page > 9999) return null;
  const qs = new URLSearchParams();
  const id = queryId(opts.id);
  if (id) qs.set('id', id);
  const title = queryTitle(opts.title);
  if (title) qs.set('title', title);
  qs.set('page', String(page));
  return `${MANUAL_VIEW_PATH}?${qs.toString()}#page=${page}`;
}

/** `#page=N` from the location hash. Anything else is not a page target. */
export function viewerPageFromHash(hash: string | null | undefined): number | null {
  const match = String(hash || '').trim().match(/^#page=(\d{1,4})$/i);
  if (!match) return null;
  const page = Number(match[1]);
  return page >= 1 ? page : null;
}

function positivePage(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const page = Math.floor(value);
    return page >= 1 && page <= 9999 ? page : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  const fromParam = trimmed.match(/(?:^|#|[?&])page=(\d{1,4})\b/i);
  if (fromParam) return positivePage(Number(fromParam[1]));
  const plain = trimmed.match(/^(?:p(?:age|\.)?\s*)?(\d{1,4})$/i);
  if (plain) return positivePage(Number(plain[1]));
  return null;
}

function parseMetadata(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function isPdfStoragePath(value: unknown): boolean {
  const path = String(value || '').split('?')[0].split('#')[0].trim();
  return /\.pdf$/i.test(path);
}

function pdfPathKey(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .split('?')[0]
    .split('#')[0]
    .toLowerCase();
}

function cleanTitle(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function collectPdfPaths(node: unknown, found: Set<string>, depth: number) {
  if (depth > MAX_DEPTH) return;
  const parsed = parseMetadata(node);
  if (Array.isArray(parsed)) {
    for (const item of parsed) collectPdfPaths(item, found, depth + 1);
    return;
  }
  if (!parsed || typeof parsed !== 'object') return;
  const rec = parsed as Record<string, unknown>;
  for (const key of ['storage_path', 'path'] as const) {
    if (!isPdfStoragePath(rec[key])) continue;
    const path = pdfPathKey(rec[key]);
    if (path) found.add(path);
  }
  for (const key of NESTED_KEYS) {
    if (rec[key] != null) collectPdfPaths(rec[key], found, depth + 1);
  }
}

function entryPage(rec: Record<string, unknown>, hasPdfPath: boolean): number | null {
  for (const key of PAGE_KEYS) {
    const page = positivePage(rec[key]);
    if (page) return page;
  }
  if (!hasPdfPath) return positivePage(rec.page_start);
  return null;
}

function walkToc(node: unknown, depth: number, out: TocEntry[]) {
  if (out.length >= MAX_TOC || depth > MAX_DEPTH) return;
  const parsed = parseMetadata(node);
  if (Array.isArray(parsed)) {
    for (const item of parsed) walkToc(item, depth, out);
    return;
  }
  if (!parsed || typeof parsed !== 'object') return;
  const rec = parsed as Record<string, unknown>;
  const hasPdf = isPdfStoragePath(rec.storage_path) || isPdfStoragePath(rec.path);
  const title = cleanTitle(rec.title ?? rec.label ?? rec.name);
  const page = entryPage(rec, hasPdf);
  let childDepth = depth;
  if (title && page) {
    out.push({ title, page, depth });
    childDepth = depth + 1;
  }
  if (out.length >= MAX_TOC) return;
  for (const key of NESTED_KEYS) {
    if (rec[key] != null) walkToc(rec[key], childDepth, out);
  }
}

/**
 * In-document TOC stored on the manual row (chapter_metadata).
 * Several distinct PDF paths are a multi-file chapter list, not page links.
 * A missing or unreadable value is an empty list.
 */
export function tocEntriesFromMetadata(metadata: unknown): TocEntry[] {
  const root = parseMetadata(metadata);
  if (root == null) return [];
  const pdfs = new Set<string>();
  collectPdfPaths(root, pdfs, 0);
  if (pdfs.size > 1) return [];
  const out: TocEntry[] = [];
  walkToc(root, 0, out);
  return out;
}

async function pageFromDest(dest: unknown, pdf: OutlinePageSource, depth = 0): Promise<number | null> {
  if (depth > 3 || dest == null) return null;
  const direct = positivePage(dest);
  if (direct && !Array.isArray(dest)) return direct;
  if (typeof dest === 'string') {
    if (!pdf.getDestination) return direct;
    try {
      const resolved = await pdf.getDestination(dest);
      if (resolved == null) return direct;
      return pageFromDest(resolved, pdf, depth + 1);
    } catch {
      return direct;
    }
  }
  if (!Array.isArray(dest) || !dest.length) return null;
  const first = dest[0];
  if (first && typeof first === 'object') {
    if (!pdf.getPageIndex) return null;
    try {
      const index = Math.floor(Number(await pdf.getPageIndex(first)));
      if (!Number.isFinite(index) || index < 0 || index > 9998) return null;
      return index + 1;
    } catch {
      return null;
    }
  }
  return positivePage(first);
}

async function walkOutline(
  nodes: readonly PdfOutlineItem[] | null | undefined,
  pdf: OutlinePageSource,
  depth: number,
  out: TocEntry[],
) {
  if (!nodes || depth > MAX_DEPTH) return;
  for (const item of nodes) {
    if (out.length >= MAX_TOC) return;
    if (!item || typeof item !== 'object') continue;
    const title = cleanTitle(item.title);
    let page = await pageFromDest(item.dest, pdf);
    if (!page) page = positivePage(item.url);
    let childDepth = depth;
    if (title && page) {
      out.push({ title, page, depth });
      childDepth = depth + 1;
    }
    if (item.items?.length) await walkOutline(item.items, pdf, childDepth, out);
  }
}

/** PDF outline bookmarks that resolve to a page. Unresolved items are omitted. */
export async function tocFromPdfOutline(
  outline: readonly PdfOutlineItem[] | null | undefined,
  pdf: OutlinePageSource,
): Promise<TocEntry[]> {
  if (!outline?.length) return [];
  const out: TocEntry[] = [];
  try {
    await walkOutline(outline, pdf, 0, out);
  } catch {
    return out;
  }
  return out;
}

/** The PDF outline wins when it has page targets. Otherwise the extracted TOC. */
export function chooseDocumentToc(
  extracted: readonly TocEntry[] | null | undefined,
  outline: readonly TocEntry[] | null | undefined,
): TocEntry[] {
  if (outline && outline.length) return [...outline];
  if (extracted && extracted.length) return [...extracted];
  return [];
}
