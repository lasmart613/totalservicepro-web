'use client';

import { useEffect } from 'react';

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
    const prevLang = el.lang;
    const prevDir = el.getAttribute('dir');
    el.lang = lang;
    el.dir = dir;
    if (htmlClass) el.classList.add(htmlClass);
    return () => {
      el.lang = prevLang && prevLang !== lang ? prevLang : 'en';
      el.dir = prevDir && prevDir !== dir ? prevDir : 'ltr';
      if (htmlClass) el.classList.remove(htmlClass);
    };
  }, [lang, dir, htmlClass]);
  return null;
}
