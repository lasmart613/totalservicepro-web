/**
 * Service Report "Work Performed" and "Pending Issues / Watch Items" (000949),
 * plus carry-forward of the last visit's pending issues to the next visit on
 * the same equipment.
 *
 * Scope: always the ticket's own organization. Match by equipment_id first,
 * then by serial number within that organization. Rows from any other org are
 * dropped client-side as well, so RLS gaps can never leak another shop's notes.
 * When 000949 is not applied, PostgREST rejects pending_issues and this returns
 * null (no callout, no prefill).
 */

export type PendingFromLastVisit = {
  reportId: string;
  reportNumber: string | null;
  /** YYYY-MM-DD (date_out, else created_at). Empty when unknown. */
  date: string;
  pendingIssues: string;
};

export type CarryForwardClient = {
  from: (table: string) => { select: (columns: string) => any };
};

const COLUMNS = 'id, organization_id, equipment_id, serial_number, report_number, ticket_id, ticket_number, date_out, created_at, pending_issues';

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function sameId(a: unknown, b: unknown): boolean {
  return clean(a) !== '' && clean(a) === clean(b);
}

function reportDate(row: Record<string, unknown>): string {
  return clean(row.date_out).slice(0, 10) || clean(row.created_at).slice(0, 10);
}

/**
 * Pick the most recent prior report for the equipment. Its pending issues are
 * carried only when non-blank: a later report with blank pending issues means
 * the items were addressed, so nothing is carried.
 */
export function pickPendingFromRows(
  rows: Record<string, unknown>[],
  opts: {
    organizationId: unknown;
    excludeReportIds?: unknown[];
    excludeTicketId?: unknown;
    excludeTicketNumber?: unknown;
  }
): PendingFromLastVisit | null {
  const exclude = new Set((opts.excludeReportIds || []).map(clean).filter(Boolean));
  const candidates = (rows || []).filter((row) => {
    if (!row || !sameId(row.organization_id, opts.organizationId)) return false;
    if (exclude.has(clean(row.id))) return false;
    if (opts.excludeTicketId != null && sameId(row.ticket_id, opts.excludeTicketId)) return false;
    if (opts.excludeTicketNumber != null && sameId(row.ticket_number, opts.excludeTicketNumber)) return false;
    return true;
  });
  candidates.sort((a, b) => {
    const d = reportDate(b).localeCompare(reportDate(a));
    if (d) return d;
    return clean(b.created_at).localeCompare(clean(a.created_at));
  });
  const last = candidates[0];
  if (!last) return null;
  const pendingIssues = clean(last.pending_issues);
  if (!pendingIssues) return null;
  return {
    reportId: clean(last.id),
    reportNumber: clean(last.report_number) || null,
    date: reportDate(last),
    pendingIssues,
  };
}

async function run(build: () => any): Promise<{ data: any[] | null; error: any }> {
  try {
    const res = await build();
    return { data: Array.isArray(res?.data) ? res.data : null, error: res?.error || null };
  } catch (error) {
    return { data: null, error };
  }
}

/** Pending issues from the equipment's last report in the same org, or null. */
export async function loadPendingFromLastVisit(
  supabase: CarryForwardClient,
  input: {
    organizationId: unknown;
    equipmentId?: unknown;
    serialNumber?: unknown;
    excludeReportIds?: unknown[];
    excludeTicketId?: unknown;
    excludeTicketNumber?: unknown;
  }
): Promise<PendingFromLastVisit | null> {
  const org = clean(input.organizationId);
  if (!org) return null;
  const equipmentId = clean(input.equipmentId);
  const serial = clean(input.serialNumber);
  const scoped = (column: string, value: string) =>
    supabase
      .from('service_reports')
      .select(COLUMNS)
      .eq('organization_id', org)
      .eq(column, value)
      .order('created_at', { ascending: false })
      .limit(20);

  let rows: any[] | null = null;
  if (equipmentId) {
    const res = await run(() => scoped('equipment_id', equipmentId));
    if (res.error) return null; // includes 000949 not applied
    if (res.data && res.data.length) rows = res.data;
  }
  if (!rows && serial) {
    const res = await run(() => scoped('serial_number', serial));
    if (res.error) return null;
    rows = res.data;
  }
  if (!rows || !rows.length) return null;
  return pickPendingFromRows(rows, { ...input, organizationId: org });
}

export const PENDING_PREFIX = 'Pending from last visit';

/** "Pending from last visit (2026-10-01): …" */
export function pendingLine(pending: PendingFromLastVisit | null | undefined): string {
  if (!pending || !clean(pending.pendingIssues)) return '';
  const date = pending.date ? ` (${pending.date})` : '';
  return `${PENDING_PREFIX}${date}: ${clean(pending.pendingIssues)}`;
}

/** Prepend the pending line to comments once. */
export function commentsWithPending(comments: unknown, pending: PendingFromLastVisit | null | undefined): string {
  const body = clean(comments);
  const line = pendingLine(pending);
  if (!line) return body;
  if (body.includes(PENDING_PREFIX)) return body;
  return body ? `${line}\n\n${body}` : line;
}
