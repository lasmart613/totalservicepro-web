'use client';

import { useMemo } from 'react';
import { useSiteLocale } from '@/lib/fa/locale';
import { formatLocaleDate } from '@/lib/i18n/format-date';
import { localeToBcp47 } from '@/lib/i18n/translate-app';

/** Active site language, formatted with Intl.DateTimeFormat. */
export function useFormatDate(): {
  locale: string;
  format: (value: Date | string | number | null | undefined, options?: Intl.DateTimeFormatOptions) => string;
} {
  const siteLocale = useSiteLocale();
  const locale = localeToBcp47(siteLocale);
  return useMemo(
    () => ({
      locale,
      format: (value, options) => formatLocaleDate(value, locale, options),
    }),
    [locale],
  );
}
