/**
 * Job cost and margin per repair order, from rows that were actually read.
 * Missing wage, price, or link data stays unavailable. Nothing here is estimated.
 */

export type MoneyFigure = {
  amount: number | null;
  available: boolean;
  reason: string | null;
  source: string;
};

export type HoursFigure = {
  hours: number | null;
  available: boolean;
  reason: string | null;
  source: string;
};

export type RevenueBasis = 'invoice' | 'estimate' | null;

export type RevenueFigure = MoneyFigure & {
  basis: RevenueBasis;
  detail: string | null;
};

export type JobCostRow = {
  ticketId: string;
  ticketNumber: string;
  customer: string;
  status: string;
  serviceDate: string | null;
  laborHours: HoursFigure;
  laborCost: MoneyFigure;
  partsCost: MoneyFigure;
  totalCost: MoneyFigure;
  revenue: RevenueFigure;
  margin: MoneyFigure;
  quotedLabor: MoneyFigure;
  laborEntryCount: number;
  partsLineCount: number;
};

export type JobCostReport = {
  organizationId: string | number | null;
  organizationName: string | null;
  asOfDate: string;
  ticketCount: number | null;
  ticketIssue: string | null;
  laborIssue: string | null;
  partsIssue: string | null;
  estimateIssue: string | null;
  invoiceIssue: string | null;
  wageColumnsPresent: boolean;
  jobs: JobCostRow[];
  rollups: {
    laborHours: HoursFigure;
    laborCost: MoneyFigure;
    partsCost: MoneyFigure;
    totalCost: MoneyFigure;
    revenue: MoneyFigure;
    margin: MoneyFigure;
  };
  figures: ReadonlyArray<{ figure: string; source: string }>;
  inventoryNote: string;
};

export type TicketSourceRow = {
  id?: string | number | null;
  ticket_number?: string | null;
  customer_name?: string | null;
  status?: string | null;
  organization_id?: string | number | null;
  estimate_id?: string | number | null;
  service_date?: string | null;
  created_at?: string | null;
};

export type LaborSourceRow = {
  id?: string | number | null;
  ticket_id?: string | number | null;
  duration_minutes?: number | string | null;
  clock_in?: string | null;
  clock_out?: string | null;
  engineer_id?: string | null;
  hourly_rate?: number | string | null;
  labor_cost?: number | string | null;
};

export type PartsSourceRow = {
  id?: string | number | null;
  ticket_id?: string | number | null;
  quantity?: number | string | null;
  unit_cost?: number | string | null;
  part_number?: string | null;
  part_name?: string | null;
};

export type EstimateSourceRow = {
  id?: string | number | null;
  estimate_number?: string | null;
  status?: string | null;
  total?: number | string | null;
  organization_id?: string | number | null;
  approved_ticket_id?: string | number | null;
  approved_ticket_number?: string | null;
  estimate_data?: unknown;
};

export type InvoiceSourceRow = {
  id?: string | number | null;
  invoice_number?: string | null;
  status?: string | null;
  total?: number | string | null;
  organization_id?: string | number | null;
  estimate_id?: string | number | null;
  customer_name?: string | null;
};

export type JobCostInput = {
  organizationId: string | number | null;
  organizationName: string | null;
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
  asOf?: string;
};

const HOURS_SOURCE =
  'labor_log.duration_minutes when set; otherwise clock_out − clock_in. No labor_log rows means 0 hours.';
const LABOR_COST_SOURCE =
  'labor_log.labor_cost when returned; otherwise hours × labor_log.hourly_rate. Estimate labor rates are not used.';
const PARTS_SOURCE =
  'parts_used.quantity × parts_used.unit_cost. Catalog, vendor, and sale prices are not used.';
const TOTAL_SOURCE = 'Labor cost + parts and materials cost, only when both are available.';
const REVENUE_SOURCE =
  'service_invoices.total for an issued invoice linked through an estimate; otherwise one linked service_estimates.total (a quote).';
const MARGIN_SOURCE = 'Revenue − total cost, only when both are available.';
const QUOTED_SOURCE =
  'service_estimates.estimate_data.labor on linked estimates. A quote, excluded from total cost and margin.';

