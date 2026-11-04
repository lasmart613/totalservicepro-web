/**
 * Prefill invoices and estimates from a service ticket or a service report.
 * Larry's rule: never retype data we already have. Everything here is pure
 * except the loaders, which read through the caller's Supabase client (RLS).
 */

import {
  loadTicketReportContext,
  normalizeTicketId,
  type TicketReportClient,
  type TicketReportPrefill,
} from '../ticket-service-report.ts';

export type BillingPrefill = {
  ticketId: string;
  ticketNumber: string;
  reportId: string;
  reportNumber: string;
  customerOrganizationId: string | number | null;
  customerName: string;
  customerAddress: string;
  customerCity: string;
  customerState: string;
  customerPhone: string;
  customerEmail: string;
  customerContactName: string;
  equipmentType: string;
  equipmentMake: string;
  equipmentModel: string;
  serialNumber: string;
  pulseCount: string;
  /** Invoice notes: the report's Work Performed, else the ticket problem. */
  description: string;
  /** Estimate issue: ticket problem, else latest report pending issues. */
  issue: string;
  laborHours: number | null;
  laborLines: { description: string; qty: number; unit_price: number }[];
};

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function firstNonEmpty(...values: unknown[]): string {
  for (const v of values) {
    const s = clean(v);
    if (s) return s;
  }
  return '';
}

/** YYYY-MM-DD + n days (UTC math, no zone drift). Empty input → ''. */
export function addDaysIso(date: string, days: number): string {
  const m = clean(date).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const NET_TERMS_DAYS = 30;

/** Net 30 due date from the invoice date. */
export function netDueDate(invoiceDate: string, days = NET_TERMS_DAYS): string {
  return addDaysIso(invoiceDate, days);
}

/** YYYY-MM-DD + n months, clamped to the month end (Jan 31 + 1 → Feb 28/29). */
export function addMonthsIso(date: string, months: number): string {
  const m = clean(date).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m || !Number.isFinite(months)) return '';
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1 + Math.trunc(months);
  const day = Number(m[3]);
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(y, mo, Math.min(day, lastDay)));
  return d.toISOString().slice(0, 10);
}

export const DEFAULT_PM_INTERVAL_MONTHS = 12;

/** Next PM due = date out + PM interval (months, default 12). */
export function nextPmDue(dateOut: string, intervalMonths?: number | null): string {
  const n = Number(intervalMonths);
  return addMonthsIso(dateOut, Number.isFinite(n) && n > 0 ? n : DEFAULT_PM_INTERVAL_MONTHS);
}

/** On-site hours from arrival → departure, rounded up to the quarter hour. */
export function laborHoursFromTimes(arrival: unknown, departure: unknown): number | null {
  const a = Date.parse(clean(arrival));
  const d = Date.parse(clean(departure));
  if (!Number.isFinite(a) || !Number.isFinite(d) || d <= a) return null;
  const hours = (d - a) / 3_600_000;
  if (hours > 24) return null;
  return Math.ceil(hours * 4) / 4;
}

/** First pulse / shot counter in a report's model_parameters. */
export function pulseCountFromParams(params: unknown): string {
  if (!params || typeof params !== 'object') return '';
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (key.startsWith('__')) continue;
    if (!/pulse|shot/i.test(key) || /mode|width|duration|rate/i.test(key)) continue;
    const v = clean(value);
    if (v && /\d/.test(v)) return v;
  }
  return '';
}

export function laborLinesFor(hours: number | null): BillingPrefill['laborLines'] {
  if (hours == null || !(hours > 0)) return [];
  return [{ description: `Labor (${hours} hrs)`, qty: hours, unit_price: 0 }];
}

export type BillingPrefillSource = {
  ticket?: TicketReportPrefill | null;
  /** Raw service_tickets row bits we need beyond the report prefill. */
  ticketRow?: Record<string, unknown> | null;
  report?: Record<string, unknown> | null;
  /** Latest report for the equipment (estimate issue fallback). */
  pendingIssues?: string | null;
};

