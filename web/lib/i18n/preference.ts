/**
 * Device language for the whole site. Same persistence style as the other
 * Settings choices: localStorage on this browser, applied immediately.
 * A public URL prefix (/he, /de, …) is an explicit choice and updates this key
 * so the header menu and Settings stay on the same language.
 */

import { PUBLIC_LOCALES, type PublicLocale } from './locales.ts';

export const SITE_LANGUAGE_KEY = 'siteLanguage';

const SCRIPT_CLASS: Partial<Record<PublicLocale, string>> = {
  fa: 'fa-preview',
  he: 'he-preview',
  ar: 'ar-preview',
};

const SCRIPT_CLASSES = ['fa-preview', 'he-preview', 'ar-preview'] as const;

const IDS = new Set<string>(PUBLIC_LOCALES.map((item) => item.id));

export function parseSiteLanguage(raw: string | null | undefined): PublicLocale {
  if (raw && IDS.has(raw)) return raw as PublicLocale;
  return 'en';
}

export function readSiteLanguage(): PublicLocale {
  if (typeof window === 'undefined') return 'en';
  try {
    return parseSiteLanguage(window.localStorage.getItem(SITE_LANGUAGE_KEY));
  } catch {
    return 'en';
  }
}

export function writeSiteLanguage(locale: PublicLocale): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SITE_LANGUAGE_KEY, locale);
  } catch {
    /* private mode — the in-memory choice still applies this session */
  }
}

type LocaleRoot = {
  lang: string;
  dir: string;
  classList: { add: (token: string) => void; remove: (token: string) => void };
};

export function documentLocaleMeta(locale: PublicLocale): {
  lang: string;
  dir: 'ltr' | 'rtl';
  htmlClass?: string;
} {
  const meta = PUBLIC_LOCALES.find((item) => item.id === locale) ?? PUBLIC_LOCALES[0];
  return { lang: meta.htmlLang, dir: meta.dir, htmlClass: SCRIPT_CLASS[locale] };
}

/** Sets lang, direction, and the self-hosted Hebrew / Arabic / Farsi font class. */
export function applyDocumentLocale(locale: PublicLocale, root?: LocaleRoot): void {
  const el = root ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!el) return;
  const meta = documentLocaleMeta(locale);
  el.lang = meta.lang;
  el.dir = meta.dir;
  for (const token of SCRIPT_CLASSES) el.classList.remove(token);
  if (meta.htmlClass) el.classList.add(meta.htmlClass);
}
