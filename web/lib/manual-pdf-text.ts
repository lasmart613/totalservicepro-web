/**
 * Extract searchable text from PDF bytes for the manuals library index.
 * Uses pdf.js (pdfjs-dist legacy build) so ToUnicode CMaps, Form XObjects,
 * and object streams are honored. Image-only scans still yield little text;
 * OCR itself is out of scope — this reader picks up the text layer ocrmypdf writes.
 *
 * Page stamps stay physical PDF pages: `[[pdfpage:N]]` plus a form feed between
 * pages. Citations (PR #149) key off those stamps, not the printed page label.
 */

import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { clipManualSearchText } from './manual-search-text.ts';

export { clipManualSearchText, normalizeManualSearchText, MANUAL_SEARCH_TEXT_MAX } from './manual-search-text.ts';

/**
 * Largest PDF the manual indexer will load.
 *
 * Netlify serverless functions default to 1024 MB of RAM. The reindex routes
 * set `maxDuration` to 60s and the page-range route extracts at most 40 pages
 * per call, which is the time budget. Memory is the hard ceiling: pdf.js keeps
 * the file in a worker while it decodes fonts and content, so peak use is well
 * above the file size. 200 MB is the largest input that still fits that budget.
 * Anything bigger is rejected with manualPdfByteLimitError. The bytes are never
 * silently truncated — a cut-off PDF is not a valid file and used to extract as
 * empty or garbage.
 */
export const MANUAL_SEARCH_PDF_MAX_BYTES = 200 * 1024 * 1024;

/** Keep late physical pages. A 161-page manual does not fit in the old 200k clip. */
export const PDF_INDEX_TEXT_MAX = 1_500_000;

const require = createRequire(import.meta.url);
const PDFJS_PKG = dirname(require.resolve('pdfjs-dist/package.json'));

GlobalWorkerOptions.workerSrc = pathToFileURL(
  require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
).href;

function pdfjsDir(name: string): string {
  return join(PDFJS_PKG, name) + sep;
}

export function manualPdfByteLimitError(byteLength: number): string | null {
  if (!Number.isFinite(byteLength) || byteLength <= MANUAL_SEARCH_PDF_MAX_BYTES) return null;
  const limitMb = Math.round(MANUAL_SEARCH_PDF_MAX_BYTES / (1024 * 1024));
  return (
    `PDF is ${byteLength} bytes, above the ${MANUAL_SEARCH_PDF_MAX_BYTES} byte (${limitMb} MB) indexer limit. ` +
    'Netlify functions provide 1024 MB of memory; pdf.js keeps the file in a worker while decoding it, ' +
    'so anything larger is rejected instead of silently truncated. Split the manual into smaller PDFs and reindex those.'
  );
}

/** Share of alphabetic tokens that are a single letter. Letter-spaced TJ output is near 1. */
export function singleLetterTokenRatio(text: string): number {
  const tokens = String(text || '')
    .replace(/\[\[pdfpage:\d+\]\]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return 1;
  const singles = tokens.filter((token) => token.length === 1 && /[A-Za-z]/.test(token)).length;
  return singles / tokens.length;
}

type PdfTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
  hasEOL?: boolean;
};

/**
 * pdf.js already applies ToUnicode and inserts spaces for large TJ kerns.
 * A same-line gap that it left unspaced still becomes a space; a line change does too.
 * The page string is then collapsed to single spaces, matching the index stamps.
 */
