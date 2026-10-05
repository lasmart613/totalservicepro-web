'use client';

import React, { useId, useMemo, useState } from 'react';
import { useSiteLocale } from '@/lib/fa/locale';
import { useT } from '@/lib/fa/locale';
import { PUBLIC_LOCALES } from '@/lib/i18n/locales';
import {
  formatOrgMoney,
  listCurrencies,
  NUMBER_FORMATS,
  searchCurrencies,
} from '@/lib/money-format';

export function OrgMoneySettings({
  currencyCode,
  numberFormat,
  disabled,
  onChange,
}: {
  currencyCode: string;
  numberFormat: string;
  disabled?: boolean;
  onChange: (next: { currency_code: string; number_format: string }) => void;
}) {
  const t = useT();
  const siteLocale = useSiteLocale();
  const locale = PUBLIC_LOCALES.find((item) => item.id === siteLocale)?.htmlLang || 'en';
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => listCurrencies().find((row) => row.code === currencyCode) || { code: currencyCode || 'USD', name: '' },
    [currencyCode]
  );
  const options = useMemo(() => searchCurrencies(query), [query]);
  const sample = formatOrgMoney(1234.56, { currencyCode, numberFormat }, locale);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">{t('Currency and number format')}</h3>
        <p className="text-xs text-[var(--text3)] mt-1">
          {t(
            'This labels amounts in the app, invoices, and reports. It does not convert currencies and does not change Stripe charges or subscription prices.'
          )}
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="relative">
          <label className="label" htmlFor={listId}>
            {t('Preferred currency')}
          </label>
          <input
            id={listId}
            className="input mt-1"
            dir="ltr"
            role="combobox"
            aria-expanded={open}
            aria-controls={`${listId}-list`}
            aria-autocomplete="list"
            disabled={disabled}
            placeholder={t('Search currencies')}
            value={open ? query : `${selected.code}${selected.name ? ` — ${selected.name}` : ''}`}
            onFocus={() => {
              if (disabled) return;
              setQuery('');
              setOpen(true);
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onBlur={() => {
              window.setTimeout(() => setOpen(false), 150);
            }}
          />
          {open && !disabled && (
            <ul
              id={`${listId}-list`}
              role="listbox"
              dir="ltr"
              className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg"
            >
              {options.length === 0 ? (
                <li className="px-3 py-2 text-sm text-[var(--text3)]">{t('No currencies match')}</li>
              ) : (
                options.map((row) => (
                  <li key={row.code} role="option" aria-selected={row.code === currencyCode}>
                    <button
                      type="button"
                      className={`w-full text-start px-3 py-2 text-sm hover:bg-[var(--surface3)] ${
                        row.code === currencyCode ? 'text-[var(--gold)] font-semibold' : ''
                      }`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        onChange({ currency_code: row.code, number_format: numberFormat || 'auto' });
                        setQuery('');
                        setOpen(false);
                      }}
                    >
                      <span className="font-semibold">{row.code}</span>
                      <span className="text-[var(--text3)]"> — {row.name}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
        <div>
          <label className="label" htmlFor={`${listId}-format`}>
            {t('Number format')}
          </label>
          <select
            id={`${listId}-format`}
            className="select mt-1 w-full"
            disabled={disabled}
            value={numberFormat || 'auto'}
            onChange={(event) =>
              onChange({ currency_code: currencyCode || 'USD', number_format: event.target.value })
            }
          >
            {NUMBER_FORMATS.map((row) => (
              <option key={row.id} value={row.id}>
                {t(row.label)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-sm">
        <span className="text-[var(--text3)]">{t('Sample')}</span>{' '}
        <span className="font-semibold" dir="ltr">
          {sample}
        </span>
      </p>
      {disabled ? (
        <p className="text-xs text-[var(--text3)]">{t('Only an organization owner or admin can change this.')}</p>
      ) : null}
    </div>
  );
}
