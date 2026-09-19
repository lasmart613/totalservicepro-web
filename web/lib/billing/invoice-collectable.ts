/**
 * Estimate → invoice payment split: due now (parts/travel deposit) vs
 * deferred remainder (due on completion). Stripe Checkout charges due-now only
 * until the shop releases the remainder.
 */

import { money2, parseInvoiceData } from './apply-invoice-payment.ts';

export type InvoicePaymentKind = 'deposit' | 'balance' | 'full';

export type InvoiceCollectableSplit = {
  total: number;
  amountPaid: number;
  /** Original parts/travel deposit (0 when the invoice has no split). */
  partsDeposit: number;
  /** Original collectable-now amount (deposit, or full total if no split). */
  dueNowOriginal: number;
  /** Original remainder due on completion. */
  deferredOriginal: number;
  deferredReleased: boolean;
  hasDeferredSplit: boolean;
  /** Unpaid amount Stripe Checkout / Payment Link may charge. */
  stripeAmount: number;
  remainingOwed: number;
  /** Unpaid remainder that is still deferred (excluded from Stripe). */
  deferredUnpaid: number;
  paymentKind: InvoicePaymentKind;
};

export type CheckoutLineItemDraft = {
  quantity: number;
  unit_amount: number;
  name: string;
};

function asMoney(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? money2(n) : 0;
}

function depositRequired(data: Record<string, unknown>): boolean {
  const raw = data.deposit_required;
  if (raw === false || raw === 0 || raw === '0' || raw === 'false') return false;
  return true;
}

/**
 * Parts/travel deposit requested on an estimate (unpaid). 0 if none or if the
 * amount covers the whole job (no deferred remainder).
 */
export function estimatePartsDeposit(estimateData: unknown, total?: number): number {
  const data = parseInvoiceData(estimateData);
  if (!depositRequired(data)) return 0;
  const raw = data.deposit ?? data.travelDeposit ?? data.parts_deposit ?? data.partsDeposit;
  const amt = asMoney(raw);
  if (amt <= 0) return 0;
  const t = asMoney(total);
  if (t > 0 && amt >= t - 0.004) return 0;
  return amt;
}

function paidFromInvoiceData(data: Record<string, unknown>, amountPaidCol?: unknown): number {
  const fromCol = asMoney(amountPaidCol);
  if (fromCol > 0) return fromCol;
  // `deposit` on invoices is amount received (not the unpaid estimate deposit).
  const dep = asMoney(data.deposit);
  return dep > 0 ? dep : 0;
}

export function resolveInvoiceCollectable(input: {
  total?: unknown;
  amountPaid?: unknown;
  invoice_data?: unknown;
  estimateData?: unknown;
  fallbackDueNow?: unknown;
}): InvoiceCollectableSplit {
  const data = parseInvoiceData(input.invoice_data);
  const total = asMoney(input.total ?? data.total);
  const amountPaid = asMoney(
    input.amountPaid != null && Number(input.amountPaid) > 0
      ? input.amountPaid
      : paidFromInvoiceData(data, input.amountPaid)
  );

  const fromEstimate = estimatePartsDeposit(input.estimateData ?? data, total);
  const hasExplicitSplit =
    data.dueNow != null ||
    data.deferred != null ||
    data.partsDeposit != null ||
    data.deferredReleased != null;

  let dueNowOriginal: number;
  let deferredOriginal: number;

  if (hasExplicitSplit) {
    dueNowOriginal = asMoney(data.dueNow ?? data.partsDeposit ?? input.fallbackDueNow ?? 0);
    deferredOriginal = asMoney(
      data.deferred != null ? data.deferred : Math.max(0, total - dueNowOriginal)
    );
  } else if (fromEstimate > 0) {
    dueNowOriginal = fromEstimate;
    deferredOriginal = money2(Math.max(0, total - fromEstimate));
  } else if (input.fallbackDueNow != null && asMoney(input.fallbackDueNow) > 0) {
    dueNowOriginal = asMoney(input.fallbackDueNow);
    deferredOriginal = money2(Math.max(0, total - dueNowOriginal));
  } else {
    dueNowOriginal = total;
    deferredOriginal = 0;
  }

  if (dueNowOriginal > total) dueNowOriginal = total;
  if (dueNowOriginal < 0) dueNowOriginal = 0;
  deferredOriginal = money2(Math.max(0, total - dueNowOriginal));

  const deferredReleased = Boolean(data.deferredReleased);
  const remainingOwed = money2(Math.max(0, total - amountPaid));
  const hasDeferredSplit = deferredOriginal > 0.004;
  const unpaidDueNow = money2(Math.max(0, dueNowOriginal - amountPaid));

  let stripeAmount: number;
  let paymentKind: InvoicePaymentKind;
  if (!hasDeferredSplit || deferredReleased) {
    stripeAmount = remainingOwed;
    paymentKind = hasDeferredSplit && deferredReleased ? 'balance' : 'full';
  } else {
    stripeAmount = unpaidDueNow;
    paymentKind = 'deposit';
  }

  return {
    total,
    amountPaid,
    partsDeposit: hasDeferredSplit ? dueNowOriginal : 0,
    dueNowOriginal,
    deferredOriginal,
    deferredReleased,
    hasDeferredSplit,
    stripeAmount,
    remainingOwed,
    deferredUnpaid: money2(Math.max(0, remainingOwed - stripeAmount)),
    paymentKind,
  };
}