export function billingPrefill(source: BillingPrefillSource): BillingPrefill | null {
  const t = source.ticket || null;
  const r = source.report || null;
  const row = source.ticketRow || null;
  if (!t && !r) return null;
  const ticketProblem = clean(t?.comments);
  const workPerformed = clean(r?.work_performed);
  const hours = laborHoursFromTimes(row?.arrival_time, row?.departure_time);
  const reportEquip = clean(r?.equipment_name);
  return {
    ticketId: clean(t?.ticketId),
    ticketNumber: firstNonEmpty(t?.ticketNumber, r?.ticket_number),
    reportId: clean(r?.id),
    reportNumber: clean(r?.report_number),
    customerOrganizationId: (t?.customerOrganizationId ?? (r?.customer_organization_id as any) ?? null) || null,
    customerName: firstNonEmpty(r?.customer_name, t?.customerName),
    customerAddress: firstNonEmpty(r?.customer_address, t?.customerAddress),
    customerCity: firstNonEmpty(r?.customer_city, t?.customerCity),
    customerState: firstNonEmpty(r?.customer_state, t?.customerState),
    customerPhone: firstNonEmpty(r?.customer_phone, t?.customerPhone),
    customerEmail: firstNonEmpty(r?.customer_email, t?.customerEmail),
    customerContactName: firstNonEmpty(r?.customer_contact_name, t?.customerContactName),
    equipmentType: firstNonEmpty(r?.equipment_type, t?.equipmentType),
    equipmentMake: clean(t?.equipmentMake),
    equipmentModel: firstNonEmpty(t?.equipmentModel, !t ? reportEquip : ''),
    serialNumber: firstNonEmpty(r?.serial_number, t?.serialNumber),
    pulseCount: pulseCountFromParams(r?.model_parameters),
    description: firstNonEmpty(workPerformed, ticketProblem),
    issue: firstNonEmpty(ticketProblem, source.pendingIssues, r?.pending_issues),
    laborHours: hours,
    laborLines: laborLinesFor(hours),
  };
}

async function one(query: any): Promise<Record<string, unknown> | null> {
  try {
    const res = await query.maybeSingle();
    return res?.error ? null : (res?.data ?? null);
  } catch {
    return null;
  }
}

function sameOrg(a: unknown, b: unknown): boolean {
  if (a == null || a === '' || b == null || b === '') return true;
  return String(a) === String(b);
}

/** Report row through RLS, ignored when it belongs to another shop. */
export async function loadReportForBilling(
  supabase: TicketReportClient,
  reportId: string,
  organizationId?: string | number | null
): Promise<Record<string, unknown> | null> {
  const id = clean(reportId);
  if (!id) return null;
  const row = await one(supabase.from('service_reports').select('*').eq('id', id));
  if (!row || !sameOrg(row.organization_id, organizationId)) return null;
  return row;
}

async function ticketByNumber(
  supabase: TicketReportClient,
  ticketNumber: string,
  organizationId?: string | number | null
): Promise<string> {
  if (!ticketNumber) return '';
  let q = supabase.from('service_tickets').select('id').eq('ticket_number', ticketNumber);
  if (organizationId != null && organizationId !== '') q = q.eq('organization_id', organizationId);
  const row = await one(q.limit(1));
  return normalizeTicketId(row?.id);
}

/**
 * Load everything for /invoices/new?ticketId|reportId or /estimates/new?ticketId.
 * A report wins for what was done; the ticket fills the rest.
 */
export async function loadBillingPrefill(
  supabase: TicketReportClient,
  input: { ticketId?: string | null; reportId?: string | null; organizationId?: string | number | null }
): Promise<BillingPrefill | null> {
  const report = input.reportId
    ? await loadReportForBilling(supabase, input.reportId, input.organizationId)
    : null;
  let ticketId = normalizeTicketId(input.ticketId);
  if (!ticketId && report) {
    ticketId =
      normalizeTicketId(report.ticket_id) ||
      (await ticketByNumber(supabase, clean(report.ticket_number), input.organizationId));
  }
  const ctx = ticketId
    ? await loadTicketReportContext(supabase, ticketId, { organizationId: input.organizationId })
    : null;
  const ticketRow = ticketId
    ? await one(supabase.from('service_tickets').select('arrival_time, departure_time').eq('id', ticketId))
    : null;
  return billingPrefill({
    ticket: ctx?.prefill || null,
    ticketRow,
    report,
    pendingIssues: ctx?.pendingFromLastVisit?.pendingIssues ?? null,
  });
}

/** Set a value only when the field is still empty (never clobber typing). */
export function fillIfEmpty(current: unknown, next: unknown): string {
  return clean(current) ? String(current) : clean(next);
}

export function invoiceFromTicketHref(ticketId: string | number): string {
  return `/invoices/new?ticketId=${encodeURIComponent(String(ticketId))}`;
}

export function invoiceFromReportHref(reportId: string | number): string {
  return `/invoices/new?reportId=${encodeURIComponent(String(reportId))}`;
}

export function estimateFromTicketHref(ticketId: string | number): string {
  return `/estimates/new?ticketId=${encodeURIComponent(String(ticketId))}`;
}