function pageTextFromItems(items: PdfTextItem[]): string {
  const parts: string[] = [];
  let prevXEnd: number | null = null;
  let prevY: number | null = null;
  for (const item of items) {
    const str = typeof item?.str === 'string' ? item.str : '';
    if (!str) continue;
    const x = item.transform?.[4];
    const y = item.transform?.[5];
    if (prevY != null && y != null && x != null && prevXEnd != null) {
      const lineBreak = Math.abs(y - prevY) > 2;
      const gap = x - prevXEnd;
      if ((lineBreak || gap > 1.5) && !str.startsWith(' ') && !/\s$/.test(parts[parts.length - 1] || '')) {
        parts.push(' ');
      }
    }
    parts.push(str);
    if (item.hasEOL && !/\s$/.test(str)) parts.push('\n');
    if (x != null) prevXEnd = x + (typeof item.width === 'number' ? item.width : 0);
    if (y != null) prevY = y;
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/**
 * Hand pdf.js a buffer it can transfer to the worker.
 * A Node Buffer from the small-string pool must be copied; detaching that
 * ArrayBuffer corrupts the pool. A large standalone Uint8Array is passed
 * through so a 200 MB manual is not held twice.
 */
function pdfJsData(bytes: Uint8Array): Uint8Array {
  const sharedView = bytes.byteOffset !== 0 || bytes.buffer.byteLength !== bytes.byteLength;
  const nodeBuffer = typeof Buffer !== 'undefined' && Buffer.isBuffer(bytes);
  if (!sharedView && !nodeBuffer && bytes.byteLength >= 64 * 1024) return bytes;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<{
    getTextContent: (opts?: { includeMarkedContent?: boolean }) => Promise<{ items: PdfTextItem[] }>;
    cleanup: () => void;
  }>;
  destroy: () => Promise<void>;
};

type PdfTask = {
  promise: Promise<PdfDoc>;
  destroy: () => Promise<void>;
};

export type PdfPageText = { page: number; text: string };

/**
 * One page-tree walk. `pages` is the requested physical slice; `total` is the
 * whole tree so a chunked reindex can resume without a second parse.
 * `from` is the 1-based physical page inside this file (not a folder offset).
 */
export async function extractPdfPageSlice(
  bytes: Uint8Array | Buffer,
  range?: { from?: number; count?: number }
): Promise<{ total: number; pages: PdfPageText[] }> {
  const view = Buffer.isBuffer(bytes) ? bytes : bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!view.byteLength) return { total: 0, pages: [] };
  if (!looksLikePdf(view)) return { total: 0, pages: [] };
  const limitError = manualPdfByteLimitError(view.byteLength);
  if (limitError) throw new Error(limitError);

  const task = getDocument({
    data: pdfJsData(view),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
    cMapUrl: pdfjsDir('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: pdfjsDir('standard_fonts'),
  }) as unknown as PdfTask;

  let doc: PdfDoc | null = null;
  try {
    doc = await task.promise;
    const total = doc.numPages || 0;
    const from = Math.max(1, Math.floor(Number(range?.from) || 1));
    const count = range?.count == null ? null : Math.max(0, Math.floor(range.count));
    const to = count == null ? total : Math.min(total, from + count - 1);
    const pages: PdfPageText[] = [];
    if (count !== 0 && from <= total) {
      for (let pageNo = from; pageNo <= to; pageNo++) {
        const page = await doc.getPage(pageNo);
        try {
          const content = await page.getTextContent({ includeMarkedContent: false });
          pages.push({ page: pageNo, text: pageTextFromItems(content.items || []) });
        } finally {
          page.cleanup();
        }
      }
    }
    return { total, pages };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    if (message.includes('indexer limit')) throw err instanceof Error ? err : new Error(message);
    throw new Error(`Could not extract PDF text: ${message}`);
  } finally {
    if (doc) await doc.destroy().catch(() => undefined);
    else await task.destroy().catch(() => undefined);
  }
}

/** Physical pages in tree order. Empty when the file has no readable page tree. */
export async function extractPdfPages(
  bytes: Uint8Array | Buffer,
  range?: { from?: number; count?: number }
): Promise<PdfPageText[]> {
  return (await extractPdfPageSlice(bytes, range)).pages;
}

/** Index text with a [[pdfpage:N]] stamp and a form feed before every page after the first. */
export function stampPdfPages(pages: PdfPageText[]): string {
  if (!pages.length) return '';
  return pages.map((page) => `[[pdfpage:${page.page}]] ${page.text}`.trim()).join('\f');
}

/**
 * Pull visible strings from PDF content streams, including Form XObjects and
 * ToUnicode maps. Multi-page files keep the physical page index
 * (form feed + [[pdfpage:N]]), not the printed label.
 * `pageOffset` continues stamps across later PDFs in a folder manual.
 */
export async function extractPdfSearchText(
  bytes: Uint8Array | Buffer,
  opts?: { pageOffset?: number }
): Promise<string> {
  const view = Buffer.isBuffer(bytes) ? bytes : bytes instanceof Uint8Array ? bytes : new Uint8Array();
  if (!view.byteLength) return '';
  const { pages } = await extractPdfPageSlice(view);
  if (!pages.length) return '';
  const offset = Math.max(0, Math.floor(Number(opts?.pageOffset) || 0));
  const shifted = offset ? pages.map((page) => ({ page: page.page + offset, text: page.text })) : pages;
  return clipManualSearchText(stampPdfPages(shifted), PDF_INDEX_TEXT_MAX);
}

export function looksLikePdf(bytes: Uint8Array | Buffer): boolean {
  if (!bytes || bytes.byteLength < 5) return false;
  const head = Buffer.from(bytes.subarray(0, 8)).toString('latin1');
  return head.startsWith('%PDF-');
}
