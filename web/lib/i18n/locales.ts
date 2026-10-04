/**
 * Public-site languages. English has no prefix. Farsi, Spanish, and French
 * mirror the logged-out pages. Signed-in app paths are not in this set.
 */

export type PublicLocale = 'en' | 'fa' | 'es' | 'fr';

export const PUBLIC_LOCALES: ReadonlyArray<{
  id: PublicLocale;
  /** Name a speaker of that language looks for in the menu. */
  label: string;
  htmlLang: string;
  dir: 'ltr' | 'rtl';
}> = [
  { id: 'en', label: 'English', htmlLang: 'en', dir: 'ltr' },
  { id: 'fa', label: 'فارسی', htmlLang: 'fa', dir: 'rtl' },
  { id: 'es', label: 'Español', htmlLang: 'es', dir: 'ltr' },
  { id: 'fr', label: 'Français', htmlLang: 'fr', dir: 'ltr' },
];

const PREFIXED: ReadonlyArray<Exclude<PublicLocale, 'en'>> = ['fa', 'es', 'fr'];

/** Logged-out routes mirrored under /fa, /es, and /fr. */
export const PUBLIC_PATHS = new Set([
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

export function localeFromPathname(pathname: string | null | undefined): PublicLocale {
  if (!pathname) return 'en';
  for (const id of PREFIXED) {
    if (pathname === `/${id}` || pathname.startsWith(`/${id}/`)) return id;
  }
  return 'en';
}

export function stripLocalePrefix(pathname: string): string {
  const locale = localeFromPathname(pathname);
  if (locale === 'en') return pathname || '/';
  const rest = pathname.slice(locale.length + 1);
  return rest || '/';
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

function alreadyLocalized(href: string): boolean {
  for (const id of PREFIXED) {
    if (href === `/${id}` || href.startsWith(`/${id}/`) || href.startsWith(`/${id}?`) || href.startsWith(`/${id}#`)) {
      return true;
    }
  }
  return false;
}

/** Keep in-page links on the public language the visitor is reading. */
export function prefixLocaleHref(locale: PublicLocale, href: string): string {
  if (!href || locale === 'en') return href;
  if (
    href.startsWith('#') ||
    href.startsWith('mailto:') ||
    href.startsWith('tel:') ||
    href.startsWith('http://') ||
    href.startsWith('https://')
  ) {
    return href;
  }
  if (alreadyLocalized(href)) return href;
  if (href.startsWith('/#')) return `/${locale}${href.slice(1)}`;
  if (!href.startsWith('/')) return href;

  const { path, query, hash } = splitHref(href);
  if (!PUBLIC_PATHS.has(path)) return `/${locale}/login`;
  if (path === '/') return `/${locale}${query}${hash}`;
  return `/${locale}${path}${query}${hash}`;
}

/**
 * Same public page in another language.
 * `extra` is the search and hash (`?role=owner` or `#find-a-rep`).
 * Pages outside the public set go to that language's home.
 */
export function hrefForLocale(pathname: string, target: PublicLocale, extra = ''): string {
  const bare = stripLocalePrefix(pathname.split('?')[0].split('#')[0] || '/');
  const path = bare || '/';
  const suffix = extra || '';
  if (!PUBLIC_PATHS.has(path)) {
    return target === 'en' ? `/${suffix}` : `/${target}${suffix}`;
  }
  if (target === 'en') return (path === '/' ? '/' : path) + suffix;
  if (path === '/') return `/${target}${suffix}`;
  return `/${target}${path}${suffix}`;
}
