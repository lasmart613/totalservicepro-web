'use client';

import { useEffect } from 'react';
import { applyDocumentLocale, readSiteLanguage } from '@/lib/i18n/preference';

/** Sets document language and direction while a public locale layout is mounted. */
export function LocaleHtml({
  lang,
  dir,
  htmlClass,
}: {
  lang: string;
  dir: 'ltr' | 'rtl';
  htmlClass?: string;
}) {
  useEffect(() => {
    const el = document.documentElement;
    el.lang = lang;
    el.dir = dir;
    if (htmlClass) el.classList.add(htmlClass);
    return () => {
      applyDocumentLocale(readSiteLanguage());
    };
  }, [lang, dir, htmlClass]);
  return null;
}
