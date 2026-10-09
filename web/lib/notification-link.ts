import { mapAndroidHtmlPath } from './android-html-routes.ts';
import { safeRedirectPath } from './safe-redirect.ts';
import { PRODUCTION_SITE_ORIGIN } from './site-origin.ts';

const CONTROL = /[\u0000-\u001F\u007F]/;

function hasScheme(raw: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//');
}

/** Path from a same-origin absolute URL. Off-site, scheme, and backslash links are dropped. */
function sameOriginStoredPath(raw: string, origin: string): string | null {
  if (!origin || raw.includes('\\') || CONTROL.test(raw)) return null;
  try {
    const base = new URL(origin);
    if (base.protocol !== 'http:' && base.protocol !== 'https:') return null;
    const url = new URL(raw, base);
    if (url.origin !== base.origin || url.username || url.password) return null;
    if (url.pathname.includes('\\')) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/**
 * Map a stored notification.link (Android html or a web path) to a Next path.
 * Does not accept off-site URLs. Caller still runs the result through safeRedirectPath.
 */
function mapNotificationHref(
  link: string | null | undefined,
  type: string | null | undefined,
  origin: string
): string | null {
  let raw = String(link ?? '').trim();
  if (raw && (hasScheme(raw) || raw.includes('\\') || CONTROL.test(raw))) {
    raw = sameOriginStoredPath(raw, origin) || '';
  }

  if (!raw) {
    if (type === 'bid_accepted' || type === 'bid_awarded') return '/accepted-bids';
    return null;
  }

  // Type-first for awards (even if link is wrong/legacy)
  if (type === 'bid_accepted' || type === 'bid_awarded' || type === 'bid_declined') {
    const id =
      (raw.match(/[?&]id=([^&]+)/i) ||
        raw.match(/[?&]request=([^&]+)/i) ||
        raw.match(/\/marketplace\/requests\/([^/?#]+)/i) ||
        raw.match(/service_requests\.html\?(?:.*&)?id=([^&]+)/i) ||
        [])[1] || null;
    return id
      ? `/accepted-bids?id=${encodeURIComponent(decodeURIComponent(id))}`
      : '/accepted-bids';
  }

  // Android asset → web
  const htmlId = raw.match(/^service_requests\.html\?(?:.*&)?id=([^&]+)/i);
  if (htmlId) return `/accepted-bids?id=${encodeURIComponent(decodeURIComponent(htmlId[1]))}`;
  if (/^accepted_bids\.html/i.test(raw)) {
    const q = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
    return `/accepted-bids${q}`;
  }
  // Literal path that 404s on Next
  if (/^service_requests\.html/i.test(raw)) return '/service-requests';
  if (/^equipment_listing\.html\?(?:.*&)?id=([^&]+)/i.test(raw)) {
    const m = raw.match(/[?&]id=([^&]+)/i);
    if (m) return `/marketplace/listing/${encodeURIComponent(decodeURIComponent(m[1]))}`;
  }
  if (/^marketplace\.html/i.test(raw)) return '/marketplace';
  if (/^service_schedule\.html/i.test(raw)) return '/service-schedule';

  // Web paths already
  if (raw.startsWith('/accepted-bids')) return raw;
  // Awarded RFQs are no longer public; send parties to Accepted Bids
  const mktReq = raw.match(/^\/marketplace\/requests\/([^/?#]+)/i);
  if (mktReq) {
    if (type === 'bid_accepted' || type === 'bid_awarded' || type === 'bid_declined') {
      return `/accepted-bids?id=${encodeURIComponent(mktReq[1])}`;
    }
    return `/marketplace/requests/${mktReq[1]}`;
  }
  if (raw.startsWith('/marketplace/') || raw.startsWith('/service-') || raw.startsWith('/reports')) {
    return raw;
  }

  // Bare .html (with or without leading slash / relative to /notifications)
  if (/\.html(\?|$)/i.test(raw)) {
    const pathOnly = raw.split('?')[0];
    const q = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
    const mapped = mapAndroidHtmlPath(pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`, q);
    if (mapped) return mapped;
  }

  if (raw.startsWith('/')) return raw;
  return `/${raw}`;
}

/**
 * On-site path for a stored notification link.
 * Off-site, backslash, and control-character links are not followed (null).
 * Award types with no usable link still open Accepted Bids.
 */
export function notificationClickPath(
  link: string | null | undefined,
  type?: string | null,
  origin: string = PRODUCTION_SITE_ORIGIN
): string | null {
  const mapped = mapNotificationHref(link, type, origin);
  if (!mapped) return null;
  const safe = safeRedirectPath(mapped, origin, '');
  return safe || null;
}

/** @deprecated Use notificationClickPath. Same guard. */
export function resolveNotificationHref(
  link: string | null | undefined,
  type?: string | null,
  origin: string = PRODUCTION_SITE_ORIGIN
): string | null {
  return notificationClickPath(link, type, origin);
}
