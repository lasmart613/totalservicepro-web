/** Service report prefill helpers (no network). */
import { orgTodayIso } from './org-timezone.ts';

export { nextPmDue, DEFAULT_PM_INTERVAL_MONTHS } from './billing/doc-prefill.ts';

/** datetime-local value for "signed now": org today + local HH:mm. */
export function signedNowLocal(
  zone?: Parameters<typeof orgTodayIso>[0],
  now: Date = new Date()
): string {
  const day = orgTodayIso(zone as any);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${day}T${hh}:${mm}`;
}

/** datetime-local input needs a time; a saved date-only value gets midnight. */
export function signedDateInputValue(value: unknown): string {
  const s = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 16);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00`;
  return s.slice(0, 10) && /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(0, 10)}T00:00` : '';
}
