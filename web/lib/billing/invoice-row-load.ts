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
  'id, created_by, organization_id, customer_name, customer_organization_id, total, amount_paid, invoice_data, invoice_number, status, stripe_session_id',
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

export type InvoicePayLinkSave = {
  paymentUrl: string | null;
  sessionId: string | null;
  paymentAmount?: number | null;
  paymentKind?: string | null;
  /** Open session this send is replacing. Kept so an old email can be recognized. */
  replacedSessionId?: string | null;
  /**
   * Write only while this is still the stored Checkout session.
   * Zero rows means another send already replaced it.
   */
  expectedSessionId?: string | null;
};

/**
 * Overlay the pay-link keys on the latest invoice_data. Other keys written
 * since the send started, including stripe_checkout_session_ids, stay.
 * No new SQL function: the read and the conditional update are the merge.
 */
export async function saveInvoicePayLink(
  invoices: { select: (columns: string) => any; update: (patch: Record<string, unknown>) => any },
  invoiceId: string | number,
  patch: InvoicePayLinkSave
): Promise<{ saved: boolean; currentSessionId: string | null }> {
  try {
    let read = await invoices.select('invoice_data, updated_at').eq('id', invoiceId).maybeSingle();
    if (read?.error && COLUMN_MISSING.test(String(read.error.message || ''))) {
      read = await invoices.select('invoice_data').eq('id', invoiceId).maybeSingle();
    }
    if (read?.error || !read?.data || !Object.prototype.hasOwnProperty.call(read.data, 'invoice_data')) {
      return { saved: false, currentSessionId: null };
    }
    const base = readableInvoiceData(read.data.invoice_data);
    if (!base) return { saved: false, currentSessionId: null };
    const current = String(base.stripe_checkout_session_id || '').trim();
    const expected = String(patch.expectedSessionId || '').trim();
    if (expected && current && current !== expected) {
      return { saved: false, currentSessionId: current };
    }
    const replaced = Array.isArray(base.replaced_checkout_session_ids)
      ? base.replaced_checkout_session_ids.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const prior = String(patch.replacedSessionId || '').trim();
    if (prior && !replaced.includes(prior) && prior !== String(patch.sessionId || '').trim()) {
      replaced.push(prior);
    }
    const next: Record<string, unknown> = {
      ...base,
      payment_url: patch.paymentUrl || '',
      stripe_checkout_session_id: patch.sessionId || '',
      replaced_checkout_session_ids: replaced,
    };
    if (patch.paymentAmount != null) next.payment_amount = patch.paymentAmount;
    if (patch.paymentKind) next.payment_kind = patch.paymentKind;
    const payload: Record<string, unknown> = { invoice_data: next };
    const updatedAt = read.data.updated_at;
    if (updatedAt) payload.updated_at = new Date().toISOString();
    let query = invoices.update(payload).eq('id', invoiceId);
    if (updatedAt) query = query.eq('updated_at', updatedAt);
    if (expected) query = query.filter('invoice_data->>stripe_checkout_session_id', 'eq', expected);
    const wrote = await query.select('id');
    if (wrote?.error) return { saved: false, currentSessionId: current };
    const rows = Array.isArray(wrote?.data) ? wrote.data : [];
    if (expected && rows.length === 0) {
      const again = await invoices.select('invoice_data').eq('id', invoiceId).maybeSingle();
      const now = String(readableInvoiceData(again?.data?.invoice_data)?.stripe_checkout_session_id || '').trim();
      return { saved: false, currentSessionId: now || current };
    }
    return { saved: rows.length > 0 || !expected, currentSessionId: String(patch.sessionId || '').trim() || null };
  } catch (e) {
    console.warn('could not persist payment_url', e);
    return { saved: false, currentSessionId: null };
  }
}
