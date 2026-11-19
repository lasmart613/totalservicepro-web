import assert from 'node:assert/strict';
import test from 'node:test';
import { createInvoiceCheckoutSession } from './stripe-pay.ts';

test('a replacement Checkout session sends the Idempotency-Key header', async () => {
  const previousSecret = process.env.STRIPE_SECRET_KEY;
  const previousUrl = process.env.URL;
  const previousPrime = process.env.DEPLOY_PRIME_URL;
  const previousSite = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit_idempotency';
  delete process.env.URL;
  delete process.env.DEPLOY_PRIME_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  const original = globalThis.fetch;
  let header = '';
  globalThis.fetch = (async (_url: unknown, init?: { headers?: Record<string, string> }) => {
    header = String(init?.headers?.['Idempotency-Key'] || '');
    return new Response(JSON.stringify({ id: 'cs_test_new', url: 'https://pay.example/new', livemode: false }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const result = await createInvoiceCheckoutSession({
      amountCents: 12000,
      description: 'Invoice 42',
      invoiceId: 42,
      legacyPlatformCharge: true,
      idempotencyKey: 'invoice-42-replace-cs_test_open',
    });
    assert.equal(result.ok, true);
    assert.equal(header, 'invoice-42-replace-cs_test_open');
  } finally {
    globalThis.fetch = original;
    if (previousSecret == null) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousSecret;
    if (previousUrl == null) delete process.env.URL;
    else process.env.URL = previousUrl;
    if (previousPrime == null) delete process.env.DEPLOY_PRIME_URL;
    else process.env.DEPLOY_PRIME_URL = previousPrime;
    if (previousSite == null) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previousSite;
  }
});
