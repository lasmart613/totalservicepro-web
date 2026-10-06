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
