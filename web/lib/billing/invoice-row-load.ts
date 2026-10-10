/**
 * Load a service_invoices row for send-invoice, and merge a Stripe pay link
 * into invoice_data without replacing line items.
 *
 * Live is missing amount_paid / invoice_number, so richer selects 400 and the
 * reader falls through. Every fallback still selects invoice_data. A write
 * that only has the four payment fields wipes line items on Resend or on a
 * retry after an email error.
 */

export const INVOICE_ROW_SELECTS = [
  'id, created_by, organization_id, customer_name, customer_organization_id, total, amount_paid, invoice_data, invoice_number, status',
  'id, created_by, organization_id, customer_name, customer_organization_id, total, amount_paid, invoice_data, status',
  'id, created_by, organization_id, customer_name, total, amount_paid, invoice_data, status',
  'id, created_by, organization_id, customer_organization_id, total, invoice_data, status',
] as const;

const COLUMN_MISSING = /column|does not exist|schema cache/i;

type InvoiceQueryClient = {
  from: (table: string) => any;
};

export async function loadInvoiceRow(
  client: InvoiceQueryClient,
  invoiceId: string | number
): Promise<{ row: any | null; errorMsg: string | null }> {
  for (const cols of INVOICE_ROW_SELECTS) {
    const { data, error } = await client
      .from('service_invoices')
      .select(cols)
      .eq('id', invoiceId)
      .maybeSingle();
    if (!error && data) return { row: data, errorMsg: null };
    // The query ran. An empty result will not appear on a narrower select,
    // and trying the rest would make a missing id slower than another shop's id.
    if (!error) return { row: null, errorMsg: null };
    if (!COLUMN_MISSING.test(error.message || '')) {
      return { row: null, errorMsg: error.message };
    }
  }
  return { row: null, errorMsg: null };
}

export type StripeLinkFields = {
  payment_url: string;
  stripe_checkout_session_id: string | null;
  payment_amount: number;
  payment_kind: string;
};

/**
 * Copy payment-link fields onto the invoice_data already loaded with the row.
 * Returns null when that JSON was not readable, so the caller must not write.
 */
export function mergePaymentFieldsIntoInvoiceData(
  row: object | null | undefined,
  fields: StripeLinkFields
): Record<string, unknown> | null {
  if (!row || !Object.prototype.hasOwnProperty.call(row, 'invoice_data')) return null;
  const base = readableInvoiceData((row as { invoice_data?: unknown }).invoice_data);
  if (!base) return null;
  return {
    ...base,
    payment_url: fields.payment_url,
    stripe_checkout_session_id: fields.stripe_checkout_session_id,
    payment_amount: fields.payment_amount,
    payment_kind: fields.payment_kind,
  };
}

function readableInvoiceData(val: unknown): Record<string, unknown> | null {
  if (val == null || val === '') return {};
  if (typeof val === 'object' && !Array.isArray(val)) return { ...(val as Record<string, unknown>) };
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { ...parsed };
    } catch {
      return null;
    }
    return null;
  }
  return null;
}
