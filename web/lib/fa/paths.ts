/** Farsi path helpers. Shared rules live in lib/i18n/locales.ts. */

export { PUBLIC_PATHS, prefixLocaleHref } from '../i18n/locales';
import { localeFromPathname, prefixLocaleHref } from '../i18n/locales';

export function isFaPath(pathname: string | null | undefined): boolean {
  return localeFromPathname(pathname) === 'fa';
}

/** Keep the reader inside the Farsi pages. Unknown app paths go to the Farsi login. */
export function prefixFaHref(href: string): string {
  return prefixLocaleHref('fa', href);
}
