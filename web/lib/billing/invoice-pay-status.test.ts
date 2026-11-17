import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { VOIDED_INVOICE_MESSAGE } from './void-invoice.ts';
import { INVOICE_PAYMENT_LINK_UNAVAILABLE } from './invoice-payment-url.ts';
import { runInvoicePayStatus, type InvoicePayStatusDeps } from '../../app/api/billing/invoices/pay-status/route.ts';

const CHECKOUT = 'https://checkout.stripe.com/c/pay/cs_live_1#fidkdWxOYHwn';
const SESSION = 'cs_live_1';

function request(query: string) {
  return new NextRequest(`https://repairplanet.net/api/billing/invoices/pay-status${query}`);
}

function deps(row: { status?: string | null; invoice_data?: unknown } | null, error: { message?: string } | null = null): InvoicePayStatusDeps {
  return {
    hasServiceRole: () => true,
    loadInvoice: async () => ({ data: row, error }),
  };
}

async function snapshot(res: Response) {
  const headers: [string, string][] = [];
  res.headers.forEach((value, key) => headers.push([key, value]));
  headers.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  return { status: res.status, body: await res.text(), headers };
}

test('a matching session returns only an allowed Checkout URL', async () => {
  const res = await runInvoicePayStatus(
    request('?id=9&session=' + SESSION),
    deps({
      status: 'sent',
      invoice_data: { payment_url: '  HTTPS://checkout.stripe.com/c/pay/cs_live_1#fidkdWxOYHwn  ', stripe_checkout_session_id: SESSION },
    })
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { voided: false, payable: true, paymentUrl: CHECKOUT });
});

test('a bad payment_url is the same unavailable response as a missing link', async () => {
  const row = {
    status: 'sent',
    invoice_data: { stripe_checkout_session_id: SESSION, payment_url: CHECKOUT },
  };
  const missing = await snapshot(
    await runInvoicePayStatus(
      request('?id=9&session=' + SESSION),
      deps({ status: 'sent', invoice_data: { stripe_checkout_session_id: SESSION } })
    )
  );
  const attacks = [
    'https://evil.example/phish',
    'http://checkout.stripe.com/c/pay/cs_live_1',
    'javascript:alert(1)',
    '//checkout.stripe.com/c/pay/cs_live_1',
    'https://user:pass@checkout.stripe.com/c/pay/cs_live_1',
    'https://@checkout.stripe.com/c/pay/cs_live_1',
    'https://checkout.stripe.com:444/c/pay/cs_live_1',
    'https://checkout.stripe.com.evil.com/c/pay/cs_live_1',
    'https://evil.checkout.stripe.com/c/pay/cs_live_1',
    'https://checkout.stripe.com%2e.evil.com/c/pay/cs',
    'https://invoice.stripe.com/i/acct_real',
    'https://buy.stripe.com/test_abc',
    'https://pay.stripe.com/receipts/in_1',
    '',
  ];
  for (const payment_url of attacks) {
    const shot = await snapshot(
      await runInvoicePayStatus(
        request('?id=9&session=' + SESSION),
        deps({
          status: row.status,
          invoice_data: { ...row.invoice_data, payment_url },
        })
      )
    );
    assert.deepEqual(shot, missing, payment_url);
    assert.equal(shot.body.includes('evil'), false, payment_url);
    assert.equal(shot.body.includes('javascript'), false, payment_url);
    assert.equal(JSON.parse(shot.body).message, INVOICE_PAYMENT_LINK_UNAVAILABLE);
  }
});

test('voided is returned only for a matching checkout session', async () => {
  const missingInvoice = await snapshot(await runInvoicePayStatus(request('?id=9&session=' + SESSION), deps(null)));
  const loadError = await snapshot(
    await runInvoicePayStatus(request('?id=9'), deps(null, { message: 'db down' }))
  );
  const voided = {
    status: 'void',
    invoice_data: {
      voided: true,
      payment_url: 'https://evil.example/phish',
      stripe_checkout_session_id: SESSION,
    },
  };
  const voidedNoSession = await snapshot(await runInvoicePayStatus(request('?id=9'), deps(voided)));
  const voidedWrongSession = await snapshot(
    await runInvoicePayStatus(request('?id=9&session=cs_other'), deps(voided))
  );
  const sentNoSession = await snapshot(
    await runInvoicePayStatus(
      request('?id=9'),
      deps({ status: 'sent', invoice_data: { stripe_checkout_session_id: SESSION, payment_url: CHECKOUT } })
    )
  );
  const sentWrongSession = await snapshot(
    await runInvoicePayStatus(
      request('?id=9&session=cs_other'),
      deps({ status: 'sent', invoice_data: { stripe_checkout_session_id: SESSION, payment_url: CHECKOUT } })
    )
  );

  assert.deepEqual(voidedNoSession, missingInvoice);
  assert.deepEqual(voidedWrongSession, missingInvoice);
  assert.deepEqual(sentNoSession, missingInvoice);
  assert.deepEqual(sentWrongSession, missingInvoice);
  assert.deepEqual(loadError, missingInvoice);
  assert.equal(missingInvoice.status, 404);
  assert.equal(missingInvoice.body.includes('void'), false);

  const revealed = await runInvoicePayStatus(request('?id=9&session=' + SESSION), deps(voided));
  assert.equal(revealed.status, 200);
  assert.deepEqual(await revealed.json(), { voided: true, message: VOIDED_INVOICE_MESSAGE });
});

test('a voided flag inside invoice_data stays hidden without the session', async () => {
  const hidden = await snapshot(
    await runInvoicePayStatus(
      request('?id=9'),
      deps({
        status: 'sent',
        invoice_data: { voided: true, stripe_checkout_session_id: SESSION },
      })
    )
  );
  const missing = await snapshot(await runInvoicePayStatus(request('?id=missing'), deps(null)));
  assert.deepEqual(hidden, missing);
});

test('missing id and a missing service role are not the not-found body', async () => {
  const missingId = await runInvoicePayStatus(request(''), deps(null));
  assert.equal(missingId.status, 400);
  const unavailable = await runInvoicePayStatus(request('?id=9&session=' + SESSION), {
    hasServiceRole: () => false,
    loadInvoice: async () => {
      throw new Error('must not load');
    },
  });
  assert.equal(unavailable.status, 503);
});