/** Convert-time split: estimate deposit is due now; remainder is deferred. */
export function splitFromEstimate(input: {
  total: number;
  estimateData?: unknown;
  chargeDepositOnly?: boolean;
}): InvoiceCollectableSplit {
  const total = money2(input.total);
  const deposit = estimatePartsDeposit(input.estimateData, total);
  const chargeOnly = input.chargeDepositOnly !== false && deposit > 0;
  return resolveInvoiceCollectable({
    total,
    amountPaid: 0,
    invoice_data: chargeOnly
      ? {
          partsDeposit: deposit,
          dueNow: deposit,
          deferred: money2(total - deposit),
          deferredReleased: false,
        }
      : {
          partsDeposit: 0,
          dueNow: total,
          deferred: 0,
          deferredReleased: false,
        },
  });
}

export function collectableInvoiceDataFields(
  split: InvoiceCollectableSplit
): Record<string, unknown> {
  return {
    partsDeposit: split.partsDeposit,
    dueNow: split.dueNowOriginal,
    deferred: split.deferredOriginal,
    deferredReleased: split.deferredReleased,
    balanceDue: split.remainingOwed,
  };
}

export function releaseDeferredBalance(
  invoiceData: unknown
): Record<string, unknown> {
  const data = parseInvoiceData(invoiceData);
  data.deferredReleased = true;
  return data;
}

export function invoiceCheckoutDescription(
  split: InvoiceCollectableSplit,
  invoiceNumber?: string | null
): string {
  const num = String(invoiceNumber || '').trim();
  const base = num ? `Invoice ${num}` : 'Service invoice';
  if (split.paymentKind === 'deposit') return `${base} — parts/travel deposit`;
  if (split.paymentKind === 'balance') return `${base} — remaining balance`;
  return base;
}

/**
 * Checkout Session line_items draft. Deferred remainder is never included;
 * the unit_amount sum is the due-now Stripe charge only.
 */
export function buildInvoiceCheckoutLineItems(
  split: InvoiceCollectableSplit,
  opts?: { invoiceNumber?: string | null; description?: string | null }
): CheckoutLineItemDraft[] {
  const cents = Math.round(split.stripeAmount * 100);
  if (cents < 50) return [];
  const name = (opts?.description || invoiceCheckoutDescription(split, opts?.invoiceNumber)).slice(
    0,
    120
  );
  return [{ quantity: 1, unit_amount: cents, name }];
}

export function checkoutLineItemsSumCents(items: CheckoutLineItemDraft[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unit_amount, 0);
}
