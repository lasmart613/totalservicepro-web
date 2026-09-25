/**
 * Service-manual open/view helpers.
 * PDFs stay in the in-app viewer; signed bytes are served inline (not as attachments).
 */

export const MANUAL_VIEW_STORAGE_KEY = 'tsp-manual-view';
export const MANUAL_VIEW_PATH = '/manuals/view';
/** Same-origin pdf.js (vendored). Do not load from a CDN — Netlify CSP is 'self'. */
export const PDFJS_SCRIPT_SRC = '/pdfjs/pdf.min.js';
export const PDFJS_WORKER_SRC = '/pdfjs/pdf.worker.min.js';
/** In-repo multi-page fixture for viewer QA (not a live org manual). */
export const MANUAL_FIXTURE_PATH = '/fixtures/sample-service-manual.pdf';
export const MANUAL_FIXTURE_PAGE_COUNT = 3;
export const MANUAL_FIXTURE_DEMO_PATH = '/pdf-viewer-demo';

export type ManualChapter = {
  title?: string;
  storage_path?: string;
  label?: string;
};

export type ManualViewPayload = {
  manualId?: string | number | null;
  title?: string;
  storagePath?: string | null;
  url?: string | null;
  dataBase64?: string | null;
  contentType?: string | null;
  chapters?: ManualChapter[] | null;
  isIncomplete?: boolean;
};

export type ManualUrlResult = {
  ok: boolean;
  status: number;
  json: Record<string, any>;
};

export function pdfInlineHeaders(filename = 'service-manual.pdf'): Record<string, string> {
  const safe = String(filename || 'service-manual.pdf')
    .replace(/["\r\n]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'service-manual.pdf';
  return {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${safe}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  };
}

export function manualViewHref(opts: {
  id?: string | number | null;
  title?: string | null;
  page?: string | number | null;
  section?: string | null;
  find?: string | null;
}): string {
  const qs = new URLSearchParams();
  if (opts.id != null && String(opts.id).trim() !== '') qs.set('id', String(opts.id));
  if (opts.title) qs.set('title', String(opts.title).slice(0, 160));
  const page = Number(opts.page);
  if (Number.isFinite(page) && page >= 1) qs.set('page', String(Math.floor(page)));
  if (opts.section) qs.set('section', String(opts.section).slice(0, 80));
  if (opts.find) qs.set('q', String(opts.find).slice(0, 80));
  const q = qs.toString();
  return q ? `${MANUAL_VIEW_PATH}?${q}` : MANUAL_VIEW_PATH;
}

export function stashManualView(payload: ManualViewPayload): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(MANUAL_VIEW_STORAGE_KEY, JSON.stringify(payload));
}

export function readManualView(): ManualViewPayload | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(MANUAL_VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ManualViewPayload;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function isLikelyPdfPath(path: string | null | undefined): boolean {
  return /\.pdf($|[?#])/i.test(String(path || ''));
}

export type PdfTextItem = { str?: string };

export type TextMatchSpan = { index: number; from: number; to: number };

/**
 * Case-insensitive substring match used by in-viewer Find.
 * pdf.js emits a subscript digit as its own text item. The viewer joins items
 * with spaces, so "CO₂RE" is "CO 2 RE" and a plain includes() misses "CO2RE".
 * Queries that contain a digit also match with whitespace removed. Other
 * queries stay a plain substring so "ice m" does not hit "service manual".
 */
export function pageTextMatches(haystack: string, query: string): boolean {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return false;
  const hay = String(haystack || '').toLowerCase();
  if (hay.includes(q)) return true;
  if (!/\d/.test(q)) return false;
  const qCompact = q.replace(/\s+/g, '');
  if (!qCompact) return false;
  return hay.replace(/\s+/g, '').includes(qCompact);
}

function mergeCharSpans(hits: Array<{ index: number; char: number }>): TextMatchSpan[] {
  const spans: TextMatchSpan[] = [];
  for (const hit of hits) {
    const prev = spans[spans.length - 1];
    if (prev && prev.index === hit.index && hit.char <= prev.to) {
      prev.to = Math.max(prev.to, hit.char + 1);
      prev.from = Math.min(prev.from, hit.char);
      continue;
    }
    spans.push({ index: hit.index, from: hit.char, to: hit.char + 1 });
  }
  return spans;
}

/**
 * Character spans inside pdf.js text items that form a Find hit.
 * Subscript digits stay separate items; the highlight covers only the matched
 * glyphs inside a longer run such as "Candela CO".
 */
export function matchingTextItemSpans(items: PdfTextItem[] | null | undefined, query: string): TextMatchSpan[] {
  const parts = (items || []).map((it) => String(it?.str || ''));
  const q = String(query || '').trim().toLowerCase();
  if (!q || !pageTextMatches(parts.join(' '), q)) return [];
  const spaced = parts.join(' ').toLowerCase();
  if (spaced.includes(q)) {
    const at = spaced.indexOf(q);
    const hits: Array<{ index: number; char: number }> = [];
    let cursor = 0;
    parts.forEach((part, index) => {
      for (let c = 0; c < part.length; c++) {
        const pos = cursor + c;
        if (pos >= at && pos < at + q.length) hits.push({ index, char: c });
      }
      cursor += part.length + 1;
    });
    return mergeCharSpans(hits);
  }
  const qCompact = q.replace(/\s+/g, '');
  const map: Array<{ index: number; char: number }> = [];
  let compact = '';
  parts.forEach((part, index) => {
    for (let c = 0; c < part.length; c++) {
      if (/\s/.test(part[c])) continue;
      compact += part[c].toLowerCase();
      map.push({ index, char: c });
    }
  });
  const at = compact.indexOf(qCompact);
  if (at < 0) return [];
  return mergeCharSpans(map.slice(at, at + qCompact.length));
}

/** Text-item indexes that form a Find hit. */
export function matchingTextItemIndexes(items: PdfTextItem[] | null | undefined, query: string): number[] {
  return [...new Set(matchingTextItemSpans(items, query).map((span) => span.index))];
}
