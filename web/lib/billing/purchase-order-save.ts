/**
 * Save payload for the purchase-order form.
 * A sent row must not be written back to draft, and this path never stamps sent_at.
 * The send route stamps status and sent_at with the service-role client.
 */

export function isSentPurchaseOrder(status: unknown, sentAt?: unknown): boolean {
  if (String(status ?? '').trim().toLowerCase() === 'sent') return true;
  if (sentAt == null) return false;
  return String(sentAt).trim() !== '';
}

export function purchaseOrderSavePayload(
  payload: Record<string, unknown>,
  opts: { alreadySent: boolean; nextStatus: string }
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...payload };
  delete body.sent_at;
  if (!opts.alreadySent) return body;
  delete body.supplier_email;
  delete body.supplier_organization_id;
  delete body.supplier_name;
  if (opts.nextStatus !== 'sent') delete body.status;
  return body;
}
