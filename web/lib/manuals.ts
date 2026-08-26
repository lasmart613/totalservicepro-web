/**
 * Service-manual open/view helpers.
 * PDFs stay in the in-app viewer; signed bytes are served inline (not as attachments).
 */

export const MANUAL_VIEW_STORAGE_KEY = 'tsp-manual-view';
export const MANUAL_VIEW_PATH = '/manuals/view';
export const PDFJS_CDN_VERSION = '3.11.174';

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
