import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buyerConnectBlockedMessage,
  canStartStripeConnect,
  checkoutKind,
  invoicePayoutRecord,
  listingQuantityAfterSale,
  normalizeStripeAccountId,
  partOrderFromCheckoutSession,
  platformFeeCents,
  readPartnerReferralUrl,
  routeSellerCardPayment,
  safeConnectNext,
  sellerConnectPrompt,
  signConnectState,
  verifyConnectState,
  webhookCheckoutAction,
  emptyPayoutAccount,
} from './stripe-connect.ts';
import { buildInvoiceCheckoutParams, createInvoiceCheckoutSession } from './stripe-pay.ts';

const connected = {
  accountId: 'acct_shop123',
  chargesEnabled: true,
  payoutsEnabled: true,
  detailsSubmitted: true,
};

test('missing Connect account does not build a platform charge', async () => {
  const route = routeSellerCardPayment({
    account: emptyPayoutAccount(),
    amountCents: 2500,
    partnerUrl: null,
  });
  assert.equal(route.ok, false);
  if (!route.ok) {
    assert.equal(route.code, 'stripe_connect_required');
    assert.equal(route.prompt.partnerUrl, null);
    assert.match(route.prompt.partnerMissingMessage || '', /platform admin/i);
    assert.equal(route.prompt.connectPath, '/api/billing/stripe/connect');
    assert.equal('fields' in route, false);
  }
  assert.equal(
    buildInvoiceCheckoutParams({
      amountCents: 2500,
      description: 'Invoice 9',
      invoiceId: 9,
      destinationAccountId: '',
      payoutStatus: 'transferred',
    }),
    null
  );

  let fetched = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetched = true;
    throw new Error('platform checkout must not be created');
  }) as typeof fetch;
  try {
    const outcome = await createInvoiceCheckoutSession({
      amountCents: 2500,
      description: 'Invoice 9',
      invoiceId: 9,
      destinationAccountId: 'not-an-account',
      payoutStatus: 'transferred',
    });
    assert.equal(fetched, false);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.code, 'stripe_connect_required');
      assert.match(outcome.message, /will not charge them on the platform account/i);
      assert.ok(outcome.prompt);
      assert.equal(outcome.prompt.connectPath, '/api/billing/stripe/connect');
    }
  } finally {
    globalThis.fetch = original;
  }
});

test('partner referral URL is used when set and rejected when it is not a link', () => {
  const previous = process.env.STRIPE_PARTNER_REFERRAL_URL;
  process.env.STRIPE_PARTNER_REFERRAL_URL = 'https://connect.stripe.com/oauth/v2/authorize?client_id=ca_partner';
  try {
    const prompt = sellerConnectPrompt({
      partnerUrl: 'https://dashboard.stripe.com/partner/larry',
      hasAccount: false,
      chargesEnabled: false,
    });
    assert.equal(prompt.partnerUrl, 'https://dashboard.stripe.com/partner/larry');
    assert.equal(prompt.partnerMissingMessage, null);
    const route = routeSellerCardPayment({
      account: emptyPayoutAccount(),
      amountCents: 1000,
    });
    assert.equal(route.ok, false);
    if (!route.ok) {
      assert.equal(
        route.prompt.partnerUrl,
        'https://connect.stripe.com/oauth/v2/authorize?client_id=ca_partner'
      );
    }
  } finally {
    if (previous == null) delete process.env.STRIPE_PARTNER_REFERRAL_URL;
    else process.env.STRIPE_PARTNER_REFERRAL_URL = previous;
  }
  assert.equal(readPartnerReferralUrl(''), null);
  assert.equal(readPartnerReferralUrl('javascript:alert(1)'), null);
  assert.equal(readPartnerReferralUrl('not a url'), null);
});

test('invoice and parts routes use the connected account when it can charge', () => {
  const route = routeSellerCardPayment({
    account: connected,
    amountCents: 10000,
    partnerUrl: null,
  });
  assert.equal(route.ok, true);
  if (!route.ok) return;
  assert.equal(route.fields['payment_intent_data[transfer_data][destination]'], 'acct_shop123');
  assert.equal(route.fields['payment_intent_data[on_behalf_of]'], 'acct_shop123');
  assert.equal(route.fields['payment_intent_data[application_fee_amount]'], undefined);
  assert.equal(route.payoutStatus, 'transferred');

  const params = buildInvoiceCheckoutParams({
    amountCents: 10000,
    description: 'Invoice 12',
    invoiceId: 12,
    invoiceNumber: 'INV-12',
    destinationAccountId: route.accountId,
    payoutStatus: route.payoutStatus,
    applicationFeeCents: route.applicationFeeCents,
    organizationId: 44,
    paymentKind: 'balance',
  });
  assert.ok(params);
  assert.equal(params?.get('metadata[kind]'), 'invoice_pay');
  assert.equal(params?.get('payment_intent_data[transfer_data][destination]'), 'acct_shop123');
  assert.equal(params?.get('payment_intent_data[on_behalf_of]'), 'acct_shop123');
  assert.equal(params?.get('payment_intent_data[application_fee_amount]'), null);
  assert.equal(params?.get('metadata[seller_organization_id]'), '44');
  assert.equal(params?.get('metadata[stripe_destination_account]'), 'acct_shop123');
});

