/**
 * Ticket "Check in": record arrival on the ticket, then open a prefilled
 * Service Report. Uses existing columns only (service_tickets.arrival_time,
 * service_tickets.status). service_reports has no arrival column, so the
 * arrival line is written at the top of the report comments.
 */
import { DEFAULT_ORG_TIMEZONE, isValidTimeZone, timeZoneShortName } from './org-timezone.ts';

export const CHECKED_IN_STATUS = 'On Site';

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

/** Serial to show on a ticket: the ticket's own value, then the linked equipment record. */
export function ticketSerialNumber(
  ticket: Record<string, unknown> | null | undefined,
  equipment?: Record<string, unknown> | null
): string {
  return clean(ticket?.serial_number) || clean(equipment?.serial_number);
}

/** Asset tag when either record carries one (no live column today). */
export function ticketAssetTag(
  ticket: Record<string, unknown> | null | undefined,
  equipment?: Record<string, unknown> | null
): string {
  return clean(ticket?.asset_tag) || clean(equipment?.asset_tag);
}

/** Patch written to service_tickets on check-in. arrival_time is timestamptz. */
export function checkInPatch(now: Date = new Date()): { arrival_time: string; status: string } {
  return { arrival_time: now.toISOString(), status: CHECKED_IN_STATUS };
}

/** e.g. "11/2/2026, 1:05 PM MST" in the org zone. Empty for a missing or bad value. */
export function formatArrival(value: unknown, timeZone?: string | null, locale = 'en-US'): string {
  const text = clean(value);
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  const zone = timeZone && isValidTimeZone(timeZone) ? timeZone : DEFAULT_ORG_TIMEZONE;
  const stamp = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  return `${stamp} ${timeZoneShortName(date, zone)}`;
}

/** Prepend "Arrival: …" to report comments once. */
export function commentsWithArrival(comments: unknown, arrivalLabel: string): string {
  const body = clean(comments);
  if (!arrivalLabel) return body;
  const line = `Arrival: ${arrivalLabel}`;
  if (body.startsWith('Arrival:')) return body;
  return body ? `${line}\n\n${body}` : line;
}

export function checkInReportHref(ticketId: string | number): string {
  return `/reports/new?ticketId=${encodeURIComponent(String(ticketId))}&checkin=1`;
}
