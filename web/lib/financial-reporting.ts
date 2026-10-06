/**
 * Shop financial figures from rows already stored for the active organization.
 * Amounts are summed from those rows. A metric with no column or table is
 * marked unavailable and has no amount.
 */

import { money2, parseInvoiceData } from './billing/apply-invoice-payment.ts';
import { resolveOrgMoneyPrefs } from './money-format.ts';
import { DEFAULT_ORG_TIMEZONE, isoDateInTimeZone, isValidTimeZone, timeZoneShortName } from './org-timezone.ts';

export type InvoiceSourceRow = {
  id?: string | number | null;
  invoice_number?: string | null;
  status?: string | null;
  customer_name?: string | null;
  total?: number | string | null;
  subtotal?: number | string | null;
  tax?: number | string | null;
  amount_paid?: number | string | null;
  paid_at?: string | null;
  payment_method?: string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  created_at?: string | null;
  invoice_data?: unknown;
};

export type PurchaseOrderSourceRow = {
  id?: string | number | null;
  po_number?: string | null;
  status?: string | null;
  supplier_name?: string | null;
  total?: number | string | null;
  po_date?: string | null;
  created_at?: string | null;
};

export type EstimateSourceRow = {
  id?: string | number | null;
  estimate_number?: string | null;
  status?: string | null;
  customer_name?: string | null;
  total?: number | string | null;
  created_at?: string | null;
};

export type InvoiceColumnFlags = {
  amount_paid: boolean;
  payment_method: boolean;
  paid_at: boolean;
  tax: boolean;
  due_date: boolean;
  invoice_date: boolean;
  invoice_data: boolean;
  total: boolean;
};

export const EMPTY_INVOICE_COLUMNS: InvoiceColumnFlags = {
  amount_paid: false,
  payment_method: false,
  paid_at: false,
  tax: false,
  due_date: false,
  invoice_date: false,
  invoice_data: false,
  total: false,
};

export type FinancialMetric = {
  id: string;
  label: string;
  source: string;
  availability: 'available' | 'unavailable';
  amount?: number;
  count?: number;
  note?: string;
  reason?: string;
};

export type OutstandingInvoice = {
  id: string;
  number: string;
  customer: string;
  status: string;
  total: number;
  amountPaid: number;
  balance: number;
  invoiceDate: string | null;
  dueDate: string | null;
};

export type UnpricedInvoice = {
  id: string;
  number: string;
  customer: string;
  status: string;
  reason: string;
};

export type PaymentMethodTotal = {
  method: string;
  amount: number;
  count: number;
  source: string;
};

export type AgingBucket = {
  id: string;
  label: string;
  amount: number;
  count: number;
  source: string;
};

export type MoneyKpi = {
  id: string;
  label: string;
  availability: 'available' | 'unavailable';
  amount?: number;
  count?: number;
  note?: string;
  reason?: string;
  /** Prior-period amount, when this KPI is a comparison. */
  compareAmount?: number;
  /** Percent change versus compareAmount. Null when the prior period is zero. */
  deltaPercent?: number | null;
};

export type MonthlyRevenuePoint = {
  month: string;
  amount: number;
};

export type FinancialSummary = {
  kpis: MoneyKpi[];
  monthlyRevenue: MonthlyRevenuePoint[] | null;
  monthlyRevenueReason: string | null;
  collectedThisMonth: number | null;
  outstandingAmount: number | null;
};

export type FinancialReport = {
  organizationId: string | null;
  organizationName: string | null;
  currencyCode: string;
  numberFormat: string;
  /** False on the free plan: line-item tables are omitted. */
  detailIncluded: boolean;
  generatedAt: string;
  asOfDate: string;
  /** IANA zone used for the as-of date and timestamp payment days. */
  timeZone: string;
  /** Short name such as PDT, shown next to the as-of date. */
  timeZoneLabel: string;
  invoiceRowCount: number | null;
  purchaseOrderRowCount: number | null;
  estimateRowCount: number | null;
  summary: FinancialSummary;
  metrics: FinancialMetric[];
  outstanding: OutstandingInvoice[];
  unpricedInvoices: UnpricedInvoice[];
  paymentMethods: PaymentMethodTotal[];
  aging: AgingBucket[] | null;
  agingReason: string | null;
};

