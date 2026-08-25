/**
 * Apply a Stripe Checkout payment (or a manual cash/check amount) onto a TSP invoice.
 * Idempotent on stripe session id. Does not invent amounts.
 */

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

export function alreadyAppliedSession(inv: InvoicePaymentRow, sessionId: string): boolean {
  const id = String(sessionId || '').trim();
  if (!id) return false;
  const data = parseInvoiceData(inv.invoice_data);
  if (String(data.stripe_checkout_session_id || '') === id) return true;
  const ids = data.stripe_checkout_session_ids;
  if (Array.isArray(ids) && ids.map(String).includes(id)) return true;
  return false;
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
