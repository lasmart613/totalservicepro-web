'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import React, { createContext, useCallback, useContext, useLayoutEffect, useState } from 'react';
import type { ComponentProps } from 'react';
import { appStrings } from '@/lib/i18n/app-copy';
import {
  hrefForLocale,
  localeFromPathname,
  prefixLocaleHref,
  PUBLIC_PATHS,
  stripLocalePrefix,
  type PublicLocale,
} from '@/lib/i18n/locales';
import { applyDocumentLocale, readSiteLanguage, writeSiteLanguage } from '@/lib/i18n/preference';
import { FA_COPY } from './copy';
import { ES_COPY } from '../es/copy';
import { FR_COPY } from '../fr/copy';
import { HE_COPY } from '../he/copy';
import { IT_COPY } from '../it/copy';
import { DE_COPY } from '../de/copy';
import { PT_COPY } from '../pt/copy';
import { AR_COPY } from '../ar/copy';

const COPY: Record<Exclude<PublicLocale, 'en'>, Record<string, string>> = {
  fa: FA_COPY,
  es: ES_COPY,
  fr: FR_COPY,
  he: HE_COPY,
  it: IT_COPY,
  de: DE_COPY,
  pt: PT_COPY,
  ar: AR_COPY,
};

const LocaleContext = createContext<PublicLocale>('en');
const SiteLocaleContext = createContext<PublicLocale>('en');
const SetSiteLanguageContext = createContext<(locale: PublicLocale) => void>(() => {});

export function PublicLocaleProvider({
  locale,
  children,
}: {
  locale: PublicLocale;
  children: React.ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** @deprecated Use PublicLocaleProvider locale="fa". Kept so existing Farsi layout imports still work. */
export function FaProvider({ children }: { children: React.ReactNode }) {
  return <PublicLocaleProvider locale="fa">{children}</PublicLocaleProvider>;
}

export function usePublicLocale(): PublicLocale {
  return useContext(LocaleContext);
}

export function useFa(): boolean {
  return usePublicLocale() === 'fa';
}

/** True on a URL-prefixed public page. English URLs stay false, even when a device language is set. */
export function useLocalizedPublic(): boolean {
  return usePublicLocale() !== 'en';
}

/**
 * Language of the interface: the public URL prefix when one is present,
 * otherwise the language saved in Settings.
 */
export function useSiteLocale(): PublicLocale {
  return useContext(SiteLocaleContext);
}

export function useSetSiteLanguage(): (locale: PublicLocale) => void {
  return useContext(SetSiteLanguageContext);
}

export function translate(locale: PublicLocale, text: string): string {
  if (locale === 'en' || !text) return text;
  return COPY[locale][text] ?? appStrings(locale)[text] ?? text;
}

export function useT(): (text: string) => string {
  const locale = useSiteLocale();
  return (text: string) => translate(locale, text);
}

function pathWithoutSuffix(pathname: string): string {
  return pathname.split('?')[0].split('#')[0] || '/';
}

/**
 * Applies the saved language on signed-in and unprefixed pages, and remembers
 * a public prefix so Settings matches the header menu.
 */
export function SiteLocaleProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const pathLocale = localeFromPathname(pathname);
  const [stored, setStored] = useState<PublicLocale>('en');
  const locale: PublicLocale = pathLocale !== 'en' ? pathLocale : stored;

  useLayoutEffect(() => {
    const fromPath = localeFromPathname(window.location.pathname);
    if (fromPath !== 'en') {
      writeSiteLanguage(fromPath);
      setStored(fromPath);
      applyDocumentLocale(fromPath);
      return;
    }
    const saved = readSiteLanguage();
    setStored(saved);
    applyDocumentLocale(saved);
  }, [pathname]);

  const setSiteLanguage = useCallback(
    (next: PublicLocale) => {
      writeSiteLanguage(next);
      setStored(next);
      applyDocumentLocale(next);
      const bare = stripLocalePrefix(pathWithoutSuffix(pathname)) || '/';
      if (!PUBLIC_PATHS.has(bare)) return;
      const extra =
        typeof window !== 'undefined' ? `${window.location.search}${window.location.hash}` : '';
      const href = hrefForLocale(pathname, next, extra);
      const current = `${pathWithoutSuffix(pathname)}${extra}`;
      if (href !== current && href !== pathname) router.push(href);
    },
    [pathname, router],
  );

  return (
    <SetSiteLanguageContext.Provider value={setSiteLanguage}>
      <SiteLocaleContext.Provider value={locale}>{children}</SiteLocaleContext.Provider>
    </SetSiteLanguageContext.Provider>
  );
}

export function usePublicHref(): (href: string) => string {
  const locale = usePublicLocale();
  return (href: string) => prefixLocaleHref(locale, href);
}

/** next/link that stays on the current public language. */
export function PublicLink({ href, ...rest }: ComponentProps<typeof Link>) {
  const to = usePublicHref();
  const nextHref = typeof href === 'string' ? to(href) : href;
  return <Link href={nextHref} {...rest} />;
}
