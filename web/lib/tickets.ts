/** Shared ticket/report date + status helpers (dashboard, schedule, admin). */

export function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Normalize a DB date (date / timestamptz / ISO / M/D/YYYY) to local YYYY-MM-DD.
 */
export function ticketDateYmd(raw: unknown): string {
  if (raw == null || raw === '') return '';
  if (raw instanceof Date && !isNaN(raw.getTime())) return toLocalYmd(raw);
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
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
  limit = 5
): T[] {
  return tickets
    .filter((t) => isOpenTicket(t.status) && ticketDateYmd(t.service_date) >= today)
    .sort((a, b) => ticketDateYmd(a.service_date).localeCompare(ticketDateYmd(b.service_date)))
    .slice(0, limit);
}
