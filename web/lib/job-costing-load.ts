/**
 * Read-only repair-order cost rows for the active organization.
 * Uses the caller's Supabase client (their JWT and existing RLS). No writes.
 */

import { chunkIds, fetchAllPages } from './supabase/paginate.ts';
import type {
  EstimateSourceRow,
  InvoiceSourceRow,
  LaborSourceRow,
  PartsSourceRow,
  TicketSourceRow,
} from './job-costing.ts';

export type JobCostPage = {
  data?: unknown;
  error?: { message?: string } | null;
};

export type JobCostQuery = {
  select: (columns: string) => JobCostQuery;
  eq: (column: string, value: unknown) => JobCostQuery;
  in: (column: string, values: unknown[]) => JobCostQuery;
  order: (column: string, options?: { ascending?: boolean }) => JobCostQuery;
  range: (from: number, to: number) => PromiseLike<JobCostPage>;
};

export type JobCostClient = {
  from: (table: string) => JobCostQuery;
};

export type JobCostSources = {
  tickets: TicketSourceRow[] | null;
  ticketIssue: string | null;
  labor: LaborSourceRow[] | null;
  laborIssue: string | null;
  wageColumnsPresent: boolean;
  parts: PartsSourceRow[] | null;
  partsIssue: string | null;
  estimates: EstimateSourceRow[] | null;
  estimateIssue: string | null;
  invoices: InvoiceSourceRow[] | null;
  invoiceIssue: string | null;
};

const TICKET_SELECTS = [
  'id, ticket_number, customer_name, status, organization_id, estimate_id, service_date, created_at',
  'id, ticket_number, customer_name, status, organization_id, service_date, created_at',
  'id, ticket_number, customer_name, status, organization_id, created_at',
] as const;

const LABOR_SELECTS = [
  'id, ticket_id, duration_minutes, clock_in, clock_out, engineer_id, hourly_rate, labor_cost, created_at',
  'id, ticket_id, duration_minutes, clock_in, clock_out, engineer_id, created_at',
  'id, ticket_id, duration_minutes, clock_in, clock_out',
] as const;

const PARTS_SELECTS = [
  'id, ticket_id, quantity, unit_cost, part_number, part_name, created_at',
  'id, ticket_id, quantity, unit_cost',
] as const;

const ESTIMATE_SELECTS = [
  'id, estimate_number, status, total, organization_id, approved_ticket_id, approved_ticket_number, estimate_data, created_at',
  'id, estimate_number, status, total, organization_id, estimate_data, created_at',
  'id, status, total, organization_id, created_at',
] as const;

const INVOICE_SELECTS = [
  'id, invoice_number, status, total, organization_id, estimate_id, customer_name, invoice_data, created_at',
  'id, invoice_number, status, total, organization_id, estimate_id, created_at',
  'id, status, total, organization_id, created_at',
] as const;

type Filter =
  | { kind: 'eq'; column: string; value: unknown }
  | { kind: 'in'; column: string; values: unknown[] };

function isMissingTable(message?: string | null): boolean {
  return /relation .* does not exist|could not find the table|Could not find the table|schema cache/i.test(
    String(message || '')
  );
}

function isColumnError(message?: string | null): boolean {
  return /column|schema cache|does not exist/i.test(String(message || ''));
}

function orderColumn(columns: string): string {
  if (/(^|, )created_at(,|$)/.test(columns)) return 'created_at';
  return 'id';
}

function wageColumns(columns: string): boolean {
  return /\bhourly_rate\b/.test(columns) || /\blabor_cost\b/.test(columns);
}

async function selectFiltered(
  client: JobCostClient,
  table: string,
  selects: readonly string[],
  filter: Filter
): Promise<{ rows: unknown[] | null; columns: string; issue: string | null }> {
  let lastError = '';
  for (const columns of selects) {
    const { data, error } = await fetchAllPages<unknown>(async (from, to) => {
      let query = client.from(table).select(columns);
      query =
        filter.kind === 'eq'
          ? query.eq(filter.column, filter.value)
          : query.in(filter.column, filter.values);
      const res = await query.order(orderColumn(columns), { ascending: false }).range(from, to);
      return {
        data: (res.data as unknown[] | null) ?? null,
        error: res.error || null,
      };
    });
    if (!error) return { rows: data, columns, issue: null };
    lastError = error.message || `${table} query failed`;
    if (isMissingTable(lastError) && !/column/i.test(lastError)) {
      return { rows: null, columns: '', issue: lastError };
    }
    if (!isColumnError(lastError)) return { rows: null, columns: '', issue: lastError };
  }
  return { rows: null, columns: '', issue: lastError || `${table} query failed` };
}

async function selectByTicketIds(
  client: JobCostClient,
  table: string,
  ticketIds: Array<string | number>,
  selects: readonly string[]
): Promise<{ rows: unknown[] | null; columns: string; issue: string | null }> {
  if (ticketIds.length === 0) return { rows: [], columns: '', issue: null };

  const rows: unknown[] = [];
  let chosen = '';
  for (const chunk of chunkIds(ticketIds)) {
    const result = await selectFiltered(client, table, chosen ? [chosen] : selects, {
      kind: 'in',
      column: 'ticket_id',
      values: chunk,
    });
    if (result.issue || result.rows == null) return result;
    chosen = result.columns;
    rows.push(...result.rows);
  }
  return { rows, columns: chosen, issue: null };
}

export async function loadJobCostSources(
  client: JobCostClient,
  organizationId: string | number
): Promise<JobCostSources> {
  const tickets = await selectFiltered(client, 'service_tickets', TICKET_SELECTS, {
    kind: 'eq',
    column: 'organization_id',
    value: organizationId,
  });

  if (tickets.issue || tickets.rows == null) {
    return {
      tickets: null,
      ticketIssue: tickets.issue,
      labor: null,
      laborIssue: null,
      wageColumnsPresent: false,
      parts: null,
      partsIssue: null,
      estimates: null,
      estimateIssue: null,
      invoices: null,
      invoiceIssue: null,
    };
  }

  const ticketIds = Array.from(
    new Set(
      (tickets.rows as TicketSourceRow[])
        .map((row) => row.id)
        .filter((id): id is string | number => id != null && id !== '')
    )
  );

  const [labor, parts, estimates, invoices] = await Promise.all([
    selectByTicketIds(client, 'labor_log', ticketIds, LABOR_SELECTS),
    selectByTicketIds(client, 'parts_used', ticketIds, PARTS_SELECTS),
    selectFiltered(client, 'service_estimates', ESTIMATE_SELECTS, {
      kind: 'eq',
      column: 'organization_id',
      value: organizationId,
    }),
    selectFiltered(client, 'service_invoices', INVOICE_SELECTS, {
      kind: 'eq',
      column: 'organization_id',
      value: organizationId,
    }),
  ]);

  return {
    tickets: tickets.rows as TicketSourceRow[],
    ticketIssue: null,
    labor: (labor.rows as LaborSourceRow[] | null) ?? null,
    laborIssue: labor.issue,
    wageColumnsPresent: wageColumns(labor.columns),
    parts: (parts.rows as PartsSourceRow[] | null) ?? null,
    partsIssue: parts.issue,
    estimates: (estimates.rows as EstimateSourceRow[] | null) ?? null,
    estimateIssue: estimates.issue,
    invoices: (invoices.rows as InvoiceSourceRow[] | null) ?? null,
    invoiceIssue: invoices.issue,
  };
}