const CLOSED_ESTIMATE = new Set([
  'invoiced',
  'approved',
  'accepted',
  'expired',
  'rejected',
  'declined',
  'cancelled',
  'canceled',
  'completed',
]);

const PAYMENT_METHOD_SOURCE =
  'Payment method, or Stripe when a checkout was used and no method is recorded';

export function invoiceColumnFlags(select: string): InvoiceColumnFlags {
  const names = new Set(
    select
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  );
  return {
    amount_paid: names.has('amount_paid'),
    payment_method: names.has('payment_method'),
    paid_at: names.has('paid_at'),
    tax: names.has('tax'),
    due_date: names.has('due_date'),
    invoice_date: names.has('invoice_date'),
    invoice_data: names.has('invoice_data'),
    total: names.has('total'),
  };
}

function ymd(value: unknown): string | null {
  if (value == null || value === '') return null;
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? money2(n) : null;
}

function centsOf(value: number): number {
  return Math.round(money2(value) * 100);
}

function fromCents(cents: number): number {
  return money2(cents / 100);
}

function statusOf(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function isVoidStatus(status: string): boolean {
  return status === 'void' || status === 'cancelled' || status === 'canceled';
}

function isDraftStatus(status: string): boolean {
  return status === 'draft';
}

function invoiceData(row: InvoiceSourceRow, columns: InvoiceColumnFlags): Record<string, unknown> {
  if (!columns.invoice_data && row.invoice_data == null) return {};
  return parseInvoiceData(row.invoice_data);
}

function recordedPayment(
  row: InvoiceSourceRow,
  columns: InvoiceColumnFlags
): { known: boolean; amount: number } {
  const data = invoiceData(row, columns);
  if (columns.amount_paid) {
    const fromCol = num(row.amount_paid);
    if (fromCol != null && fromCol > 0) return { known: true, amount: fromCol };
  }
  if (Object.prototype.hasOwnProperty.call(data, 'deposit') && data.deposit != null && data.deposit !== '') {
    const deposit = num(data.deposit);
    if (deposit != null) return { known: true, amount: Math.max(0, deposit) };
  }
  if (columns.amount_paid && num(row.amount_paid) === 0) return { known: true, amount: 0 };
  return { known: false, amount: 0 };
}

/** Date-only values stay on that calendar day. Timestamps use the organization zone. */
function calendarDay(value: unknown, timeZone: string): string | null {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/[T\s]/.test(text.slice(10))) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) return isoDateInTimeZone(date, timeZone);
  }
  return ymd(text);
}

function paymentDate(row: InvoiceSourceRow, columns: InvoiceColumnFlags, timeZone: string): string | null {
  if (columns.paid_at) {
    const paid = calendarDay(row.paid_at, timeZone);
    if (paid) return paid;
  }
  const data = invoiceData(row, columns);
  return calendarDay(data.last_payment_at, timeZone) || calendarDay(data.depositDate, timeZone);
}

function paymentMethod(row: InvoiceSourceRow, columns: InvoiceColumnFlags): string {
  const data = invoiceData(row, columns);
  let method = columns.payment_method ? String(row.payment_method || '').trim() : '';
  if (!method) method = String(data.last_payment_method || data.depositMethod || '').trim();
  if (!method) {
    const ids = data.stripe_checkout_session_ids;
    if (String(data.stripe_checkout_session_id || '').trim() || (Array.isArray(ids) && ids.length > 0)) {
      return 'Stripe';
    }
    return '';
  }
  return /^stripe$/i.test(method) ? 'Stripe' : method;
}

function docNumber(row: InvoiceSourceRow, columns: InvoiceColumnFlags): string {
  if (row.invoice_number) return String(row.invoice_number);
  const data = invoiceData(row, columns);
  const fromData = data.invoice_number || data.invNumber;
  if (fromData) return String(fromData);
  return row.id == null ? '' : `#${row.id}`;
}

function available(input: {
  id: string;
  label: string;
  source: string;
  amount: number;
  count?: number;
  note?: string;
}): FinancialMetric {
  return {
    id: input.id,
    label: input.label,
    source: input.source,
    availability: 'available',
    amount: input.amount,
    count: input.count,
    note: input.note,
  };
}

function unavailable(id: string, label: string, source: string, reason: string): FinancialMetric {
  return { id, label, source, availability: 'unavailable', reason };
}

