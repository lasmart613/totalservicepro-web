/**
 * Organization website collected during onboarding.
 * A bare domain or www host is saved as https://. An address that already
 * uses http:// or https:// is kept. Any other explicit scheme is rejected
 * and is never prefixed with https://.
 */

export const ORGANIZATION_WEBSITE_ERROR =
  'Enter a website like example.com. http:// and https:// links are fine.';

export class OrganizationWebsiteError extends Error {
  constructor(message: string = ORGANIZATION_WEBSITE_ERROR) {
    super(message);
    this.name = 'OrganizationWebsiteError';
  }
}

export type NormalizedOrganizationWebsite =
  | { ok: true; website: string | null }
  | { ok: false; error: string };

const MAX_LEN = 2000;
const LABEL = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/i;
const TLD = /^(?:[a-z]{2,63})$/i;

function invalid(): NormalizedOrganizationWebsite {
  return { ok: false, error: ORGANIZATION_WEBSITE_ERROR };
}

/** Scheme name when the value declares one. `example.com:8080` is a port, not a scheme. */
function explicitScheme(raw: string): string | null {
  const withSlashes = raw.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (withSlashes) return withSlashes[1].toLowerCase();
  const bare = raw.match(/^([a-z][a-z0-9+.-]*):/i);
  if (bare && !bare[1].includes('.')) return bare[1].toLowerCase();
  return null;
}

function acceptableHttpUrl(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname;
  if (!host || host.length > 253 || host.startsWith('.') || host.endsWith('.') || host.includes('..')) {
    return false;
  }
  const labels = host.split('.');
  if (labels.length < 2) return false;
  if (!labels.every((label) => LABEL.test(label))) return false;
  return TLD.test(labels[labels.length - 1]);
}

/** https://example.com with no empty trailing slash. Paths, queries, and ports stay. */
function canonical(url: URL): string {
  if ((url.pathname === '/' || url.pathname === '') && !url.search && !url.hash) {
    return `${url.protocol}//${url.host}`;
  }
  return url.href;
}

export function normalizeOrganizationWebsite(value: unknown): NormalizedOrganizationWebsite {
  if (value == null) return { ok: true, website: null };
  if (typeof value !== 'string') return invalid();
  const raw = value.trim();
  if (!raw) return { ok: true, website: null };
  if (raw.length > MAX_LEN || raw.includes('\\') || /[\u0000-\u001F\u007F]/.test(raw)) return invalid();

  const scheme = explicitScheme(raw);
  if (scheme && scheme !== 'http' && scheme !== 'https') return invalid();

  let url: URL;
  try {
    url = new URL(scheme ? raw : `https://${raw.replace(/^\/+/, '')}`);
  } catch {
    return invalid();
  }
  if (!acceptableHttpUrl(url)) return invalid();

  if (scheme && /^https?:\/\//i.test(raw)) return { ok: true, website: raw };
  return { ok: true, website: canonical(url) };
}

export function organizationWebsiteOrThrow(value: unknown): string | null {
  const site = normalizeOrganizationWebsite(value);
  if (!site.ok) throw new OrganizationWebsiteError(site.error);
  return site.website;
}
