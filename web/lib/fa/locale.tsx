'use client';

import Link from 'next/link';
import React, { createContext, useContext } from 'react';
import type { ComponentProps } from 'react';
import { prefixLocaleHref, type PublicLocale } from '@/lib/i18n/locales';
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

/** True on a translated public page. English stays false. */
export function useLocalizedPublic(): boolean {
  return usePublicLocale() !== 'en';
}

export function translate(locale: PublicLocale, text: string): string {
  if (locale === 'en' || !text) return text;
  return COPY[locale][text] ?? text;
}

export function useT(): (text: string) => string {
  const locale = usePublicLocale();
  return (text: string) => translate(locale, text);
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