/** Table and column names stay in the log. The report shows a plain sentence. */
function plainDiagnostic(raw: string | null | undefined, fallback: string): string | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (/[a-z][a-z0-9]*_[a-z0-9_]+|schema cache|does not exist|could not find the/i.test(text)) {
    console.warn('[financial-reporting]', text);
    return fallback;
  }
  return text;
}

function ageBucket(due: string | null, asOf: string): string {
  if (!due) return 'no_due_date';
  if (due >= asOf) return 'not_yet_due';
  const days = Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86400000);
  if (days <= 30) return '1_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  return 'over_90';
}

const AGING_LABELS: { id: string; label: string }[] = [
  { id: 'not_yet_due', label: 'Not yet due' },
  { id: '1_30', label: '1–30 days past due' },
  { id: '31_60', label: '31–60 days past due' },
  { id: '61_90', label: '61–90 days past due' },
  { id: 'over_90', label: 'Over 90 days past due' },
  { id: 'no_due_date', label: 'No due date' },
];

function isPoCommitment(status: string): boolean {
  if (!status || status === 'draft') return false;
  return !isVoidStatus(status);
}

function isOpenEstimate(status: string): boolean {
  return !CLOSED_ESTIMATE.has(status);
}

function shiftMonth(ym: string, delta: number): string {
  const [year, month] = ym.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  return next.toISOString().slice(0, 7);
}

