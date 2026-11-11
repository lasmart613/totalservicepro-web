/**
 * Who a check for an invoice is payable to.
 *
 * organization (default) uses the shop name on the check line, the same as before.
 * personal uses the issuing user's profile name (first + last, then a
 * display/legal full name) on the check line only. The choice is stored on
 * the invoice so a later PDF, email, or resend does not follow whoever is
 * signed in now.
 *
 * The document header, the thank-you line, and the email subject always use
 * the organization's stored name. Card payments still settle on the shop's
 * Stripe account. Checkout's "Payment to …" description names this payee.
 * That description is not the charge destination.
 */

import { parseJsonField } from './save-helpers.ts';
import { invoiceStatusBlocksDraftDowngrade } from './invoice-status-guard.ts';

export const INVOICE_PAYEE_ORGANIZATION = 'organization';
export const INVOICE_PAYEE_PERSONAL = 'personal';

export type InvoicePayeeKind = 'organization' | 'personal';

export type InvoicePayeeChoice = {
  payee_kind: InvoicePayeeKind;
  payee_name: string;
};

/** Money columns a sent-invoice payee update must not write. */
export const INVOICE_PAYEE_LOCKED_AMOUNT_KEYS = [
  'subtotal',
  'tax',
  'total',
  'amount_paid',
  'paid_at',
  'payment_method',
  'status',
  'voided_at',
  'void_reason',
] as const;

const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

export function cleanPayeeName(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(BIDI_CONTROLS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export function normalizeInvoicePayeeKind(value: unknown): InvoicePayeeKind {
  return cleanPayeeName(value).toLowerCase() === INVOICE_PAYEE_PERSONAL
    ? INVOICE_PAYEE_PERSONAL
    : INVOICE_PAYEE_ORGANIZATION;
}

/**
 * Profile display / legal name. first_name + last_name win. A single
 * full_name or name is the fallback. Email local-parts are not a payee.
 */
export function profileDisplayName(
  input?: {
    first_name?: string | null;
    last_name?: string | null;
    full_name?: string | null;
    name?: string | null;
  } | null
): string {
  if (!input) return '';
  const composed = [input.first_name, input.last_name].map(cleanPayeeName).filter(Boolean).join(' ');
  if (composed) return cleanPayeeName(composed);
  return cleanPayeeName(input.full_name || input.name);
}

/**
 * Choice already stored on an invoice.
 * A non-empty payee_name column is a snapshot written after the column existed.
 * A null column (the migration default) leaves invoice_data in charge, so a
 * personal choice saved before the column was added is not reset to the shop.
 */
export function storedInvoicePayee(
  row?: { payee_kind?: unknown; payee_name?: unknown; invoice_data?: unknown } | null
): InvoicePayeeChoice {
  const data = parseJsonField(row?.invoice_data);
  const columnName = cleanPayeeName(row?.payee_name);
  const dataName = cleanPayeeName(data.payee_name);
  const kind = columnName
    ? normalizeInvoicePayeeKind(row?.payee_kind)
    : normalizeInvoicePayeeKind(data.payee_kind ?? row?.payee_kind);
  const snapshot = columnName || dataName;
  if (kind === INVOICE_PAYEE_PERSONAL && snapshot) {
    return { payee_kind: INVOICE_PAYEE_PERSONAL, payee_name: snapshot };
  }
  return { payee_kind: INVOICE_PAYEE_ORGANIZATION, payee_name: '' };
}

export function invoicePayeeWrite(input: {
  kind?: unknown;
  organizationName?: unknown;
  personalName?: unknown;
  storedKind?: unknown;
  storedPayeeName?: unknown;
  touched?: boolean;
}): InvoicePayeeChoice {
  const kind = normalizeInvoicePayeeKind(input.kind);
  const organizationName = cleanPayeeName(input.organizationName);
  const personalName = cleanPayeeName(input.personalName);
  const storedKind = normalizeInvoicePayeeKind(input.storedKind);
  const stored = cleanPayeeName(input.storedPayeeName);
  if (kind === INVOICE_PAYEE_PERSONAL) {
    const name = !input.touched && storedKind === INVOICE_PAYEE_PERSONAL && stored ? stored : personalName;
    if (name) return { payee_kind: INVOICE_PAYEE_PERSONAL, payee_name: name };
  }
  return { payee_kind: INVOICE_PAYEE_ORGANIZATION, payee_name: organizationName };
}

/**
 * Name on "Make checks payable to" and the Checkout "Payment to" description.
 * Organization, or a missing choice, stays the shop name. This is not the
 * name in the invoice header or the thank-you line.
 */
export function invoiceChecksPayableName(
  row: Record<string, unknown> | null | undefined,
  organizationName: unknown
): string {
  const stored = storedInvoicePayee(row);
  const org = cleanPayeeName(organizationName);
  if (stored.payee_kind === INVOICE_PAYEE_PERSONAL && stored.payee_name) return stored.payee_name;
  return org;
}

export function mergePayeeIntoInvoiceData(existing: unknown, payee: InvoicePayeeChoice): Record<string, unknown> {
  return {
    ...parseJsonField(existing),
    payee_kind: payee.payee_kind,
    payee_name: payee.payee_name,
  };
}

/**
 * Update who a sent (or otherwise finalized) invoice is payable to.
 * Returns null for a draft, or when the stored JSON could not be read.
 * The patch has no status and no money columns. Line items, deposits, and
 * Stripe session ids already in invoice_data stay.
 */
export function sentInvoicePayeePatch(input: {
  existingStatus: unknown;
  storedInvoiceData: unknown;
  payee: InvoicePayeeChoice;
}): Record<string, unknown> | null {
  if (!invoiceStatusBlocksDraftDowngrade(input.existingStatus)) return null;
  if (input.storedInvoiceData === undefined) return null;
  const patch: Record<string, unknown> = {
    payee_kind: input.payee.payee_kind,
    payee_name: input.payee.payee_name,
    invoice_data: mergePayeeIntoInvoiceData(input.storedInvoiceData, input.payee),
  };
  for (const key of INVOICE_PAYEE_LOCKED_AMOUNT_KEYS) {
    delete patch[key];
  }
  return patch;
}