export const JOB_COST_FIGURES: JobCostReport['figures'] = [
  { figure: 'Labor hours', source: HOURS_SOURCE },
  { figure: 'Labor cost', source: LABOR_COST_SOURCE },
  { figure: 'Parts and materials cost', source: PARTS_SOURCE },
  { figure: 'Total cost', source: TOTAL_SOURCE },
  { figure: 'Revenue', source: REVENUE_SOURCE },
  { figure: 'Margin', source: MARGIN_SOURCE },
  { figure: 'Quoted labor', source: QUOTED_SOURCE },
  {
    figure: 'Repair order link',
    source:
      'service_tickets.estimate_id, service_estimates.approved_ticket_id, service_estimates.approved_ticket_number, and the same fields inside estimate_data.',
  },
];

export const INVENTORY_NOTE =
  'inventory_transactions is not used. Those rows are not written with a repair-order reference, so their unit_cost is not this job’s parts cost.';

const ISSUED_INVOICE = new Set([
  'sent',
  'paid',
  'partially_paid',
  'partial',
  'overdue',
  'unpaid',
  'invoiced',
]);

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function roundHours(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function numOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function idKey(value: unknown): string {
  if (value == null || value === '') return '';
  return String(value);
}

function dataRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function moneyAvailable(amount: number, source: string): MoneyFigure {
  return { amount: roundMoney(amount), available: true, reason: null, source };
}

function moneyUnavailable(reason: string, source: string): MoneyFigure {
  return { amount: null, available: false, reason, source };
}

function hoursAvailable(hours: number, source: string): HoursFigure {
  return { hours: roundHours(hours), available: true, reason: null, source };
}

function hoursUnavailable(reason: string, source: string): HoursFigure {
  return { hours: null, available: false, reason, source };
}

function revenueAvailable(
  amount: number,
  source: string,
  basis: Exclude<RevenueBasis, null>,
  detail: string | null
): RevenueFigure {
  return { ...moneyAvailable(amount, source), basis, detail };
}

function revenueUnavailable(reason: string, source: string): RevenueFigure {
  return { ...moneyUnavailable(reason, source), basis: null, detail: null };
}

function minutesFromClocks(clockIn?: string | null, clockOut?: string | null): number | null {
  if (!clockIn || !clockOut) return null;
  const start = Date.parse(clockIn);
  const end = Date.parse(clockOut);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return (end - start) / 60000;
}

function entryMinutes(row: LaborSourceRow): number | null {
  const stored = numOrNull(row.duration_minutes);
  if (stored != null) return stored;
  return minutesFromClocks(row.clock_in, row.clock_out);
}

function estimateLinksTicket(estimate: EstimateSourceRow, ticket: TicketSourceRow): boolean {
  const ticketId = idKey(ticket.id);
  const ticketNumber = String(ticket.ticket_number || '').trim();
  const estimateId = idKey(estimate.id);
  if (estimateId && idKey(ticket.estimate_id) === estimateId) return true;
  if (ticketId && idKey(estimate.approved_ticket_id) === ticketId) return true;
  const data = dataRecord(estimate.estimate_data);
  if (ticketId && idKey(data.approved_ticket_id) === ticketId) return true;
  if (ticketNumber && String(estimate.approved_ticket_number || '').trim() === ticketNumber) return true;
  if (ticketNumber && String(data.approved_ticket_number || '').trim() === ticketNumber) return true;
  return false;
}

function invoiceStatus(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function laborForTicket(
  rows: LaborSourceRow[] | null,
  ticketId: string,
  wageColumnsPresent: boolean,
  laborIssue: string | null
): { hours: HoursFigure; cost: MoneyFigure; count: number } {
  if (laborIssue || rows == null) {
    const reason = laborIssue || 'labor_log could not be read.';
    return {
      hours: hoursUnavailable(reason, HOURS_SOURCE),
      cost: moneyUnavailable(reason, LABOR_COST_SOURCE),
      count: 0,
    };
  }
  if (!ticketId) {
    const reason = 'This repair order has no id, so labor_log rows cannot be matched.';
    return {
      hours: hoursUnavailable(reason, HOURS_SOURCE),
      cost: moneyUnavailable(reason, LABOR_COST_SOURCE),
      count: 0,
    };
  }

  const mine = rows.filter((row) => idKey(row.ticket_id) === ticketId);
  if (mine.length === 0) {
    return {
      hours: hoursAvailable(0, HOURS_SOURCE),
      cost: wageColumnsPresent
        ? moneyAvailable(0, LABOR_COST_SOURCE)
        : moneyUnavailable(
            'labor_log did not return hourly_rate or labor_cost, so unlogged work cannot be priced as $0.',
            LABOR_COST_SOURCE
          ),
      count: 0,
    };
  }

  let minutes = 0;
  let hoursKnown = true;
  for (const row of mine) {
    const span = entryMinutes(row);
    if (span == null) {
      hoursKnown = false;
      break;
    }
    minutes += span;
  }
  const hours = hoursKnown
    ? hoursAvailable(minutes / 60, HOURS_SOURCE)
    : hoursUnavailable(
        'A labor_log row has no duration_minutes and no clock_out − clock_in span, so hours are not summed from a partial log.',
        HOURS_SOURCE
      );

  if (!wageColumnsPresent) {
    return {
      hours,
      cost: moneyUnavailable(
        'labor_log did not return hourly_rate or labor_cost. Logged hours are not multiplied by an estimate labor rate.',
        LABOR_COST_SOURCE
      ),
      count: mine.length,
    };
  }

  let cost = 0;
  for (const row of mine) {
    const explicit = numOrNull(row.labor_cost);
    if (explicit != null) {
      cost += explicit;
      continue;
    }
    const rate = numOrNull(row.hourly_rate);
    const span = entryMinutes(row);
    if (rate == null || span == null) {
      return {
        hours,
        cost: moneyUnavailable(
          'A labor_log row has neither labor_cost nor hourly_rate, so this repair order’s labor cost is not a partial sum.',
          LABOR_COST_SOURCE
        ),
        count: mine.length,
      };
    }
    cost += (span / 60) * rate;
  }

  return { hours, cost: moneyAvailable(cost, LABOR_COST_SOURCE), count: mine.length };
}

function partsForTicket(
  rows: PartsSourceRow[] | null,
  ticketId: string,
  partsIssue: string | null
): { cost: MoneyFigure; count: number } {
  if (partsIssue || rows == null) {
    return {
      cost: moneyUnavailable(partsIssue || 'parts_used could not be read.', PARTS_SOURCE),
      count: 0,
    };
  }
  if (!ticketId) {
    return {
      cost: moneyUnavailable('This repair order has no id, so parts_used rows cannot be matched.', PARTS_SOURCE),
      count: 0,
    };
  }
  const mine = rows.filter((row) => idKey(row.ticket_id) === ticketId);
  if (mine.length === 0) return { cost: moneyAvailable(0, PARTS_SOURCE), count: 0 };

  let cost = 0;
  for (const row of mine) {
    const qty = numOrNull(row.quantity);
    const unit = numOrNull(row.unit_cost);
    if (qty == null || unit == null) {
      return {
        cost: moneyUnavailable(
          'A parts_used line is missing quantity or unit_cost, so this repair order’s parts cost is not a partial sum.',
          PARTS_SOURCE
        ),
        count: mine.length,
      };
    }
    cost += qty * unit;
  }
  return { cost: moneyAvailable(cost, PARTS_SOURCE), count: mine.length };
}

function quotedLaborFor(estimates: EstimateSourceRow[]): MoneyFigure {
  if (estimates.length === 0) {
    return moneyUnavailable('No estimate is linked to this repair order.', QUOTED_SOURCE);
  }
  let total = 0;
  for (const estimate of estimates) {
    const labor = numOrNull(dataRecord(estimate.estimate_data).labor);
    if (labor == null) {
      return moneyUnavailable(
        'A linked estimate has no estimate_data.labor, so quoted labor is not a partial sum.',
        QUOTED_SOURCE
      );
    }
    total += labor;
  }
  return moneyAvailable(total, QUOTED_SOURCE);
}

function revenueFor(
  ticket: TicketSourceRow,
  estimates: EstimateSourceRow[] | null,
  invoices: InvoiceSourceRow[] | null,
  estimateIssue: string | null,
  invoiceIssue: string | null
): RevenueFigure {
  if (estimateIssue || estimates == null) {
    return revenueUnavailable(estimateIssue || 'service_estimates could not be read.', REVENUE_SOURCE);
  }
  if (invoiceIssue || invoices == null) {
    return revenueUnavailable(invoiceIssue || 'service_invoices could not be read.', REVENUE_SOURCE);
  }

  const linked = estimates.filter((estimate) => estimateLinksTicket(estimate, ticket));
  const linkedIds = new Set(linked.map((estimate) => idKey(estimate.id)).filter(Boolean));
  const issued = invoices.filter((invoice) => {
    const estimateId = idKey(invoice.estimate_id);
    return estimateId && linkedIds.has(estimateId) && ISSUED_INVOICE.has(invoiceStatus(invoice.status));
  });

  if (issued.length > 0) {
    let total = 0;
    const numbers: string[] = [];
    for (const invoice of issued) {
      const amount = numOrNull(invoice.total);
      if (amount == null) {
        return revenueUnavailable(
          'An issued invoice linked to this repair order has no total, so revenue is not a partial sum.',
          'service_invoices.total'
        );
      }
      total += amount;
      numbers.push(String(invoice.invoice_number || invoice.id || 'invoice'));
    }
    return revenueAvailable(total, 'service_invoices.total', 'invoice', numbers.join(', '));
  }

  if (linked.length === 0) {
    return revenueUnavailable(
      'No issued invoice or estimate is linked to this repair order. Invoices are not matched by customer name.',
      REVENUE_SOURCE
    );
  }
  if (linked.length > 1) {
    return revenueUnavailable(
      'More than one estimate is linked and no issued invoice total is stored, so revenue is not summed from quotes.',
      'service_estimates.total'
    );
  }
  const amount = numOrNull(linked[0].total);
  if (amount == null) {
    return revenueUnavailable('The linked estimate has no total.', 'service_estimates.total');
  }
  const number = String(linked[0].estimate_number || linked[0].id || 'estimate');
  return revenueAvailable(amount, 'service_estimates.total', 'estimate', `${number} (quote)`);
}

function combineCost(labor: MoneyFigure, parts: MoneyFigure): MoneyFigure {
  if (!labor.available || labor.amount == null) {
    return moneyUnavailable(labor.reason || 'Labor cost is unavailable.', TOTAL_SOURCE);
  }
  if (!parts.available || parts.amount == null) {
    return moneyUnavailable(parts.reason || 'Parts cost is unavailable.', TOTAL_SOURCE);
  }
  return moneyAvailable(labor.amount + parts.amount, TOTAL_SOURCE);
}

function marginFor(revenue: RevenueFigure, total: MoneyFigure): MoneyFigure {
  if (!revenue.available || revenue.amount == null) {
    return moneyUnavailable(revenue.reason || 'Revenue is unavailable.', MARGIN_SOURCE);
  }
  if (!total.available || total.amount == null) {
    return moneyUnavailable(total.reason || 'Total cost is unavailable.', MARGIN_SOURCE);
  }
  return moneyAvailable(revenue.amount - total.amount, MARGIN_SOURCE);
}

function sumMoney(rows: MoneyFigure[], source: string, empty: number): MoneyFigure {
  if (rows.length === 0) return moneyAvailable(empty, source);
  if (rows.some((row) => !row.available || row.amount == null)) {
    return moneyUnavailable(
      'At least one repair order is missing this figure, so the shop total is not a partial sum.',
      source
    );
  }
  return moneyAvailable(
    rows.reduce((sum, row) => sum + (row.amount || 0), 0),
    source
  );
}

function sumHours(rows: HoursFigure[]): HoursFigure {
  if (rows.length === 0) return hoursAvailable(0, HOURS_SOURCE);
  if (rows.some((row) => !row.available || row.hours == null)) {
    return hoursUnavailable(
      'At least one repair order is missing labor hours, so the shop total is not a partial sum.',
      HOURS_SOURCE
    );
  }
  return hoursAvailable(
    rows.reduce((sum, row) => sum + (row.hours || 0), 0),
    HOURS_SOURCE
  );
}

function asOfDate(value?: string): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date().toISOString().slice(0, 10);
}

export function assembleJobCostReport(input: JobCostInput): JobCostReport {
  const base = {
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    asOfDate: asOfDate(input.asOf),
    ticketIssue: input.ticketIssue,
    laborIssue: input.laborIssue,
    partsIssue: input.partsIssue,
    estimateIssue: input.estimateIssue,
    invoiceIssue: input.invoiceIssue,
    wageColumnsPresent: input.wageColumnsPresent,
    figures: JOB_COST_FIGURES,
    inventoryNote: INVENTORY_NOTE,
  };

  if (input.ticketIssue || input.tickets == null) {
    const reason = input.ticketIssue || 'service_tickets could not be read.';
    return {
      ...base,
      ticketCount: null,
      jobs: [],
      rollups: {
        laborHours: hoursUnavailable(reason, HOURS_SOURCE),
        laborCost: moneyUnavailable(reason, LABOR_COST_SOURCE),
        partsCost: moneyUnavailable(reason, PARTS_SOURCE),
        totalCost: moneyUnavailable(reason, TOTAL_SOURCE),
        revenue: moneyUnavailable(reason, REVENUE_SOURCE),
        margin: moneyUnavailable(reason, MARGIN_SOURCE),
      },
    };
  }

  const jobs = input.tickets.map((ticket) => {
    const ticketId = idKey(ticket.id);
    const labor = laborForTicket(input.labor, ticketId, input.wageColumnsPresent, input.laborIssue);
    const parts = partsForTicket(input.parts, ticketId, input.partsIssue);
    const totalCost = combineCost(labor.cost, parts.cost);
    const linked =
      input.estimates?.filter((estimate) => estimateLinksTicket(estimate, ticket)) ?? [];
    const revenue = revenueFor(
      ticket,
      input.estimates,
      input.invoices,
      input.estimateIssue,
      input.invoiceIssue
    );
    return {
      ticketId,
      ticketNumber: String(ticket.ticket_number || ticketId || '—'),
      customer: String(ticket.customer_name || '').trim() || '—',
      status: String(ticket.status || '').trim() || '—',
      serviceDate: ticket.service_date ? String(ticket.service_date).slice(0, 10) : null,
      laborHours: labor.hours,
      laborCost: labor.cost,
      partsCost: parts.cost,
      totalCost,
      revenue,
      margin: marginFor(revenue, totalCost),
      quotedLabor:
        input.estimateIssue || input.estimates == null
          ? moneyUnavailable(input.estimateIssue || 'service_estimates could not be read.', QUOTED_SOURCE)
          : quotedLaborFor(linked),
      laborEntryCount: labor.count,
      partsLineCount: parts.count,
    } satisfies JobCostRow;
  });

  jobs.sort((a, b) => {
    const date = String(b.serviceDate || '').localeCompare(String(a.serviceDate || ''));
    if (date) return date;
    return a.ticketNumber.localeCompare(b.ticketNumber);
  });

  return {
    ...base,
    ticketCount: jobs.length,
    jobs,
    rollups: {
      laborHours: sumHours(jobs.map((job) => job.laborHours)),
      laborCost: sumMoney(jobs.map((job) => job.laborCost), LABOR_COST_SOURCE, 0),
      partsCost: sumMoney(jobs.map((job) => job.partsCost), PARTS_SOURCE, 0),
      totalCost: sumMoney(jobs.map((job) => job.totalCost), TOTAL_SOURCE, 0),
      revenue: sumMoney(jobs.map((job) => job.revenue), REVENUE_SOURCE, 0),
      margin: sumMoney(jobs.map((job) => job.margin), MARGIN_SOURCE, 0),
    },
  };
}
