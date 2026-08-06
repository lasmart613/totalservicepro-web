/**
 * Create a one-time Stripe Checkout Session URL for an invoice balance.
 * Requires STRIPE_SECRET_KEY in the environment (sk_test_… or sk_live_…).
 */

export type InvoicePayLinkInput = {
  amountCents: number;
  currency?: string;
  description: string;
  invoiceId?: string | number | null;
  invoiceNumber?: string | null;
  customerEmail?: string | null;
  companyName?: string | null;
};

export type InvoicePayLinkResult = {
  url: string;
  sessionId: string;
};

export async function createInvoiceCheckoutSession(
  input: InvoicePayLinkInput
): Promise<InvoicePayLinkResult | null> {
  const secret = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET;
  if (!secret) {
    console.warn('createInvoiceCheckoutSession: STRIPE_SECRET_KEY not set');
    return null;
  }
  const amount = Math.round(Number(input.amountCents) || 0);
  if (amount < 50) {
    // Stripe minimum is typically $0.50 USD
    return null;
  }

  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://repairplanet.net').replace(
    /\/$/,
    ''
  );
  const currency = (input.currency || 'usd').toLowerCase();
  const desc =
    input.description ||
    `Invoice ${input.invoiceNumber || ''}`.trim() ||
    'Service invoice';

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', `${site}/invoices?paid=1&session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${site}/invoices?paid=0`);
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', currency);
  params.set('line_items[0][price_data][unit_amount]', String(amount));
  params.set('line_items[0][price_data][product_data][name]', desc.slice(0, 120));
  if (input.companyName) {
    params.set(
      'line_items[0][price_data][product_data][description]',
      `Payment to ${input.companyName}`.slice(0, 500)
    );
  }
  if (input.customerEmail) {
    params.set('customer_email', String(input.customerEmail).trim());
  }
  if (input.invoiceId != null) {
    params.set('metadata[invoice_id]', String(input.invoiceId));
  }
  if (input.invoiceNumber) {
    params.set('metadata[invoice_number]', String(input.invoiceNumber));
  }
  params.set('payment_intent_data[metadata][invoice_id]', String(input.invoiceId || ''));
  params.set('payment_intent_data[metadata][invoice_number]', String(input.invoiceNumber || ''));

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.url) {
    console.error('Stripe checkout session failed', data);
    return null;
  }
  return { url: data.url as string, sessionId: data.id as string };
}
