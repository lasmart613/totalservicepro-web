/**
 * Keys a signed-in client must not write on service_invoices.invoice_data.
 * The service role still writes them when it creates or credits a Checkout Session.
 * A direct table update is also stripped by 20261122_000969, because authenticated
 * has table-level UPDATE and the invoice form writes with the user JWT.
 */

export function isClientLockedInvoicePaymentKey(key: string): boolean {
  const name = key.toLowerCase();
  return (
    name === 'payment_url' ||
    name.includes('checkout_session') ||
    name.includes('payment_intent') ||
    name === 'stripe_checkout_expired_ids' ||
    name === 'stripe_checkout_expired_at' ||
    name === 'stripe_session_id'
  );
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (typeof value !== 'string') return {};
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }
  return value as Record<string, unknown>;
}

/**
 * Keep every non-payment field from `next`, and copy payment-link keys from
 * `stored`. A client-supplied payment_url or Checkout session id does not land.
 */
export function sealClientInvoicePaymentKeys(
  stored: unknown,
  next: Record<string, unknown>
): Record<string, unknown> {
  const sealed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (!isClientLockedInvoicePaymentKey(key)) sealed[key] = value;
  }
  for (const [key, value] of Object.entries(objectRecord(stored))) {
    if (isClientLockedInvoicePaymentKey(key)) sealed[key] = value;
  }
  return sealed;
}
