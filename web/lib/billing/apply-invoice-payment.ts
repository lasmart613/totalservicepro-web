/**
 * Apply a Stripe Checkout payment (or a manual cash/check amount) onto a TSP invoice.
 * A payment is credited only through the stripe_session_id column. The open
 * pay-link id in invoice_data.stripe_checkout_session_id is not proof of payment.
 * Does not invent amounts.
 */
import { isVoidInvoiceStatus, VOIDED_INVOICE_MESSAGE } from './void-invoice.ts';

export type InvoicePaymentRow = {
  id: string | number;
  total?: number | string | null;
  status?: string | null;
  invoice_number?: string | null;
  customer_name?: string | null;
  created_by?: string | null;
  organization_id?: string | number | null;
  invoice_data?: unknown;
  amount_paid?: number | string | null;
  /** Claim column. Set only when a Checkout payment is applied. */
  stripe_session_id?: string | null;
};

export type InvoicePaymentPatch = {
  status: 'paid' | 'partially_paid' | 'sent';
  amount_paid: number;
  paid_at: string | null;
  payment_method: string;
  invoice_data: Record<string, unknown>;
  updated_at: string;
};

export function parseInvoiceData(val: unknown): Record<string, unknown> {
  if (!val) return {};
  if (typeof val === 'object' && !Array.isArray(val)) return { ...(val as Record<string, unknown>) };
  if (typeof val === 'string') {
    try {
      const p = JSON.parse(val);
      return p && typeof p === 'object' && !Array.isArray(p) ? { ...p } : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function money2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function paymentStatusFromAmounts(
  total: number,
  amountPaid: number
): 'paid' | 'partially_paid' | 'sent' {
  const t = Math.round(money2(total) * 100);
  const p = Math.round(money2(amountPaid) * 100);
  if (p <= 0) return 'sent';
  if (t > 0 && p >= t) return 'paid';
  if (p >= t && t === 0 && p > 0) return 'paid';
  return 'partially_paid';
}

export function existingPaidAmount(inv: InvoicePaymentRow): number {
  const data = parseInvoiceData(inv.invoice_data);
  const fromCol = Number(inv.amount_paid);
  if (Number.isFinite(fromCol) && fromCol > 0) return money2(fromCol);
  const dep = Number(data.deposit);
  if (Number.isFinite(dep) && dep > 0) return money2(dep);
  return 0;
}

/** Checkout session ids are cs_ + letters, digits, and underscores. */
const STRIPE_SESSION_ID_SAFE = /^[A-Za-z0-9_]+$/;

export const INVOICE_STRIPE_SESSION_COLUMN = 'stripe_session_id';

/**
 * Sessions that may return success without a second credit:
 * stripe_session_id IS NULL, or it already equals this session.
 * A different session does not match. Returns null when the id cannot be
 * placed safely in a PostgREST filter string.
 */
export function invoiceSessionClaimFilter(sessionId: string): string | null {
  const id = String(sessionId || '').trim();
  if (!STRIPE_SESSION_ID_SAFE.test(id)) return null;
  return `${INVOICE_STRIPE_SESSION_COLUMN}.is.null,${INVOICE_STRIPE_SESSION_COLUMN}.eq.${id}`;
}

/**
 * Crediting UPDATE filter. Rows affected means this delivery claimed the
 * invoice. A later delivery of the same session does not match, so it cannot
 * add the amount again. Same-session success is a follow-up read, not a
 * second write. Pair with invoiceSessionClaimFilter.
 */
export function invoiceSessionCreditFilter(sessionId: string): string | null {
  if (!invoiceSessionClaimFilter(sessionId)) return null;
  return `${INVOICE_STRIPE_SESSION_COLUMN}.is.null`;
}

/** Compare-and-swap filter for a later payment on a not-yet-paid invoice. */
export function invoiceSessionEqualsFilter(sessionId: string): string | null {
  const id = String(sessionId || '').trim();
  if (!invoiceSessionClaimFilter(id)) return null;
  return `${INVOICE_STRIPE_SESSION_COLUMN}.eq.${id}`;
}

function textId(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

/**
 * The Checkout session belongs to one invoice. metadata.invoice_id and
 * client_reference_id must agree when both are set. Either one is enough.
 */
export function checkoutBelongsToInvoice(session: {
  metadata?: Record<string, string | undefined> | null;
  client_reference_id?: unknown;
}): { ok: true; invoiceId: string } | { ok: false; reason: 'missing_invoice_id' | 'invoice_mismatch' } {
  const meta = session.metadata || {};
  const fromMeta = textId(meta.invoice_id);
  const fromRef = textId(session.client_reference_id);
  if (fromMeta && fromRef && fromMeta !== fromRef) return { ok: false, reason: 'invoice_mismatch' };
  const invoiceId = fromMeta || fromRef;
  if (!invoiceId) return { ok: false, reason: 'missing_invoice_id' };
  return { ok: true, invoiceId };
}

/** True when the claim column already records this Checkout session. */
export function alreadyAppliedSession(inv: InvoicePaymentRow, sessionId: string): boolean {
  const id = String(sessionId || '').trim();
  if (!id) return false;
  return textId(inv.stripe_session_id) === id;
}

/** Status paid, or amount_paid already covers the total. */
export function invoiceFullyPaid(inv: InvoicePaymentRow): boolean {
  if (String(inv.status || '').trim().toLowerCase() === 'paid') return true;
  const total = money2(Number(inv.total) || 0);
  if (total <= 0) return false;
  return existingPaidAmount(inv) + 0.004 >= total;
}

export function checkoutLooksLikeInvoicePay(session: {
  mode?: string | null;
  metadata?: Record<string, string | undefined> | null;
} | null | undefined): boolean {
  if (!session) return false;
  if (String(session.mode || '') === 'subscription') return false;
  const meta = session.metadata || {};
  if (String(meta.kind || '') === 'invoice_pay') return true;
  return Boolean(String(meta.invoice_id || '').trim());
}

export function buildInvoicePaymentPatch(input: {
  invoice: InvoicePaymentRow;
  addAmount: number;
  method: string;
  sessionId?: string | null;
  now?: Date;
}): InvoicePaymentPatch {
  if (isVoidInvoiceStatus(input.invoice.status)) {
    throw new Error(VOIDED_INVOICE_MESSAGE);
  }
  const now = input.now || new Date();
  const total = money2(Number(input.invoice.total) || 0);
  const prior = existingPaidAmount(input.invoice);
  const add = money2(Math.max(0, Number(input.addAmount) || 0));
  const amount_paid = money2(prior + add);
  const status = paymentStatusFromAmounts(total, amount_paid);
  const data = parseInvoiceData(input.invoice.invoice_data);
  const sessionId = String(input.sessionId || '').trim();
  const ids = Array.isArray(data.stripe_checkout_session_ids)
    ? data.stripe_checkout_session_ids.map(String)
    : [];
  const priorSession = String(data.stripe_checkout_session_id || '');
  if (priorSession && !ids.includes(priorSession)) ids.push(priorSession);
  if (sessionId && !ids.includes(sessionId)) ids.push(sessionId);
  if (sessionId) data.stripe_checkout_session_id = sessionId;
  if (ids.length) data.stripe_checkout_session_ids = ids;
  data.deposit = amount_paid;
  data.balanceDue = money2(Math.max(0, total - amount_paid));
  data.depositMethod = input.method;
  data.depositDate = now.toISOString().slice(0, 10);
  data.last_payment_method = input.method;
  data.last_payment_at = now.toISOString();
  return {
    status,
    amount_paid,
    paid_at: status === 'paid' ? now.toISOString() : null,
    payment_method: input.method,
    invoice_data: data,
    updated_at: now.toISOString(),
  };
}
