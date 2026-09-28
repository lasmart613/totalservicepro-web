/**
 * Invoice form writes must overlay form fields onto invoice_data already stored.
 * send-invoice stores payment_url and stripe_checkout_session_id after the draft
 * save; the follow-up "sent" save has to keep those or the webhook cannot match
 * the Checkout session.
 */

import { parseJsonField } from './save-helpers.ts';

type InvoiceDataClient = {
  from: (table: string) => any;
};

export function mergeFormInvoiceData(
  existing: unknown,
  formFields: Record<string, unknown>
): Record<string, unknown> {
  return { ...parseJsonField(existing), ...formFields };
}

export async function loadStoredInvoiceData(
  client: InvoiceDataClient,
  invoiceId: string | number
): Promise<unknown> {
  const { data, error } = await client
    .from('service_invoices')
    .select('invoice_data')
    .eq('id', invoiceId)
    .maybeSingle();
  if (error || !data || !Object.prototype.hasOwnProperty.call(data, 'invoice_data')) {
    return undefined;
  }
  return data.invoice_data;
}

/** New invoices have no stored JSON. Updates merge so non-form keys survive. */
export async function invoiceDataForSave(
  client: InvoiceDataClient,
  existingId: string | number | null | undefined,
  formFields: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (existingId == null || existingId === '') {
    return mergeFormInvoiceData(undefined, formFields);
  }
  const stored = await loadStoredInvoiceData(client, existingId);
  return mergeFormInvoiceData(stored, formFields);
}