function deltaPercent(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export function assembleFinancialReport(input: {
  organizationId: string | number | null;
  organizationName?: string | null;
  currencyCode?: string | null;
  numberFormat?: string | null;
  asOf?: Date;
  invoices: InvoiceSourceRow[] | null;
  invoiceIssue?: string | null;
  invoiceColumns: InvoiceColumnFlags;
  purchaseOrders: PurchaseOrderSourceRow[] | null;
  purchaseOrderIssue?: string | null;
  estimates: EstimateSourceRow[] | null;
  estimateIssue?: string | null;
  timeZone?: string | null;
}): FinancialReport {
  const asOf = input.asOf || new Date();
  const requestedZone = String(input.timeZone || '').trim();
  const timeZone = requestedZone && isValidTimeZone(requestedZone) ? requestedZone : DEFAULT_ORG_TIMEZONE;
  const asOfDate = isoDateInTimeZone(asOf, timeZone);
  const timeZoneLabel = timeZoneShortName(asOf, timeZone);
  const month = asOfDate.slice(0, 7);
  const lastMonth = shiftMonth(month, -1);
  const moneyPrefs = resolveOrgMoneyPrefs({
    currencyCode: input.currencyCode,
    numberFormat: input.numberFormat,
  });
  const columns = input.invoiceColumns;
  const invoiceIssue = plainDiagnostic(input.invoiceIssue, 'Invoices could not be read.');
  const purchaseOrderIssue = plainDiagnostic(input.purchaseOrderIssue, 'Purchase orders could not be read.');
  const estimateIssue = plainDiagnostic(input.estimateIssue, 'Estimates could not be read.');
  const invoicesKnown = input.invoices != null && !invoiceIssue;

  let billedCents = 0;
  let billedCount = 0;
  let collectedCents = 0;
  let collectedCount = 0;
  let collectedUndatedCents = 0;
  let collectedUndatedCount = 0;
  let monthBilledCents = 0;
  let monthBilledCount = 0;
  let monthBilledUndated = 0;
  let monthCollectedCents = 0;
  let monthCollectedCount = 0;
  let draftCents = 0;
  let draftCount = 0;
  let taxCents = 0;
  let taxNulls = 0;
  let taxKnown = 0;
  let outstandingCents = 0;
  let voidedPaymentCents = 0;
  let voidedPaymentCount = 0;
  let stripeCents = 0;
  let stripeCount = 0;
  let unknownPaid = 0;
  let draftPayments = 0;
  let pricedBilledCount = 0;
  let lastMonthBilledCents = 0;
  let paidInvoiceCents = 0;
  let paidInvoiceCount = 0;
  const monthlyBilled = new Map<string, number>();
  const outstanding: OutstandingInvoice[] = [];
  const unpriced: UnpricedInvoice[] = [];
  const methods = new Map<string, { cents: number; count: number }>();
  const agingCents = new Map<string, { cents: number; count: number }>();

  if (invoicesKnown) {
    for (const row of input.invoices || []) {
      const status = statusOf(row.status);
      const total = columns.total || row.total != null ? num(row.total) : null;
      const paid = recordedPayment(row, columns);
      const voided = isVoidStatus(status);
      const draft = isDraftStatus(status);

      if (voided) {
        if (paid.known && paid.amount > 0) {
          voidedPaymentCents += centsOf(paid.amount);
          voidedPaymentCount += 1;
        }
        continue;
      }

      if (draft) {
        draftCount += 1;
        if (total != null) draftCents += centsOf(total);
        if (paid.known && paid.amount > 0) {
          collectedCents += centsOf(paid.amount);
          collectedCount += 1;
          draftPayments += 1;
          const method = paymentMethod(row, columns) || 'Not recorded';
          const bucket = methods.get(method) || { cents: 0, count: 0 };
          bucket.cents += centsOf(paid.amount);
          bucket.count += 1;
          methods.set(method, bucket);
          if (method === 'Stripe') {
            stripeCents += centsOf(paid.amount);
            stripeCount += 1;
          }
        }
        continue;
      }

      billedCount += 1;
      if (total != null) {
        billedCents += centsOf(total);
        pricedBilledCount += 1;
        if (paid.known && paid.amount > 0 && centsOf(total) <= centsOf(paid.amount)) {
          paidInvoiceCents += centsOf(total);
          paidInvoiceCount += 1;
        }
      } else {
        unpriced.push({
          id: String(row.id ?? ''),
          number: docNumber(row, columns),
          customer: String(row.customer_name || '').trim() || 'Customer name not recorded',
          status: status || 'blank',
          reason: 'Invoice total is empty',
        });
      }

      if (columns.invoice_date) {
        const invoiceDay = ymd(row.invoice_date);
        if (!invoiceDay) monthBilledUndated += 1;
        else if (total != null) {
          const ym = invoiceDay.slice(0, 7);
          monthlyBilled.set(ym, (monthlyBilled.get(ym) || 0) + centsOf(total));
          if (ym === month) {
            monthBilledCents += centsOf(total);
            monthBilledCount += 1;
          } else if (ym === lastMonth) {
            lastMonthBilledCents += centsOf(total);
          }
        }
      }

      if (columns.tax) {
        const tax = num(row.tax);
        if (tax == null) taxNulls += 1;
        else {
          taxCents += centsOf(tax);
          taxKnown += 1;
        }
      }

      if (!paid.known) {
        unknownPaid += 1;
        unpriced.push({
          id: String(row.id ?? ''),
          number: docNumber(row, columns),
          customer: String(row.customer_name || '').trim() || 'Customer name not recorded',
          status: status || 'blank',
          reason: 'No recorded payment and no deposit',
        });
      } else if (paid.amount > 0) {
        collectedCents += centsOf(paid.amount);
        collectedCount += 1;
        const method = paymentMethod(row, columns) || 'Not recorded';
        const bucket = methods.get(method) || { cents: 0, count: 0 };
        bucket.cents += centsOf(paid.amount);
        bucket.count += 1;
        methods.set(method, bucket);
        if (method === 'Stripe') {
          stripeCents += centsOf(paid.amount);
          stripeCount += 1;
        }
        const paidDay = paymentDate(row, columns, timeZone);
        if (!paidDay) {
          collectedUndatedCents += centsOf(paid.amount);
          collectedUndatedCount += 1;
        } else if (paidDay.startsWith(month)) {
          monthCollectedCents += centsOf(paid.amount);
          monthCollectedCount += 1;
        }
      }

      if (total == null || !paid.known) continue;
      const balanceCents = Math.max(0, centsOf(total) - centsOf(paid.amount));
      if (balanceCents <= 0) continue;
      const balance = fromCents(balanceCents);
      outstandingCents += balanceCents;
      const due = columns.due_date ? ymd(row.due_date) : null;
      outstanding.push({
        id: String(row.id ?? ''),
        number: docNumber(row, columns),
        customer: String(row.customer_name || '').trim() || 'Customer name not recorded',
        status: status || 'blank',
        total,
        amountPaid: paid.amount,
        balance,
        invoiceDate: columns.invoice_date ? ymd(row.invoice_date) : null,
        dueDate: due,
      });
      if (columns.due_date) {
        const key = ageBucket(due, asOfDate);
        const bucket = agingCents.get(key) || { cents: 0, count: 0 };
        bucket.cents += balanceCents;
        bucket.count += 1;
        agingCents.set(key, bucket);
      }
    }
  }

  outstanding.sort((a, b) => b.balance - a.balance || String(a.dueDate || '').localeCompare(String(b.dueDate || '')));

  const paymentMethods: PaymentMethodTotal[] = [...methods.entries()]
    .map(([method, bucket]) => ({
      method,
      amount: fromCents(bucket.cents),
      count: bucket.count,
      source: PAYMENT_METHOD_SOURCE,
    }))
    .sort((a, b) => b.amount - a.amount || a.method.localeCompare(b.method));

  const metrics: FinancialMetric[] = [];

  if (!invoicesKnown) {
    const reason = invoiceIssue || 'Invoices could not be read';
    metrics.push(
      unavailable('billed_income', 'Billed income', 'Issued invoice total', reason),
      unavailable(
        'cash_collected',
        'Cash collected',
        'Recorded payment or the deposit saved on the invoice',
        reason
      ),
      unavailable(
        'outstanding_balance',
        'Outstanding unpaid invoices',
        'Issued invoice total minus the recorded payment',
        reason
      ),
      unavailable('draft_invoices', 'Unissued draft invoices', 'Draft invoice total', reason),
      unavailable('sales_tax', 'Sales tax on issued invoices', 'Tax collected', reason),
      unavailable('billed_this_month', 'Billed this month', 'Invoice date and total', reason),
      unavailable(
        'collected_this_month',
        'Cash collected this month',
        'Payment date, or the deposit date saved on the invoice',
        reason
      ),
      unavailable('stripe_processed', 'Stripe-processed collections', PAYMENT_METHOD_SOURCE, reason),
      unavailable(
        'voided_payments',
        'Payments recorded on voided invoices',
        'Payments recorded on voided or cancelled invoices',
        reason
      )
    );
  } else {
    const paymentSource = columns.amount_paid
      ? 'Recorded payment, or the deposit saved on the invoice when the payment amount is empty'
      : 'Deposit saved on the invoice (the payment amount column was not returned)';
    const collectedAvailable = columns.amount_paid || columns.invoice_data;
    metrics.push(
      available({
        id: 'billed_income',
        label: 'Billed income',
        source: 'Issued invoice total',
        amount: fromCents(billedCents),
        count: billedCount,
        note:
          unpriced.some((row) => row.reason.startsWith('Invoice total'))
            ? 'Issued invoices with an empty total were counted and omitted from the amount.'
            : undefined,
      })
    );

    if (!collectedAvailable) {
      metrics.push(
        unavailable(
          'cash_collected',
          'Cash collected',
          'Recorded payment or the deposit saved on the invoice',
          'Payment amounts were not returned, so collected cash cannot be read.'
        )
      );
    } else {
      const notes: string[] = [];
      if (unknownPaid > 0) {
        notes.push(
          `${unknownPaid} issued invoice${unknownPaid === 1 ? '' : 's'} have no recorded payment and no deposit, so they are not included in cash collected.`
        );
      }
      if (draftPayments > 0) {
        notes.push('Includes payments recorded on draft invoices.');
      }
      metrics.push(
        available({
          id: 'cash_collected',
          label: 'Cash collected',
          source: paymentSource,
          amount: fromCents(collectedCents),
          count: collectedCount,
          note: notes.join(' ') || undefined,
        })
      );
    }

    metrics.push(
      available({
        id: 'outstanding_balance',
        label: 'Outstanding unpaid invoices',
        source: 'Issued invoice total minus the recorded payment',
        amount: fromCents(outstandingCents),
        count: outstanding.length,
        note:
          unknownPaid > 0
            ? 'Invoices with no recorded payment amount are listed separately and are not given a guessed balance.'
            : undefined,
      })
    );

    metrics.push(
      available({
        id: 'draft_invoices',
        label: 'Unissued draft invoices',
        source: 'Draft invoice total',
        amount: fromCents(draftCents),
        count: draftCount,
        note: 'Drafts are not counted as billed income or accounts receivable.',
      })
    );

    if (!columns.tax) {
      metrics.push(
        unavailable(
          'sales_tax',
          'Sales tax on issued invoices',
          'Tax collected',
          'The tax amount was not returned.'
        )
      );
    } else if (taxKnown === 0 && taxNulls > 0) {
      metrics.push(
        unavailable(
          'sales_tax',
          'Sales tax on issued invoices',
          'Tax collected',
          'Tax is empty on every issued invoice.'
        )
      );
    } else {
      metrics.push(
        available({
          id: 'sales_tax',
          label: 'Sales tax on issued invoices',
          source: 'Tax collected',
          amount: fromCents(taxCents),
          count: taxKnown,
          note:
            taxNulls > 0
              ? `${taxNulls} issued invoice${taxNulls === 1 ? '' : 's'} have no tax amount and were not added.`
              : 'Tax stored on the invoice. Partial payments are not allocated to tax.',
        })
      );
    }

    if (!columns.invoice_date) {
      metrics.push(
        unavailable(
          'billed_this_month',
          'Billed this month',
          'Invoice date',
          'The invoice date was not returned, so this month cannot be split out.'
        )
      );
    } else {
      metrics.push(
        available({
          id: 'billed_this_month',
          label: 'Billed this month',
          source: 'Invoice date and total',
          amount: fromCents(monthBilledCents),
          count: monthBilledCount,
          note:
            monthBilledUndated > 0
              ? `${monthBilledUndated} issued invoice${monthBilledUndated === 1 ? '' : 's'} have no invoice date and are excluded from this month.`
              : `Month ${month}.`,
        })
      );
    }

    if (!collectedAvailable) {
      metrics.push(
        unavailable(
          'collected_this_month',
          'Cash collected this month',
          'Payment date',
          'Collected cash itself is unavailable.'
        )
      );
    } else if (!columns.paid_at && !columns.invoice_data) {
      metrics.push(
        unavailable(
          'collected_this_month',
          'Cash collected this month',
          'Payment date, or the deposit date saved on the invoice',
          'No payment date was returned.'
        )
      );
    } else {
      metrics.push(
        available({
          id: 'collected_this_month',
          label: 'Cash collected this month',
          source: 'Payment date, or the deposit date saved on the invoice',
          amount: fromCents(monthCollectedCents),
          count: monthCollectedCount,
          note:
            collectedUndatedCount > 0
              ? `${fromCents(collectedUndatedCents).toFixed(2)} collected across ${collectedUndatedCount} payment${collectedUndatedCount === 1 ? '' : 's'} has no payment date and is excluded from this month.`
              : `Month ${month}. Uses the payment date, not the invoice date.`,
        })
      );
    }

    if (!collectedAvailable) {
      metrics.push(
        unavailable('stripe_processed', 'Stripe-processed collections', PAYMENT_METHOD_SOURCE, 'Collected cash is unavailable.')
      );
    } else {
      metrics.push(
        available({
          id: 'stripe_processed',
          label: 'Stripe-processed collections',
          source: PAYMENT_METHOD_SOURCE,
          amount: fromCents(stripeCents),
          count: stripeCount,
          note: 'Processor fees and payout timing are not stored.',
        })
      );
    }

    metrics.push(
      available({
        id: 'voided_payments',
        label: 'Payments recorded on voided invoices',
        source: 'Payments recorded on voided or cancelled invoices',
        amount: fromCents(voidedPaymentCents),
        count: voidedPaymentCount,
        note: 'Excluded from billed income, cash collected, and outstanding. Refunds are not stored separately.',
      })
    );
  }

  if (input.purchaseOrders == null || purchaseOrderIssue) {
    const reason = purchaseOrderIssue || 'Purchase orders could not be read.';
    metrics.push(
      unavailable(
        'po_commitments',
        'Purchase-order commitments',
        'Purchase order total for orders that are not drafts or cancelled',
        reason
      ),
      unavailable('po_drafts', 'Draft purchase orders', 'Draft purchase order total', reason)
    );
  } else {
    let commitCents = 0;
    let commitCount = 0;
    let draftPoCents = 0;
    let draftPoCount = 0;
    for (const row of input.purchaseOrders) {
      const status = statusOf(row.status);
      const total = num(row.total);
      if (isDraftStatus(status) || !status) {
        draftPoCount += 1;
        if (total != null) draftPoCents += centsOf(total);
        continue;
      }
      if (!isPoCommitment(status)) continue;
      commitCount += 1;
      if (total != null) commitCents += centsOf(total);
    }
    metrics.push(
      available({
        id: 'po_commitments',
        label: 'Purchase-order commitments',
        source: 'Purchase order total for sent and other open orders',
        amount: fromCents(commitCents),
        count: commitCount,
        note: 'This is the recorded order total, not cash paid to the supplier.',
      }),
      available({
        id: 'po_drafts',
        label: 'Draft purchase orders',
        source: 'Draft purchase order total',
        amount: fromCents(draftPoCents),
        count: draftPoCount,
      })
    );
  }

  let pipelineCents = 0;
  let pipelineCount = 0;
  const estimatesKnown = input.estimates != null && !estimateIssue;
  if (!estimatesKnown) {
    metrics.push(
      unavailable(
        'estimate_pipeline',
        'Open estimate pipeline',
        'Open estimate total',
        estimateIssue || 'Estimates could not be read.'
      )
    );
  } else {
    for (const row of input.estimates || []) {
      if (!isOpenEstimate(statusOf(row.status))) continue;
      pipelineCount += 1;
      const total = num(row.total);
      if (total != null) pipelineCents += centsOf(total);
    }
    metrics.push(
      available({
        id: 'estimate_pipeline',
        label: 'Open estimate pipeline',
        source: 'Open estimate total',
        amount: fromCents(pipelineCents),
        count: pipelineCount,
        note: 'Pipeline only. Not income and not cash.',
      })
    );
  }

  metrics.push(
    unavailable(
      'cash_paid_out',
      'Cash paid to suppliers',
      'Supplier payments',
      "Payment details aren't recorded yet."
    ),
    unavailable(
      'net_cash_flow',
      'Net cash flow',
      'Invoice collections minus supplier payments',
      'Cash collected can be read from invoices. Cash paid out is not stored, so net cash flow is not computed.'
    ),
    unavailable(
      'processing_fees',
      'Card processing fees',
      'No fee is stored on invoices',
      'Stripe fees, payouts, and processor costs are not stored on shop invoices.'
    ),
    unavailable(
      'bank_balance',
      'Bank balance',
      'No bank or ledger table',
      'There is no bank, general-ledger, or reconciliation table.'
    ),
    unavailable(
      'payroll',
      'Payroll',
      'No payroll table',
      "Labor hours aren't recorded yet."
    ),
    unavailable(
      'marketplace_payouts',
      'Marketplace payouts',
      'No shop order-payment table',
      'Marketplace checkout is not stored as a shop cash ledger, so payouts are not included.'
    )
  );

  const aging =
    invoicesKnown && columns.due_date
      ? AGING_LABELS.map((bucket) => {
          const hit = agingCents.get(bucket.id) || { cents: 0, count: 0 };
          return {
            id: bucket.id,
            label: bucket.label,
            amount: fromCents(hit.cents),
            count: hit.count,
            source: 'Due date and outstanding balance',
          };
        })
      : null;

  const monthlyRevenue = columns.invoice_date
    ? Array.from({ length: 6 }, (_, index) => {
        const ym = shiftMonth(month, index - 5);
        return { month: ym, amount: fromCents(monthlyBilled.get(ym) || 0) };
      })
    : null;

  const revenueThis = fromCents(monthBilledCents);
  const revenueLast = fromCents(lastMonthBilledCents);
  const outstandingAmount = fromCents(outstandingCents);
  const collectedMonthAmount = fromCents(monthCollectedCents);
  const average =
    pricedBilledCount > 0 ? fromCents(Math.round(billedCents / pricedBilledCount)) : null;

  const summary: FinancialSummary = {
    kpis: [],
    monthlyRevenue,
    monthlyRevenueReason: columns.invoice_date
      ? null
      : invoicesKnown
        ? 'The invoice date was not returned, so monthly revenue cannot be charted.'
        : invoiceIssue || 'Invoices could not be read',
    collectedThisMonth: invoicesKnown && (columns.paid_at || columns.invoice_data) ? collectedMonthAmount : null,
    outstandingAmount: invoicesKnown ? outstandingAmount : null,
  };

  if (!invoicesKnown || !columns.invoice_date) {
    summary.kpis.push({
      id: 'revenue_this_month',
      label: 'Revenue this month',
      availability: 'unavailable',
      reason: !invoicesKnown
        ? invoiceIssue || 'Invoices could not be read'
        : 'The invoice date was not returned, so this month cannot be split out.',
    });
  } else {
    summary.kpis.push({
      id: 'revenue_this_month',
      label: 'Revenue this month',
      availability: 'available',
      amount: revenueThis,
      count: monthBilledCount,
      compareAmount: revenueLast,
      deltaPercent: deltaPercent(revenueThis, revenueLast),
      note: `Compared with ${lastMonth}. Billed invoice totals.`,
    });
  }

  summary.kpis.push(
    invoicesKnown
      ? {
          id: 'outstanding_invoices',
          label: 'Outstanding invoices',
          availability: 'available',
          amount: outstandingAmount,
          count: outstanding.length,
          note: 'Issued invoices that still have a balance.',
        }
      : {
          id: 'outstanding_invoices',
          label: 'Outstanding invoices',
          availability: 'unavailable',
          reason: invoiceIssue || 'Invoices could not be read',
        },
    invoicesKnown
      ? {
          id: 'paid_invoices',
          label: 'Paid invoices',
          availability: 'available',
          amount: fromCents(paidInvoiceCents),
          count: paidInvoiceCount,
          note: 'Issued invoices whose recorded payment covers the total.',
        }
      : {
          id: 'paid_invoices',
          label: 'Paid invoices',
          availability: 'unavailable',
          reason: invoiceIssue || 'Invoices could not be read',
        },
    invoicesKnown && average != null
      ? {
          id: 'average_job_value',
          label: 'Average job value',
          availability: 'available',
          amount: average,
          count: pricedBilledCount,
          note: 'Issued invoice total divided by issued invoices that have a total.',
        }
      : {
          id: 'average_job_value',
          label: 'Average job value',
          availability: 'unavailable',
          reason: invoicesKnown
            ? 'No issued invoice has a total.'
            : invoiceIssue || 'Invoices could not be read',
        },
    {
      id: 'gross_margin',
      label: 'Gross margin',
      availability: 'unavailable',
      reason: 'Invoices do not store labor or parts cost, so gross margin is not computed on this report.',
    },
    estimatesKnown
      ? {
          id: 'open_estimates',
          label: 'Open estimates',
          availability: 'available',
          amount: fromCents(pipelineCents),
          count: pipelineCount,
          note: 'Open estimate totals. Not income and not cash.',
        }
      : {
          id: 'open_estimates',
          label: 'Open estimates',
          availability: 'unavailable',
          reason: estimateIssue || 'Estimates could not be read.',
        }
  );

  return {
    organizationId: input.organizationId == null ? null : String(input.organizationId),
    organizationName: input.organizationName || null,
    currencyCode: moneyPrefs.currencyCode,
    numberFormat: moneyPrefs.numberFormat,
    detailIncluded: true,
    generatedAt: asOf.toISOString(),
    asOfDate,
    timeZone,
    timeZoneLabel,
    summary,
    invoiceRowCount: invoicesKnown ? (input.invoices || []).length : null,
    purchaseOrderRowCount:
      input.purchaseOrders != null && !purchaseOrderIssue ? input.purchaseOrders.length : null,
    estimateRowCount: input.estimates != null && !estimateIssue ? input.estimates.length : null,
    metrics,
    outstanding,
    unpricedInvoices: unpriced,
    paymentMethods: invoicesKnown ? paymentMethods : [],
    aging,
    agingReason:
      !invoicesKnown
        ? invoiceIssue || 'Invoices could not be read'
        : columns.due_date
          ? null
          : 'The due date was not returned, so aging is unavailable.',
  };
}

/** Drop line-item tables for the free plan. KPI summary stays. */
export function presentFinancialReport(report: FinancialReport, detail: boolean): FinancialReport {
  if (detail) return { ...report, detailIncluded: true };
  return {
    ...report,
    detailIncluded: false,
    metrics: [],
    outstanding: [],
    unpricedInvoices: [],
    paymentMethods: [],
    aging: null,
    agingReason: null,
  };
}
