/**
 * Void rules for service invoices.
 * A void invoice is not payable, not outstanding, and not revenue.
 * Status stays a free-text column until the void migration is applied.
 */
import { existingPaidAmount, parseInvoiceData, type InvoicePaymentRow } from './apply-invoice-payment.ts';
import { isAdmin, normalizeRole, type RoleLike } from '../roles.ts';

export const VOID_INVOICE_STATUS = 'void';
export const VOIDED_INVOICE_MESSAGE = 'This invoice was voided';

export function isVoidInvoiceStatus(status: unknown): boolean {
  const value = String(status || '')
    .trim()
    .toLowerCase();
  return value === 'void' || value === 'voided';
}

export function canVoidInvoiceRole(role: RoleLike): boolean {
  return isAdmin(role) || normalizeRole(role) === 'owner';
}

export function normalizeVoidReason(value: unknown): string | null {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.slice(0, 500);
}

export type VoidInvoiceDecision = { ok: true } | { ok: false; reason: string };

/**
 * Draft or sent, no recorded payment, and an org role that may void.
 * Pass the target org's membership authority role (voidInvoiceRole).
 * Platform admin still passes because isAdmin treats admin as allowed.
 * A company_admin value here is a membership role, not user_profiles.role.
 */
export function canVoidInvoice(input: {
  status?: string | null;
  amount_paid?: number | string | null;
  invoice_data?: unknown;
  role?: RoleLike;
}): VoidInvoiceDecision {
  if (!canVoidInvoiceRole(input.role)) {
    return { ok: false, reason: 'Only an organization admin can void an invoice.' };
  }
  const status = String(input.status || '')
    .trim()
    .toLowerCase();
  if (status !== 'draft' && status !== 'sent') {
    return { ok: false, reason: 'Only a draft or sent invoice with no payment can be voided.' };
  }
  const paid = existingPaidAmount({
    id: 0,
    amount_paid: input.amount_paid,
    invoice_data: input.invoice_data,
  });
  if (paid > 0.004) {
    return { ok: false, reason: 'Invoices with a payment cannot be voided.' };
  }
  return { ok: true };
}

export function invoiceAcceptsPayment(status: unknown): boolean {
  return !isVoidInvoiceStatus(status);
}

/** Record that a payment arrived after void, without changing status or amount_paid. */
export function flagVoidInvoicePayment(
  invoiceData: unknown,
  input: { sessionId?: string | null; amount?: number | null; at?: string | null }
): Record<string, unknown> {
  const data = parseInvoiceData(invoiceData);
  const attempts = Array.isArray(data.void_payment_attempts) ? [...data.void_payment_attempts] : [];
  const sessionId = String(input.sessionId || '').trim();
  const already = attempts.some((item) => {
    if (!item || typeof item !== 'object') return false;
    return String((item as { sessionId?: string }).sessionId || '') === sessionId && sessionId !== '';
  });
  if (!already) {
    attempts.push({
      sessionId: sessionId || null,
      amount: input.amount == null ? null : Number(input.amount),
      at: input.at || new Date().toISOString(),
    });
  }
  data.void_payment_attempts = attempts;
  data.void_payment_ignored = true;
  return data;
}

export type CheckoutExpireClass = 'expired' | 'already_expired' | 'completed' | 'failed';

/** Classify a Stripe Checkout Session expire response. No charges or refunds. */
export function classifyCheckoutExpire(status: number, body: unknown): CheckoutExpireClass {
  if (status >= 200 && status < 300) return 'expired';
  const record = body && typeof body === 'object' ? (body as { error?: { code?: string; message?: string } }) : {};
  const code = String(record.error?.code || '').toLowerCase();
  const message = String(record.error?.message || '').toLowerCase();
  if (/complete|paid|succeeded/.test(message) || code === 'checkout_session_completed') return 'completed';
  if (
    /expired|not open|status of `?expired|already been expired|no such checkout/.test(message) ||
    code === 'resource_missing'
  ) {
    return 'already_expired';
  }
  return 'failed';
}

export function checkoutSessionIds(invoiceData: unknown): string[] {
  const data = parseInvoiceData(invoiceData);
  const ids: string[] = [];
  const current = String(data.stripe_checkout_session_id || '').trim();
  if (current) ids.push(current);
  const extra = data.stripe_checkout_session_ids;
  if (Array.isArray(extra)) {
    for (const id of extra) {
      const value = String(id || '').trim();
      if (value && !ids.includes(value)) ids.push(value);
    }
  }
  return ids;
}

export function sessionMatchesInvoice(invoiceData: unknown, sessionId: string): boolean {
  const id = String(sessionId || '').trim();
  if (!id) return false;
  return checkoutSessionIds(invoiceData).includes(id);
}

export type VoidInvoicePatch = {
  status: 'void';
  voided_at: string;
  void_reason: string | null;
  invoice_data: Record<string, unknown>;
  updated_at: string;
};

export function buildVoidInvoicePatch(input: {
  invoice: Pick<InvoicePaymentRow, 'invoice_data'>;
  reason?: unknown;
  now?: Date;
  expiredSessionIds?: string[];
}): VoidInvoicePatch {
  const now = input.now || new Date();
  const at = now.toISOString();
  const data = parseInvoiceData(input.invoice.invoice_data);
  const reason = normalizeVoidReason(input.reason);
  data.voided = true;
  data.void_reason = reason;
  data.voided_at = at;
  data.payment_url = null;
  if (input.expiredSessionIds && input.expiredSessionIds.length) {
    data.stripe_checkout_expired_at = at;
    data.stripe_checkout_expired_ids = input.expiredSessionIds;
  }
  return {
    status: 'void',
    voided_at: at,
    void_reason: reason,
    invoice_data: data,
    updated_at: at,
  };
}
