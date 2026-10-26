/**
 * Shared escaping and image-src allowlist for print, PDF, and emailed documents.
 * Browser-safe (atob / URL only) — invoice, estimate, and report previews import this.
 */

/** Canvas signature pads are small. A longer value is not embedded in print HTML. */
export const PNG_DATA_URL_MAX_LENGTH = 512 * 1024;

/** Remote logos are short. Anything longer is not a stored https logo URL. */
export const HTTP_URL_MAX_LENGTH = 2048;

const PNG_DATA_URL_RE = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CSS_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** A #RGB or #RRGGBB color. Anything else (quotes, urls) is the fallback. */
export function cssHex(value: unknown, fallback: string): string {
  const raw = String(value ?? '').trim();
  return CSS_HEX.test(raw) ? raw : fallback;
}

export function escapeHtml(value: unknown): string {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeCanonicalBase64(b64: string): Uint8Array | null {
  if (b64.length === 0 || b64.length % 4 !== 0) return null;
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    return null;
  }
  let canonical: string;
  try {
    canonical = btoa(binary);
  } catch {
    return null;
  }
  if (canonical !== b64) return null;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
}

/**
 * A real `data:image/png;base64,<canonical base64>` PNG, or null.
 * MIME type, encoding, and alphabet are case-sensitive. SVG, HTML, and
 * javascript: values do not match.
 */
export function pngDataImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > PNG_DATA_URL_MAX_LENGTH) return null;
  const match = PNG_DATA_URL_RE.exec(raw);
  if (!match) return null;
  const bytes = decodeCanonicalBase64(match[1]);
  if (!bytes || bytes.length < PNG_MAGIC.length) return null;
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (bytes[i] !== PNG_MAGIC[i]) return null;
  }
  return raw;
}

/** http(s) URL with no quotes, whitespace, or credentials. Null otherwise. */
export function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > HTTP_URL_MAX_LENGTH) return null;
  if (/[\u0000-\u001F\u007F\s"'<>\\]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return raw;
}

/**
 * Image src for a document logo.
 * Data URLs must be a real PNG (same rule as a signature). Anything else must be http(s).
 */
export function safeDocumentImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  if (/^data:/i.test(raw) || /^javascript:/i.test(raw)) return pngDataImageUrl(raw);
  return httpUrl(raw);
}
