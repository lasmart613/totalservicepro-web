/** Safe internal path for post-login redirect. Keeps query string and hash. */
export function safeNextPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback;
  return trimmed;
}

/** Encode path+search for /login?next= so query params survive the round-trip. */
export function loginHref(pathAndSearch: string): string {
  return `/login?next=${encodeURIComponent(safeNextPath(pathAndSearch))}`;
}

export function pathWithSearch(
  pathname: string | null | undefined,
  search: string | null | undefined
): string {
  const path = pathname || '/';
  if (!search || search === '?') return path;
  return `${path}${search.startsWith('?') ? search : `?${search}`}`;
}

/**
 * Read next= from the login URL. If leftover params (e.g. type=part) landed on
 * the login query instead of inside next=, reattach them.
 */
export function nextPathFromSearchParams(
  searchParams: { get: (key: string) => string | null; entries: () => IterableIterator<[string, string]> },
  fallback = '/'
): string {
  const next = safeNextPath(searchParams.get('next'), fallback);
  const extras = new URLSearchParams();
  for (const [key, value] of searchParams.entries()) {
    if (key === 'next') continue;
    extras.append(key, value);
  }
  const extra = extras.toString();
  if (!extra) return next;
  return next.includes('?') ? `${next}&${extra}` : `${next}?${extra}`;
}
