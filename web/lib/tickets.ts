/** Shared ticket/report date + status helpers (dashboard, schedule, admin). */

import { isoDateInTimeZone } from './org-timezone.ts';

export function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Normalize a DB date (date / timestamptz / ISO / M/D/YYYY) to YYYY-MM-DD.
 * A calendar date is returned as stored. A timestamp uses timeZone when one is passed,
 * otherwise the runtime's local calendar day.
 */
export function ticketDateYmd(raw: unknown, timeZone?: string | null): string {
  if (raw == null || raw === '') return '';
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return timeZone ? isoDateInTimeZone(raw, timeZone) : toLocalYmd(raw);
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (timeZone && /^\d{4}-\d{2}-\d{2}[T\s]/.test(s)) {
    const stamped = new Date(s);
    if (!isNaN(stamped.getTime())) return isoDateInTimeZone(stamped, timeZone);
  }
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const us = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (us) {
    const mm = us[1].padStart(2, '0');
    const dd = us[2].padStart(2, '0');
    return `${us[3]}-${mm}-${dd}`;
  }
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return toLocalYmd(d);
  } catch {
    /* ignore */
  }
  return '';
}

const CLOSED_TICKET = new Set(['completed', 'cancelled', 'canceled', 'complete']);

export function isClosedTicketStatus(status: string | null | undefined): boolean {
  return CLOSED_TICKET.has(String(status || '').trim().toLowerCase());
}

export function isOpenTicket(status: string | null | undefined): boolean {
  return !isClosedTicketStatus(status);
}

export function isCompleteReport(status: string | null | undefined): boolean {
  return String(status || '').trim().toLowerCase() === 'complete';
}

export function isOpenReport(status: string | null | undefined): boolean {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return true;
  return s === 'draft' || s === 'open' || !isCompleteReport(s);
}

export function todaysOpenCalls<T extends { service_date?: unknown; status?: string | null }>(
  tickets: T[],
  today = toLocalYmd(new Date())
): T[] {
  return tickets.filter((t) => isOpenTicket(t.status) && ticketDateYmd(t.service_date) === today);
}

export function upcomingOpenTickets<T extends { service_date?: unknown; status?: string | null }>(
  tickets: T[],
  today = toLocalYmd(new Date()),
  limit = 5,
  timeZone?: string | null
): T[] {
  return tickets
    .filter((t) => isOpenTicket(t.status) && ticketDateYmd(t.service_date, timeZone) >= today)
    .sort((a, b) =>
      ticketDateYmd(a.service_date, timeZone).localeCompare(ticketDateYmd(b.service_date, timeZone))
    )
    .slice(0, limit);
}
