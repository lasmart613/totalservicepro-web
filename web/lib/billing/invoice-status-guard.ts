/**
 * Save Draft must not demote a finalized invoice.
 *
 * The invoice form writes service_invoices from the browser. Finalize & Send
 * sets status to sent, then Save Draft used to write status draft again, so
 * the list pill flipped to Draft. This helper keeps the stored status when
 * the requested status is draft (or blank) and the row is already something
 * else. The database trigger service_invoices_keep_finalized_status is the
 * same rule for a direct update that still sends status draft.
 *
 * draft → draft and draft → sent stay as requested. sent → paid and void
 * stay as requested because those requests are not draft.
 */

import { parseJsonField } from './save-helpers.ts';

/** Columns and invoice_data keys that record a send. A draft write must not clear them. */
export const INVOICE_DELIVERY_FIELDS = [
  'sent_at',
  'emailed_at',
  'email_sent',
  'email_sent_at',
  'delivered_at',
  'delivery_status',
  'delivery',
  'last_emailed_at',
  'resend_email_id',
  'email_id',
] as const;

/**
 * Money and void columns. A draft write must not clear these once the invoice
 * is paid, partially paid, or void (including the stored aliases).
 */
export const INVOICE_PAYMENT_LOCK_STATUSES = [
  'paid',
  'partially_paid',
  'partial',
  'void',
  'voided',
  'cancelled',
  'canceled',
] as const;

const PAYMENT_LOCK = new Set<string>(INVOICE_PAYMENT_LOCK_STATUSES);

export function normalizeInvoiceStatus(status: unknown): string {
  return String(status ?? '')
    .trim()
    .toLowerCase();
}

/** Blank and draft are the only statuses Save Draft may write. */
export function invoiceStatusBlocksDraftDowngrade(status: unknown): boolean {
  const existing = normalizeInvoiceStatus(status);
  return existing !== '' && existing !== 'draft';
}

export function invoiceDraftSaveLabel(status: unknown): 'Save' | 'Save Draft' {
  return invoiceStatusBlocksDraftDowngrade(status) ? 'Save' : 'Save Draft';
}

export function resolveInvoiceSaveStatus(
  existingStatus: unknown,
  requestedStatus: unknown
): { status: string; downgradeBlocked: boolean } {
  const existing = normalizeInvoiceStatus(existingStatus);
  const requested = normalizeInvoiceStatus(requestedStatus) || 'draft';
  if (requested === 'draft' && existing !== '' && existing !== 'draft') {
    return { status: existing, downgradeBlocked: true };
  }
  return { status: requested, downgradeBlocked: false };
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Put delivery / email-sent keys back when a draft save dropped or cleared them.
 * Keys the stored JSON never had are left alone.
 */
export function preserveInvoiceDeliveryFields(
  nextData: unknown,
  previousData: unknown
): Record<string, unknown> {
  const next =
    nextData && typeof nextData === 'object' && !Array.isArray(nextData)
      ? { ...(nextData as Record<string, unknown>) }
      : { ...parseJsonField(nextData) };
  if (previousData == null) return next;
  const previous = parseJsonField(previousData);
  for (const key of INVOICE_DELIVERY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(previous, key)) continue;
    const prev = previous[key];
    if (prev == null || prev === '') continue;
    if (sameJson(next[key], prev)) continue;
    next[key] = prev;
  }
  return next;
}

export type InvoiceStatusGuardResult = {
  payload: Record<string, unknown>;
  status: string;
  downgradeBlocked: boolean;
};

/**
 * Copy of the save body. When the draft downgrade is blocked, status is
 * omitted so the update keeps the row's status. Delivery fields are omitted
 * so a draft payload cannot null them. Paid / void money columns are omitted
 * for those statuses. Other field edits stay in the body.
 */
export function applyInvoiceStatusGuard(
  payload: Record<string, unknown>,
  existingStatus: unknown,
  requestedStatus: unknown,
  previousInvoiceData?: unknown
): InvoiceStatusGuardResult {
  const decision = resolveInvoiceSaveStatus(existingStatus, requestedStatus);
  const body: Record<string, unknown> = { ...payload };
  if (!decision.downgradeBlocked) {
    body.status = decision.status;
    return { payload: body, status: decision.status, downgradeBlocked: false };
  }

  delete body.status;
  for (const key of INVOICE_DELIVERY_FIELDS) {
    if (key in body) delete body[key];
  }
  delete body.paid_at;
  if (PAYMENT_LOCK.has(normalizeInvoiceStatus(existingStatus))) {
    delete body.amount_paid;
    delete body.payment_method;
    delete body.voided_at;
    delete body.void_reason;
  }
  if ('invoice_data' in body) {
    body.invoice_data = preserveInvoiceDeliveryFields(body.invoice_data, previousInvoiceData);
  }
  return { payload: body, status: decision.status, downgradeBlocked: true };
}
