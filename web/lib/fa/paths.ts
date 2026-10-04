/** Public, logged-out routes mirrored at /fa. Signed-in app paths stay off this list. */
const PUBLIC_PATHS = new Set([
  '/',
  '/plans',
  '/marketplace',
  '/marketplace/parts',
  '/marketplace/used-systems',
  '/marketplace/consumables',
  '/directory',
  '/find-a-rep',
  '/login',
  '/signup',
  '/signup/company',
  '/signup/owner',
  '/signup/supplier',
  '/signup/fse',
  '/forgot-password',
  '/calculators',
]);

export function isFaPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === '/fa' || pathname.startsWith('/fa/');
}

function splitHref(href: string): { path: string; query: string; hash: string } {
  const hashAt = href.indexOf('#');
  const beforeHash = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const hash = hashAt >= 0 ? href.slice(hashAt) : '';
  const queryAt = beforeHash.indexOf('?');
  const path = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
  const query = queryAt >= 0 ? beforeHash.slice(queryAt) : '';
  return { path, query, hash };
}

/** Keep the reviewer inside the Farsi preview. Unknown app paths go to the Farsi login. */
export function prefixFaHref(href: string): string {
  if (!href) return href;
  if (
    href.startsWith('#') ||
    href.startsWith('mailto:') ||
    href.startsWith('tel:') ||
    href.startsWith('http://') ||
    href.startsWith('https://')
  ) {
    return href;
  }
  if (href === '/fa' || href.startsWith('/fa/') || href.startsWith('/fa?') || href.startsWith('/fa#')) {
    return href;
  }
  if (href.startsWith('/#')) {
    return `/fa${href.slice(1)}`;
  }
  if (!href.startsWith('/')) return href;

  const { path, query, hash } = splitHref(href);
  if (!PUBLIC_PATHS.has(path)) return '/fa/login';
  if (path === '/') return `/fa${query}${hash}`;
  return `/fa${path}${query}${hash}`;
}