test('pending bank payout still targets the connected account and is marked held', () => {
  const route = routeSellerCardPayment({
    account: { ...connected, payoutsEnabled: false },
    amountCents: 4000,
    partnerUrl: null,
  });
  assert.equal(route.ok, true);
  if (!route.ok) return;
  assert.equal(route.payoutStatus, 'held');
  assert.equal(route.fields['payment_intent_data[transfer_data][destination]'], 'acct_shop123');
  assert.equal(route.fields['metadata[payout_status]'], 'held');
});

test('platform fee defaults to 0 and stays below the charge', () => {
  assert.equal(platformFeeCents(10000, undefined), 0);
  assert.equal(platformFeeCents(10000, '0'), 0);
  assert.equal(platformFeeCents(10000, 250), 250);
  assert.equal(platformFeeCents(50, 10000), 0);
  const route = routeSellerCardPayment({
    account: connected,
    amountCents: 10000,
    partnerUrl: null,
  });
  assert.equal(route.ok, true);
  if (!route.ok) return;
  const params = buildInvoiceCheckoutParams({
    amountCents: 10000,
    description: 'Fee',
    destinationAccountId: 'acct_shop123',
    payoutStatus: 'transferred',
    applicationFeeCents: 250,
  });
  assert.equal(params?.get('payment_intent_data[application_fee_amount]'), '250');
});

test('parts webhook records marketplace_kind part and does not treat it as an upgrade', () => {
  const session = {
    id: 'cs_live_part',
    status: 'complete',
    payment_status: 'paid',
    mode: 'payment',
    amount_total: 15900,
    currency: 'usd',
    metadata: {
      marketplace_kind: 'part',
      marketplace_listing_id: 'listing-1',
      seller_organization_id: '77',
      stripe_destination_account: 'acct_seller',
      payout_status: 'transferred',
      quantity: '2',
      application_fee_cents: '0',
    },
    payment_intent: 'pi_123',
    customer_details: { email: 'buyer@example.com' },
  };
  assert.equal(checkoutKind(session), 'part');
  assert.equal(webhookCheckoutAction(session), 'part');
  assert.notEqual(webhookCheckoutAction(session), 'upgrade');
  const order = partOrderFromCheckoutSession(session);
  assert.equal(order.ok, true);
  if (!order.ok) return;
  assert.equal(order.order.listingId, 'listing-1');
  assert.equal(order.order.stripeAccountId, 'acct_seller');
  assert.equal(order.order.payoutStatus, 'transferred');
  assert.equal(order.order.quantity, 2);
  assert.equal(order.order.buyerEmail, 'buyer@example.com');
  assert.equal(order.order.sellerOrganizationId, '77');
});

test('a paid parts checkout without a destination is recorded as held, not dropped', () => {
  const order = partOrderFromCheckoutSession({
    id: 'cs_live_legacy',
    status: 'complete',
    payment_status: 'paid',
    mode: 'payment',
    amount_total: 5000,
    metadata: {
      marketplace_kind: 'part',
      marketplace_listing_id: 'listing-2',
    },
  });
  assert.equal(order.ok, true);
  if (!order.ok) return;
  assert.equal(order.order.payoutStatus, 'held');
  assert.equal(order.order.stripeAccountId, null);
  assert.equal(listingQuantityAfterSale(3, order.order.quantity).quantity, 2);
  assert.equal(listingQuantityAfterSale(1, 1).soldOut, true);
});

test('invoice checkout is not a parts order, and payout destination is stored on the invoice', () => {
  const invoice = {
    id: 'cs_live_inv',
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    amount_total: 8000,
    metadata: { kind: 'invoice_pay', invoice_id: '12', stripe_destination_account: 'acct_shop123' },
  };
  assert.equal(checkoutKind(invoice), 'invoice');
  assert.equal(webhookCheckoutAction(invoice), 'invoice');
  assert.equal(partOrderFromCheckoutSession(invoice).ok, false);
  assert.deepEqual(invoicePayoutRecord(invoice.metadata), {
    stripe_destination_account: 'acct_shop123',
    payout_status: 'transferred',
  });
  assert.deepEqual(invoicePayoutRecord({ invoice_id: '12' }), {
    stripe_destination_account: null,
    payout_status: 'held',
  });
});

test('connect onboarding is for shops and parts suppliers, and the return path stays on-site', () => {
  assert.equal(canStartStripeConnect('company_admin', 'service_company'), true);
  assert.equal(canStartStripeConnect('billing_manager', 'service_company'), true);
  assert.equal(canStartStripeConnect('fse', 'service_company'), false);
  assert.equal(canStartStripeConnect('parts_supplier', 'parts_supplier'), true);
  assert.equal(canStartStripeConnect('owner', 'laser_clinic'), false);
  assert.equal(safeConnectNext('https://evil.example/phish'), '/company');
  assert.equal(safeConnectNext('/marketplace/parts/abc'), '/marketplace/parts/abc');
  assert.equal(normalizeStripeAccountId('acct_ok'), 'acct_ok');
  assert.equal(normalizeStripeAccountId('sk_live_secret'), null);
  assert.match(buyerConnectBlockedMessage(), /not charged/i);

  const token = signConnectState(
    { orgId: '15', accountId: 'acct_ok', next: '/onboarding' },
    'state-secret',
    1_700_000_000_000
  );
  const parsed = verifyConnectState(token, 'state-secret', 1_700_000_000_000);
  assert.equal(parsed?.orgId, '15');
  assert.equal(parsed?.next, '/onboarding');
  assert.equal(verifyConnectState(token, 'other-secret', 1_700_000_000_000), null);
  assert.equal(verifyConnectState(token, 'state-secret', 1_700_000_000_000 + 3 * 60 * 60 * 1000), null);
});
