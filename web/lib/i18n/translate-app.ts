/**
 * Signed-in and document copy. English is the key.
 * Unknown locales and missing keys fall back to English.
 */
import { appStrings } from './app-copy.ts';
import { PUBLIC_LOCALES, type PublicLocale } from './locales.ts';

export function resolvePublicLocale(raw: string | null | undefined): PublicLocale {
  if (!raw) return 'en';
  const lower = String(raw).trim().toLowerCase().replace(/_/g, '-');
  if (!lower) return 'en';
  if (lower === 'en' || lower.startsWith('en-')) return 'en';
  if (lower === 'pt' || lower === 'pt-br') return 'pt';
  const hit = PUBLIC_LOCALES.find(
    (item) => item.id === lower || item.htmlLang.toLowerCase() === lower,
  );
  if (hit) return hit.id;
  const prefix = lower.split('-')[0];
  return PUBLIC_LOCALES.find((item) => item.id === prefix)?.id ?? 'en';
}

/** Null when the value is missing or not one of the site languages. English is kept. */
export function parseMailLocale(raw: unknown): PublicLocale | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const lower = raw.trim().toLowerCase().replace(/_/g, '-');
  if (lower === 'en' || lower.startsWith('en-')) return 'en';
  const id = resolvePublicLocale(raw);
  if (id === 'en') return null;
  return id;
}

export function localeToBcp47(locale: string | null | undefined): string {
  const id = resolvePublicLocale(locale);
  return PUBLIC_LOCALES.find((item) => item.id === id)?.htmlLang || 'en';
}

export function translateApp(locale: string | null | undefined, text: string): string {
  if (!text) return text;
  const id = resolvePublicLocale(locale);
  if (id === 'en') return text;
  return appStrings(id)[text] ?? text;
}

export function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (token, key) =>
    vars[key] == null ? token : String(vars[key]),
  );
}

export function translateAppFill(
  locale: string | null | undefined,
  text: string,
  vars: Record<string, string | number>,
): string {
  return fillTemplate(translateApp(locale, text), vars);
}

export function documentDirection(locale: string | null | undefined): {
  lang: string;
  dir: 'ltr' | 'rtl';
} {
  const id = resolvePublicLocale(locale);
  const meta = PUBLIC_LOCALES.find((item) => item.id === id) ?? PUBLIC_LOCALES[0];
  return { lang: meta.htmlLang, dir: meta.dir };
}

/**
 * Mirror physical left/right alignment for RTL PDF and email HTML.
 * English documents are returned unchanged so existing markup stays put.
 */
const RTL_MARK = '<!--tsp-dir-rtl-->';

export function withDocDirection(html: string, locale?: string | null): string {
  const meta = documentDirection(locale);
  if (!html || meta.dir !== 'rtl') return html;
  let next = html.includes(RTL_MARK)
    ? html
    : RTL_MARK +
      html.replace(/text-align:\s*(left|right)/gi, (_match, side: string) =>
        `text-align:${side.toLowerCase() === 'left' ? 'right' : 'left'}`,
      );
  if (/<html[\s>]/i.test(next)) {
    return next.replace(/<html\b([^>]*)>/i, (match, attrs: string) => {
      if (/\sdir=/i.test(attrs)) return match;
      const cleaned = String(attrs).replace(/\slang=(["']).*?\1/i, '');
      return `<html lang="${meta.lang}" dir="rtl"${cleaned}>`;
    });
  }
  if (/dir=["']rtl["']/i.test(next)) return next;
  return next.replace(/<div\b/i, `<div dir="rtl" lang="${meta.lang}"`);
}
