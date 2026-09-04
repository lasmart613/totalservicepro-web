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

export function manualViewHref(opts: { id?: string | number | null; title?: string | null }): string {
  const qs = new URLSearchParams();
  if (opts.id != null && String(opts.id).trim() !== '') qs.set('id', String(opts.id));
  if (opts.title) qs.set('title', String(opts.title).slice(0, 160));
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

/** Case-insensitive substring match used by in-viewer Find. */
export function pageTextMatches(haystack: string, query: string): boolean {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return false;
  return String(haystack || '').toLowerCase().includes(q);
}
