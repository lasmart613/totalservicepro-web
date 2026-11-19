/**
 * Public pay-page answer. Unknown invoices and unknown sessions share one
 * 404 body. A session this send replaced gets a replacement message and no URL.
 */

import { parseInvoiceData } from './apply-invoice-payment.ts';
import { isVoidInvoiceStatus, sessionMatchesInvoice, VOIDED_INVOICE_MESSAGE } from './void-invoice.ts';

export const INVOICE_PAY_STATUS_NOT_FOUND = { error: 'Invoice not found.' };
export const INVOICE_PAY_LINK_REPLACED = 'This link was replaced. Use the latest email.';

export function replacedCheckoutSessionIds(invoiceData: unknown): string[] {
  const data = parseInvoiceData(invoiceData);
  const extra = data.replaced_checkout_session_ids;
  if (!Array.isArray(extra)) return [];
  const ids: string[] = [];
  for (const id of extra) {
    const value = String(id || '').trim();
    if (value && !ids.includes(value)) ids.push(value);
  }
  return ids;
}

export function invoicePayStatusDecision(
  row: { status?: string | null; invoice_data?: unknown } | null,
  session: string
): { httpStatus: number; body: Record<string, unknown> } {
  if (!row) return { httpStatus: 404, body: { ...INVOICE_PAY_STATUS_NOT_FOUND } };
  const dataRecord = parseInvoiceData(row.invoice_data);
  const current = String(dataRecord.stripe_checkout_session_id || '').trim();
  const asked = String(session || '').trim();
  const replaced = replacedCheckoutSessionIds(row.invoice_data);
  const knownSession =
    !!asked && (asked === current || replaced.includes(asked) || sessionMatchesInvoice(row.invoice_data, asked));
  if (isVoidInvoiceStatus(row.status) || dataRecord.voided === true) {
    if (!knownSession) return { httpStatus: 404, body: { ...INVOICE_PAY_STATUS_NOT_FOUND } };
    return { httpStatus: 200, body: { voided: true, message: VOIDED_INVOICE_MESSAGE } };
  }
  if (asked && asked !== current && replaced.includes(asked)) {
    return {
      httpStatus: 200,
      body: { voided: false, payable: false, message: INVOICE_PAY_LINK_REPLACED },
    };
  }
  if (!asked || !sessionMatchesInvoice(row.invoice_data, asked)) {
    return { httpStatus: 404, body: { ...INVOICE_PAY_STATUS_NOT_FOUND } };
  }
  const paymentUrl = String(dataRecord.payment_url || '').trim();
  if (!paymentUrl) {
    return { httpStatus: 200, body: { voided: false, payable: false, message: 'This invoice has no payment link.' } };
  }
  return { httpStatus: 200, body: { voided: false, payable: true, paymentUrl } };
}
