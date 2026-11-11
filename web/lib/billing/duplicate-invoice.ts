/**
 * Copy a saved service invoice into a new draft payload.
 *
 * The insert uses the same columns the invoice editor writes. Nothing here
 * sends email or talks to Stripe. Organization id stays the source row's org
 * (or the caller's org only when the source has none). A caller org that
 * differs from the source is refused.
 *
 * Due date is Net 30 from the supplied invoice date — the only terms rule
 * the editor has (netDueDate). There is no per-invoice terms column.
 */

import { netDueDate } from './doc-prefill.ts';
import { cleanPayeeName, storedInvoicePayee, type InvoicePayeeChoice } from './invoice-payee.ts';
import { coerceOrgId, parseJsonField } from './save-helpers.ts';

/** invoice_data keys that belong to the original invoice and must not be copied. */
export const DUPLICATE_DROPPED_INVOICE_DATA_KEYS = [
  'payment_url',
  'stripe_checkout_session_id',
  'stripe_checkout_session_ids',
  'stripe_checkout_expired_at',
  'stripe_checkout_expired_ids',
  'payment_amount',
  'payment_kind',
  'payment_method',
  'last_payment_at',
  'last_payment_method',
  'deposit',
  'depositDate',
  'depositMethod',
  'travelDeposit',
  'amount_paid',
  'paid_at',
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
  'voided',
  'void_reason',
  'voided_at',
  'void_payment_attempts',
  'void_payment_ignored',
  'status',
  'estimate_id',
  'estimateId',
  'fromEstimate',
  'fromEstimateId',
  'ticket_id',
  'ticketId',
  'service_ticket_id',
  'fromTicket',
  'fromTicketId',
  'report_id',
  'reportId',
  'service_report_id',
  'fromReport',
  'fromReportId',
  'id',
  'invoice_number',
  'invNumber',
  'balanceDue',
] as const;

const DROPPED_EXACT = new Set<string>(DUPLICATE_DROPPED_INVOICE_DATA_KEYS);

export function isDuplicateDroppedInvoiceDataKey(key: string): boolean {
  if (DROPPED_EXACT.has(key)) return true;
  if (/^stripe_/i.test(key)) return true;
  if (/checkout_session/i.test(key)) return true;
  if (/^payment_/i.test(key)) return true;
  if (/last_payment/i.test(key)) return true;
  if (key === 'voided' || key.startsWith('voided_') || key.startsWith('void_')) return true;
  if (/^(estimate|ticket|report)(_?id|Id)$/i.test(key)) return true;
  if (/^from(Estimate|Ticket|Report)/.test(key)) return true;
  if (/_id$/i.test(key) && /estimate|ticket|report/i.test(key)) return true;
  return false;
}

export type DuplicateInvoiceOrg =
  | { ok: true; organizationId: string | number | null }
  | { ok: false; reason: 'org_mismatch' };

export type DuplicateInvoiceDraft =
  | { ok: true; payload: Record<string, any> }
  | { ok: false; reason: 'org_mismatch' | 'missing_invoice_number' };

function orgKey(value: unknown): string | null {
  const id = coerceOrgId(value);
  if (id == null || id === '') return null;
  return String(id);
}

function copyOrgId(value: unknown): string | number | null {
  const id = coerceOrgId(value);
  return id == null || id === '' ? null : id;
}

/** Same org only. A blank source org may take the caller's org. */
export function resolveDuplicateInvoiceOrg(
  source: { organization_id?: unknown } | null | undefined,
  callerOrgId?: string | number | null
): DuplicateInvoiceOrg {
  const sourceOrg = copyOrgId(source?.organization_id);
  const callerOrg = copyOrgId(callerOrgId);
  if (sourceOrg != null && callerOrg != null && orgKey(sourceOrg) !== orgKey(callerOrg)) {
    return { ok: false, reason: 'org_mismatch' };
  }
  return { ok: true, organizationId: sourceOrg ?? callerOrg };
}

function moneyOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function lineExtSum(lines: unknown): number {
  if (!Array.isArray(lines)) return 0;
  let sum = 0;
  for (const line of lines) {
    if (!line || typeof line !== 'object') continue;
    const ext = Number((line as { ext?: unknown }).ext);
    if (Number.isFinite(ext)) sum += ext;
  }
  return round2(sum);
}

function copiedPayee(source: Record<string, unknown>, data: Record<string, unknown>): InvoicePayeeChoice {
  const choice = storedInvoicePayee({
    payee_kind: source.payee_kind,
    payee_name: source.payee_name,
    invoice_data: data,
  });
  if (choice.payee_kind === 'personal') return choice;
  const name = cleanPayeeName(source.payee_name) || cleanPayeeName(data.payee_name);
  return { payee_kind: 'organization', payee_name: name };
}

function cloneData(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

/**
 * Build the insert body for the copy. invoiceDate is the org-local today
 * (YYYY-MM-DD). invoiceNumber is one already allocated the usual way.
 */
export function duplicateInvoiceDraft(input: {
  source: Record<string, unknown>;
  invoiceNumber: string;
  invoiceDate: string;
  callerOrgId?: string | number | null;
  createdBy?: string | null;
  createdAt?: string;
}): DuplicateInvoiceDraft {
  const invoiceNumber = String(input.invoiceNumber || '').trim();
  if (!invoiceNumber) return { ok: false, reason: 'missing_invoice_number' };

  const org = resolveDuplicateInvoiceOrg(input.source, input.callerOrgId);
  if (!org.ok) return org;

  const raw = parseJsonField(input.source.invoice_data);
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isDuplicateDroppedInvoiceDataKey(key)) continue;
    data[key] = cloneData(value);
  }

  const lines = Array.isArray(data.line_items) ? data.line_items : [];
  data.line_items = lines;
  const subtotal = moneyOrNull(input.source.subtotal) ?? lineExtSum(lines);
  const tax = moneyOrNull(input.source.tax) ?? 0;
  const total = moneyOrNull(input.source.total) ?? round2(subtotal + tax);
  const payee = copiedPayee(input.source, raw);
  const descriptionText = input.source.description == null ? '' : String(input.source.description);
  const invoiceDate = String(input.invoiceDate || '').slice(0, 10);
  const due = netDueDate(invoiceDate);

  data.invoice_number = invoiceNumber;
  data.invNumber = invoiceNumber;
  data.payee_kind = payee.payee_kind;
  data.payee_name = payee.payee_name;
  data.deposit = 0;
  data.travelDeposit = 0;
  data.depositDate = null;
  data.depositMethod = null;
  data.deferredReleased = false;
  data.balanceDue = total;

  const payload: Record<string, any> = {
    customer_name: String(input.source.customer_name ?? '').trim(),
    organization_id: org.organizationId,
    customer_organization_id: copyOrgId(input.source.customer_organization_id),
    estimate_id: null,
    invoice_date: invoiceDate || null,
    due_date: due || null,
    description: descriptionText ? descriptionText : null,
    subtotal,
    tax,
    total,
    status: 'draft',
    amount_paid: 0,
    paid_at: null,
    payment_method: null,
    invoice_number: invoiceNumber,
    payee_kind: payee.payee_kind,
    payee_name: payee.payee_name || null,
    invoice_data: data,
    created_at: input.createdAt || new Date().toISOString(),
  };
  const createdBy = String(input.createdBy || '').trim();
  if (createdBy) payload.created_by = createdBy;
  return { ok: true, payload };
}
