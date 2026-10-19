'use client';

import React, { useMemo } from 'react';
import { useSiteLocale, useT } from '@/lib/fa/locale';
import { countryOptions, normalizeCountryName } from '@/lib/countries';

/** Country dropdown. Shows localized names, stores the English name (000929). */
export function CountrySelect({
  value,
  onChange,
  id,
  className = 'select',
}: {
  value: string | null | undefined;
  onChange: (country: string | null) => void;
  id?: string;
  className?: string;
}) {
  const t = useT();
  const locale = useSiteLocale();
  const options = useMemo(() => countryOptions(locale), [locale]);
  const current = normalizeCountryName(value) ?? '';
  return (
    <select
      id={id}
      className={className}
      value={current}
      onChange={(e) => onChange(normalizeCountryName(e.target.value))}
    >
      <option value="">{t('Select a country')}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
