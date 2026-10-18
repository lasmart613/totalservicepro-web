/**
 * Display dates in the active site language, the same way money uses Intl.
 * Date-only strings (YYYY-MM-DD) are read at noon so the calendar day does not shift.
 */
import { localeToBcp47 } from './translate-app.ts';

export function formatLocaleDate(
  value: Date | string | number | null | undefined,
  locale?: string | null,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (value == null || value === '') return '';
  const date = coerceDate(value);
  if (!date) return String(value);
  const bcp = localeToBcp47(locale);
  try {
    return new Intl.DateTimeFormat(bcp, options).format(date);
  } catch {
    return new Intl.DateTimeFormat('en', options).format(date);
  }
}

/**
 * A Date for display. A date-only value ('YYYY-MM-DD', a Postgres date column)
 * is read as local noon, never as UTC midnight, so it shows the same calendar
 * day in every US timezone (America/Phoenix showed 2026-10-01 as 9/30).
 * Timestamps are parsed as usual. Null for empty or invalid input.
 */
export function parseDisplayDate(value: Date | string | number | null | undefined): Date | null {
  if (value == null || value === '') return null;
  return coerceDate(value);
}

/**
 * Drop-in for `new Date(value).toLocaleDateString(locale, options)` that keeps a
 * date-only value on its calendar day. Unparseable input is returned as-is.
 */
export function formatDisplayDay(
  value: Date | string | number | null | undefined,
  locale?: string | string[],
  options?: Intl.DateTimeFormatOptions,
): string {
  if (value == null || value === '') return '';
  const date = parseDisplayDate(value);
  return date ? date.toLocaleDateString(locale, options) : String(value);
}

function coerceDate(value: Date | string | number): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = String(value).trim();
  if (!text) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T12:00:00`) : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}
