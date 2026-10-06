/**
 * Language for a customer who opens /e/[token] from an email.
 * The shop's saved language on the estimate wins. Otherwise the page uses
 * an explicit ?lang= or the browser Accept-Language, then English.
 * This does not sign, confirm, or redirect the estimate action.
 */
import type { PublicLocale } from './locales.ts';
import { resolvePublicLocale } from './translate-app.ts';

export { estimateDocumentLocale, storedOrgLanguage } from './stored-org-language.ts';

/** A known site language, including explicit English. Unknown tags are skipped. */
export function explicitPublicLocale(raw: string | null | undefined): PublicLocale | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const id = resolvePublicLocale(text);
  if (id !== 'en') return id;
  const lower = text.toLowerCase().replace(/_/g, '-');
  if (lower === 'en' || lower.startsWith('en-')) return 'en';
  return null;
}

/** First supported language in an Accept-Language header, honoring q weights. */
export function localeFromAcceptLanguage(header: string | null | undefined): PublicLocale | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tagRaw, ...params] = part.trim().split(';');
      let q = 1;
      for (const param of params) {
        const match = /q\s*=\s*([0-9.]+)/i.exec(param);
        if (match) q = Number(match[1]);
      }
      return { tag: tagRaw.trim(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((item) => item.tag && item.tag !== '*' && item.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const item of ranked) {
    const locale = explicitPublicLocale(item.tag);
    if (locale) return locale;
  }
  return null;
}

export function resolveCustomerPageLocale(input: {
  orgLanguage?: string | null;
  queryLang?: string | null;
  acceptLanguage?: string | null;
}): PublicLocale {
  return (
    explicitPublicLocale(input.orgLanguage) ??
    explicitPublicLocale(input.queryLang) ??
    localeFromAcceptLanguage(input.acceptLanguage) ??
    'en'
  );
}
