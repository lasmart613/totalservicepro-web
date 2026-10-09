/**
 * Same-origin path for post-auth redirects.
 *
 * Rejects backslash, ASCII controls, and a second leading slash, including
 * when those bytes are hidden by percent-encoding. WHATWG URL parsing treats
 * `/\evil.example` and `/\t/evil.example` as https://evil.example/.
 */
const ASCII_CONTROL = /[\u0000-\u001F\u007F]/;
const REDIRECT_PARAM = /^(?:next|redirect|returnTo|redirectTo|redirect_to)$/;

function httpOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Decode at most twice. A malformed % sequence fails closed. */
function decodeRedirectInput(input: string): string | null {
  let value = input;
  for (let pass = 0; pass < 2; pass++) {
    if (!value.includes('%')) break;
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    } catch {
      return null;
    }
  }
  return value;
}

function blockedRedirect(value: string): boolean {
  if (value.includes('\\')) return true;
  if (ASCII_CONTROL.test(value)) return true;
  const lead = value.split(/[?#]/, 1)[0] ?? value;
  if (/^\s/.test(lead) || /^\/\s/.test(lead)) return true;
  if (!value.startsWith('/') || value.startsWith('//')) return true;
  return false;
}

export function safeRedirectPath(
  raw: string | null | undefined,
  origin: string,
  fallback = '/hub'
): string {
  if (raw == null || raw === '') return fallback;
  const base = httpOrigin(origin);
  if (!base) return fallback;
  const decoded = decodeRedirectInput(raw);
  if (decoded == null || blockedRedirect(decoded)) return fallback;

  let url: URL;
  try {
    url = new URL(decoded, base);
  } catch {
    return fallback;
  }
  if (url.origin !== base) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (!path.startsWith('/') || path.startsWith('//') || blockedRedirect(path)) return fallback;
  return path;
}

/**
 * Absolute auth email link. Off-site targets and unsafe next/redirect params
 * fall back to the caller-supplied same-origin URL.
 */
export function safeAuthEmailRedirect(raw: string, origin: string, fallback: string): string {
  const base = httpOrigin(origin);
  if (!base || !raw) return fallback;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fallback;
  }
  if (url.origin !== base || url.username || url.password) return fallback;
  if (!url.pathname.startsWith('/') || url.pathname.startsWith('//')) return fallback;
  if (url.pathname.includes('\\')) return fallback;
  const keys = [...new Set([...url.searchParams.keys()].filter((key) => REDIRECT_PARAM.test(key)))];
  for (const key of keys) {
    const value = url.searchParams.get(key);
    if (value == null) continue;
    url.searchParams.set(key, safeRedirectPath(value, base, '/onboarding'));
  }
  return url.toString();
}
