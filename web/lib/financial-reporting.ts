/**
 * Shop financial figures from rows already stored for the active organization.
 * Amounts are summed from those rows. A metric with no column or table is
 * marked unavailable and has no amount.
 */

import { money2, parseInvoiceData } from './billing/apply-invoice-payment.ts';
import { resolveOrgMoneyPrefs } from './money-format.ts';

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
  'service_invoices.payment_method, else invoice_data.last_payment_method or depositMethod; Stripe when a stripe_checkout_session_id is stored and no method is';

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

function paymentDate(row: InvoiceSourceRow, columns: InvoiceColumnFlags): string | null {
  if (columns.paid_at) {
    const paid = ymd(row.paid_at);
    if (paid) return paid;
  }
  const data = invoiceData(row, columns);
  return ymd(data.last_payment_at) || ymd(data.depositDate);
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
}): FinancialReport {
  const asOf = input.asOf || new Date();
  const asOfDate = asOf.toISOString().slice(0, 10);
  const month = asOfDate.slice(0, 7);
  const lastMonth = shiftMonth(month, -1);
  const moneyPrefs = resolveOrgMoneyPrefs({
    currencyCode: input.currencyCode,
    numberFormat: input.numberFormat,
  });
  const columns = input.invoiceColumns;
  const invoiceIssue = input.invoiceIssue || null;
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
          reason: 'service_invoices.total is empty',
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
          reason: 'No amount_paid and no invoice_data.deposit',
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
        const paidDay = paymentDate(row, columns);
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
    const reason = invoiceIssue || 'service_invoices could not be read';
    metrics.push(
      unavailable('billed_income', 'Billed income', 'service_invoices.total', reason),
      unavailable(
        'cash_collected',
        'Cash collected',
        'service_invoices.amount_paid or invoice_data.deposit',
        reason
      ),
      unavailable(
        'outstanding_balance',
        'Outstanding unpaid invoices',
        'service_invoices.total minus amount paid',
        reason
      ),
      unavailable('draft_invoices', 'Unissued draft invoices', 'service_invoices.total where status is draft', reason),
      unavailable('sales_tax', 'Sales tax on issued invoices', 'service_invoices.tax', reason),
      unavailable('billed_this_month', 'Billed this UTC month', 'service_invoices.invoice_date and total', reason),
      unavailable(
        'collected_this_month',
        'Cash collected this UTC month',
        'service_invoices.paid_at or invoice_data.last_payment_at / depositDate',
        reason
      ),
      unavailable('stripe_processed', 'Stripe-processed collections', PAYMENT_METHOD_SOURCE, reason),
      unavailable(
        'voided_payments',
        'Payments recorded on voided invoices',
        'service_invoices.amount_paid where status is void or cancelled',
        reason
      )
    );
  } else {
    const paymentSource = columns.amount_paid
      ? 'service_invoices.amount_paid; invoice_data.deposit when amount_paid is 0 or empty'
      : 'invoice_data.deposit (service_invoices.amount_paid was not returned)';
    const collectedAvailable = columns.amount_paid || columns.invoice_data;
    metrics.push(
      available({
        id: 'billed_income',
        label: 'Billed income',
        source: 'service_invoices.total for issued invoices (not draft, void, or cancelled)',
        amount: fromCents(billedCents),
        count: billedCount,
        note:
          unpriced.some((row) => row.reason.startsWith('service_invoices.total'))
            ? 'Issued invoices with an empty total were counted and omitted from the amount.'
            : undefined,
      })
    );

    if (!collectedAvailable) {
      metrics.push(
        unavailable(
          'cash_collected',
          'Cash collected',
          'service_invoices.amount_paid or invoice_data.deposit',
          'Neither amount_paid nor invoice_data was returned, so collected cash cannot be read.'
        )
      );
    } else {
      const notes: string[] = [];
      if (unknownPaid > 0) {
        notes.push(
          `${unknownPaid} issued invoice${unknownPaid === 1 ? '' : 's'} have no amount_paid and no invoice_data.deposit, so they are not included in cash collected.`
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
        source: 'service_invoices.total minus amount_paid (or invoice_data.deposit) for issued invoices that still have a balance',
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
        source: 'service_invoices.total where status is draft',
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
          'service_invoices.tax',
          'The tax column was not returned for service_invoices.'
        )
      );
    } else if (taxKnown === 0 && taxNulls > 0) {
      metrics.push(
        unavailable(
          'sales_tax',
          'Sales tax on issued invoices',
          'service_invoices.tax',
          'tax is null on every issued invoice.'
        )
      );
    } else {
      metrics.push(
        available({
          id: 'sales_tax',
          label: 'Sales tax on issued invoices',
          source: 'service_invoices.tax',
          amount: fromCents(taxCents),
          count: taxKnown,
          note:
            taxNulls > 0
              ? `${taxNulls} issued invoice${taxNulls === 1 ? '' : 's'} have a null tax value and were not added.`
              : 'Tax stored on the invoice. Partial payments are not allocated to tax.',
        })
      );
    }

    if (!columns.invoice_date) {
      metrics.push(
        unavailable(
          'billed_this_month',
          'Billed this UTC month',
          'service_invoices.invoice_date',
          'invoice_date was not returned, so this month cannot be split out.'
        )
      );
    } else {
      metrics.push(
        available({
          id: 'billed_this_month',
          label: 'Billed this UTC month',
          source: 'service_invoices.invoice_date and total',
          amount: fromCents(monthBilledCents),
          count: monthBilledCount,
          note:
            monthBilledUndated > 0
              ? `${monthBilledUndated} issued invoice${monthBilledUndated === 1 ? '' : 's'} have no invoice_date and are excluded from this month.`
              : `UTC month ${month}.`,
        })
      );
    }

    if (!collectedAvailable) {
      metrics.push(
        unavailable(
          'collected_this_month',
          'Cash collected this UTC month',
          'service_invoices.paid_at or invoice_data payment dates',
          'Collected cash itself is unavailable.'
        )
      );
    } else if (!columns.paid_at && !columns.invoice_data) {
      metrics.push(
        unavailable(
          'collected_this_month',
          'Cash collected this UTC month',
          'service_invoices.paid_at or invoice_data.last_payment_at / depositDate',
          'No payment date column or invoice_data was returned.'
        )
      );
    } else {
      metrics.push(
        available({
          id: 'collected_this_month',
          label: 'Cash collected this UTC month',
          source: 'service_invoices.paid_at, else invoice_data.last_payment_at or depositDate',
          amount: fromCents(monthCollectedCents),
          count: monthCollectedCount,
          note:
            collectedUndatedCount > 0
              ? `${fromCents(collectedUndatedCents).toFixed(2)} collected across ${collectedUndatedCount} payment${collectedUndatedCount === 1 ? '' : 's'} has no payment date and is excluded from this month.`
              : `UTC month ${month}. Uses the payment date, not the invoice date.`,
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
        source: 'service_invoices.amount_paid or invoice_data.deposit where status is void or cancelled',
        amount: fromCents(voidedPaymentCents),
        count: voidedPaymentCount,
        note: 'Excluded from billed income, cash collected, and outstanding. Refunds are not stored separately.',
      })
    );
  }

  if (input.purchaseOrders == null || input.purchaseOrderIssue) {
    const reason = input.purchaseOrderIssue || 'purchase_orders could not be read';
    metrics.push(
      unavailable(
        'po_commitments',
        'Purchase-order commitments',
        'purchase_orders.total where status is not draft or cancelled',
        reason
      ),
      unavailable('po_drafts', 'Draft purchase orders', 'purchase_orders.total where status is draft', reason)
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
        source: 'purchase_orders.total where status is sent or another non-draft, non-cancelled status',
        amount: fromCents(commitCents),
        count: commitCount,
        note: 'This is the recorded order total, not cash paid to the supplier.',
      }),
      available({
        id: 'po_drafts',
        label: 'Draft purchase orders',
        source: 'purchase_orders.total where status is draft or blank',
        amount: fromCents(draftPoCents),
        count: draftPoCount,
      })
    );
  }

  let pipelineCents = 0;
  let pipelineCount = 0;
  const estimatesKnown = input.estimates != null && !input.estimateIssue;
  if (!estimatesKnown) {
    metrics.push(
      unavailable(
        'estimate_pipeline',
        'Open estimate pipeline',
        'service_estimates.total',
        input.estimateIssue || 'service_estimates could not be read'
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
        source: 'service_estimates.total where status is not invoiced, approved, accepted, expired, rejected, declined, cancelled, or completed',
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
      'purchase_orders',
      'purchase_orders stores supplier, total, and status. It has no amount_paid, paid_at, or payment_method, so supplier payments are not recorded.'
    ),
    unavailable(
      'net_cash_flow',
      'Net cash flow',
      'service_invoices collections minus supplier payments',
      'Cash collected can be read from invoices. Cash paid out is not stored, so net cash flow is not computed.'
    ),
    unavailable(
      'processing_fees',
      'Card processing fees',
      'No fee column on service_invoices',
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
      'There is no payroll or labor-cost table. labor_log has hours, not wages.'
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
            source: 'service_invoices.due_date and outstanding balance',
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
        ? 'invoice_date was not returned, so monthly revenue cannot be charted.'
        : invoiceIssue || 'service_invoices could not be read',
    collectedThisMonth: invoicesKnown && (columns.paid_at || columns.invoice_data) ? collectedMonthAmount : null,
    outstandingAmount: invoicesKnown ? outstandingAmount : null,
  };

  if (!invoicesKnown || !columns.invoice_date) {
    summary.kpis.push({
      id: 'revenue_this_month',
      label: 'Revenue this month',
      availability: 'unavailable',
      reason: !invoicesKnown
        ? invoiceIssue || 'service_invoices could not be read'
        : 'invoice_date was not returned, so this month cannot be split out.',
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
      note: `Compared with ${lastMonth}. Billed invoice totals, UTC.`,
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
          reason: invoiceIssue || 'service_invoices could not be read',
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
          reason: invoiceIssue || 'service_invoices could not be read',
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
            : invoiceIssue || 'service_invoices could not be read',
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
          reason: input.estimateIssue || 'service_estimates could not be read',
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
    summary,
    invoiceRowCount: invoicesKnown ? (input.invoices || []).length : null,
    purchaseOrderRowCount:
      input.purchaseOrders != null && !input.purchaseOrderIssue ? input.purchaseOrders.length : null,
    estimateRowCount: input.estimates != null && !input.estimateIssue ? input.estimates.length : null,
    metrics,
    outstanding,
    unpricedInvoices: unpriced,
    paymentMethods: invoicesKnown ? paymentMethods : [],
    aging,
    agingReason:
      !invoicesKnown
        ? invoiceIssue || 'service_invoices could not be read'
        : columns.due_date
          ? null
          : 'service_invoices.due_date was not returned, so aging is unavailable.',
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
