import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  authorizeConnectCallback,
  buyerConnectBlockedMessage,
  canStartStripeConnect,
  checkoutKind,
  decideSellerChargeRoute,
  invoicePayoutRecord,
  isStripeConnectExemptOrg,
  listingQuantityAfterSale,
  normalizeStripeAccountId,
  partOrderFromCheckoutSession,
  platformFeeCents,
  readPartnerReferralUrl,
  routeSellerCardPayment,
  safeConnectNext,
  sellerConnectPrompt,
  signConnectState,
  stripeConnectEnforceEnabled,
  verifyConnectState,
  webhookCheckoutAction,
  emptyPayoutAccount,
} from './stripe-connect.ts';
import {
  completeOnboardingReturn,
  connectLinkUrls,
  connectSiteOrigin,
  connectStatusPayload,
  isMissingStripeColumn,
  loadSellerPayoutAccount,
  refreshOnboardingFromState,
} from './stripe-connect-api.ts';
import { buildPartCheckoutSessionFields } from './stripe-marketplace.ts';
import {
  buildInvoiceCheckoutParams,
  buildLegacyInvoiceCheckoutParams,
  createInvoiceCheckoutSession,
  stripeSiteOrigin,
} from './stripe-pay.ts';

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

test('only admin and company_admin can start Connect, and the return path stays on-site', () => {
  assert.equal(canStartStripeConnect('admin', 'service_company'), true);
  assert.equal(canStartStripeConnect('company_admin', 'service_company'), true);
  assert.equal(canStartStripeConnect('company_admin', 'parts_supplier'), true);
  assert.equal(canStartStripeConnect('admin', 'vendor'), true);
  assert.equal(canStartStripeConnect('billing_manager', 'service_company'), false);
  assert.equal(canStartStripeConnect('service_manager', 'service_company'), false);
  assert.equal(canStartStripeConnect('parts_supplier', 'parts_supplier'), false);
  assert.equal(canStartStripeConnect('parts_supplier', 'service_company'), false);
  assert.equal(canStartStripeConnect('supplier', 'vendor'), false);
  assert.equal(canStartStripeConnect('fse', 'service_company'), false);
  assert.equal(canStartStripeConnect('owner', 'laser_clinic'), false);
  const hidden = connectStatusPayload({
    userId: 'tech',
    email: null,
    role: 'billing_manager',
    orgId: 4,
    orgType: 'service_company',
    orgName: 'Luxor',
    orgEmail: null,
    account: emptyPayoutAccount(),
    schemaReady: true,
  });
  assert.equal(hidden.eligible, false);
  assert.equal(hidden.canStart, false);
  const supplierMember = connectStatusPayload({
    ...hidden,
    userId: 'supplier',
    role: 'parts_supplier',
    orgType: 'parts_supplier',
  } as never);
  assert.equal(supplierMember.eligible, false);
  const adminCard = connectStatusPayload({
    userId: 'admin',
    email: null,
    role: 'company_admin',
    orgId: 4,
    orgType: 'service_company',
    orgName: 'Luxor',
    orgEmail: null,
    account: emptyPayoutAccount(),
    schemaReady: true,
  });
  assert.equal(adminCard.eligible, true);
  assert.equal(adminCard.canStart, true);
  assert.equal(safeConnectNext('https://evil.example/phish'), '/company');
  assert.equal(safeConnectNext('/marketplace/parts/abc'), '/marketplace/parts/abc');
  assert.equal(normalizeStripeAccountId('acct_ok'), 'acct_ok');
  assert.equal(normalizeStripeAccountId('sk_' + 'live_secret'), null);
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

test('stripe columns are not re-granted and are not written from the browser', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationName = '20261006_000802_stripe_connect_payouts.sql';
  assert.ok(migrationName > '20261006_000801');
  const sql = readFileSync(join(here, '../../supabase/migrations', migrationName), 'utf8');
  assert.match(sql, /stripe_account_id/);
  assert.doesNotMatch(sql, /GRANT\s+(INSERT|UPDATE|ALL|TRUNCATE)\b/i);
  assert.match(sql, /REVOKE UPDATE \(\s*stripe_account_id/i);
  assert.doesNotMatch(sql, /GRANT\s+(UPDATE|INSERT|ALL)\s+ON\s+TABLE\s+public\.(organizations|user_profiles|marketplace_listings)/i);
  assert.match(sql, /GRANT SELECT ON TABLE public\.marketplace_orders TO authenticated/i);
  const firstSql = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim()
    .split(';')[0]
    .trim();
  assert.equal(firstSql, "SET LOCAL lock_timeout = '5s'");
  assert.doesNotMatch(sql, /\bCONCURRENTLY\b/i);
  assert.doesNotMatch(sql, /\bCOMMIT\b/i);
  assert.match(sql, /revoke all on table public\.marketplace_orders from public, anon/i);
  assert.match(sql, /'admin', 'company_admin', 'billing_manager'/);
  assert.match(sql, /\(select auth\.uid\(\)\)/);
  assert.doesNotMatch(sql, /where id = auth\.uid\(\)/i);
  assert.doesNotMatch(sql, /part_vendors|accept_team_invite/);
  assert.doesNotMatch(sql, /GRANT[^;]*created_by/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.organizations_guard_privilege/);
  assert.match(sql, /IF auth\.uid\(\) IS NULL THEN/);
  assert.match(sql, /created_by cannot be changed/);
  assert.match(sql, /plan and premium fields cannot be changed by the client/);
  assert.match(sql, /stripe_account_id/);
  assert.match(sql, /stripe_charges_enabled/);
  assert.match(sql, /stripe_payouts_enabled/);
  assert.match(sql, /stripe_details_submitted/);
  assert.match(sql, /stripe connect fields cannot be changed by the client/);

  const api = readFileSync(join(here, 'stripe-connect-api.ts'), 'utf8');
  assert.match(api, /writer \|\| getSupabaseAdmin\(\)/);
  const card = readFileSync(join(here, '../../components/StripeConnectCard.tsx'), 'utf8');
  assert.doesNotMatch(card, /from\(['"]organizations['"]\)/);
  assert.doesNotMatch(card, /stripe_account_id/);
  const company = readFileSync(join(here, '../../app/company/page.tsx'), 'utf8');
  const listings = readFileSync(join(here, '../../app/marketplace/my-listings/page.tsx'), 'utf8');
  const part = readFileSync(join(here, '../../app/marketplace/parts/[id]/page.tsx'), 'utf8');
  for (const src of [company, listings, part, card]) {
    assert.doesNotMatch(src, /stripe_account_id|stripe_charges_enabled|stripe_payouts_enabled|stripe_details_submitted/);
  }
  assert.match(card, /eligible === false/);
});

function mainInvoiceParams(input: {
  amountCents: number;
  description: string;
  invoiceId: number;
  invoiceNumber: string;
  customerEmail: string;
  companyName: string;
  paymentKind: 'balance';
}): URLSearchParams {
  const site = stripeSiteOrigin();
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', `${site}/invoice-paid?session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${site}/invoice-paid?canceled=1`);
  params.set('metadata[kind]', 'invoice_pay');
  params.set('metadata[payment_kind]', input.paymentKind);
  params.set('payment_intent_data[metadata][payment_kind]', input.paymentKind);
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(input.amountCents));
  params.set('line_items[0][price_data][product_data][name]', input.description.slice(0, 120));
  params.set(
    'line_items[0][price_data][product_data][description]',
    `Payment to ${input.companyName}`.slice(0, 500)
  );
  params.set('customer_email', input.customerEmail);
  params.set('metadata[invoice_id]', String(input.invoiceId));
  params.set('metadata[invoice_number]', input.invoiceNumber);
  params.set('payment_intent_data[metadata][invoice_id]', String(input.invoiceId));
  params.set('payment_intent_data[metadata][invoice_number]', input.invoiceNumber);
  return params;
}

function assertSameSearchParams(actual: URLSearchParams, expected: URLSearchParams) {
  assert.deepEqual([...actual.entries()].sort(), [...expected.entries()].sort());
  const joined = [...actual.keys(), ...actual.values()].join(' ');
  assert.doesNotMatch(joined, /transfer_data|application_fee|on_behalf_of/);
}

function mainPartFields(input: {
  site: string;
  listingId: string;
  priceId: string;
  quantity: number;
  maxQuantity: number | null;
  customerEmail?: string | null;
}): Record<string, string | number | boolean> {
  const success = `${input.site}/marketplace/parts/${encodeURIComponent(input.listingId)}?paid=1&session_id={CHECKOUT_SESSION_ID}`;
  const cancel = `${input.site}/marketplace/parts/${encodeURIComponent(input.listingId)}?paid=0`;
  const fields: Record<string, string | number | boolean> = {
    mode: 'payment',
    success_url: success,
    cancel_url: cancel,
    'line_items[0][price]': input.priceId,
    'line_items[0][quantity]': input.quantity,
    'metadata[marketplace_listing_id]': input.listingId,
    'metadata[marketplace_kind]': 'part',
    'payment_intent_data[metadata][marketplace_listing_id]': input.listingId,
    'payment_intent_data[metadata][marketplace_kind]': 'part',
    'shipping_address_collection[allowed_countries][0]': 'US',
    billing_address_collection: 'auto',
  };
  if (input.maxQuantity != null && input.maxQuantity > 1) {
    fields['line_items[0][adjustable_quantity][enabled]'] = 'true';
    fields['line_items[0][adjustable_quantity][minimum]'] = 1;
    fields['line_items[0][adjustable_quantity][maximum]'] = input.maxQuantity;
  }
  const email = input.customerEmail ? String(input.customerEmail).trim() : '';
  if (email.includes('@')) fields.customer_email = email;
  return fields;
}

const invoiceSample = {
  amountCents: 2500,
  description: 'Invoice INV-9',
  invoiceId: 9,
  invoiceNumber: 'INV-9',
  customerEmail: 'buyer@example.com',
  companyName: 'Luxor Photonix',
  paymentKind: 'balance' as const,
};

test('enforce off sends main platform params for an unconnected company', async () => {
  const previousEnforce = process.env.STRIPE_CONNECT_ENFORCE;
  const previousExempt = process.env.STRIPE_CONNECT_EXEMPT_ORG_IDS;
  const previousSecret = process.env.STRIPE_SECRET_KEY;
  const previousContext = process.env.CONTEXT;
  delete process.env.STRIPE_CONNECT_ENFORCE;
  delete process.env.STRIPE_CONNECT_EXEMPT_ORG_IDS;
  process.env.STRIPE_SECRET_KEY = 'sk_test_platform_example';
  process.env.CONTEXT = 'dev';
  try {
    assert.equal(stripeConnectEnforceEnabled(), false);
    assert.equal(isStripeConnectExemptOrg(4), true);
    assert.equal(isStripeConnectExemptOrg(99), false);
    const decision = decideSellerChargeRoute({
      organizationId: 99,
      account: emptyPayoutAccount(),
      amountCents: invoiceSample.amountCents,
      schemaReady: true,
      partnerUrl: null,
    });
    assert.equal(decision.mode, 'legacy');

    const expected = mainInvoiceParams(invoiceSample);
    const built = buildLegacyInvoiceCheckoutParams(invoiceSample);
    assert.ok(built);
    assertSameSearchParams(built, expected);

    let body = '';
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      body = String(init?.body || '');
      return new Response(JSON.stringify({ id: 'cs_test_legacy', url: 'https://checkout.stripe.com/c/pay/cs_test_legacy', livemode: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const outcome = await createInvoiceCheckoutSession({
        ...invoiceSample,
        legacyPlatformCharge: true,
      });
      assert.equal(outcome.ok, true);
      assertSameSearchParams(new URLSearchParams(body), expected);
    } finally {
      globalThis.fetch = original;
    }

    const site = stripeSiteOrigin();
    const partExpected = mainPartFields({
      site,
      listingId: 'listing-9',
      priceId: 'price_123',
      quantity: 2,
      maxQuantity: 5,
      customerEmail: 'buyer@example.com',
    });
    const partFields = buildPartCheckoutSessionFields({
      site,
      listingId: 'listing-9',
      priceId: 'price_123',
      quantity: 2,
      maxQuantity: 5,
      customerEmail: 'buyer@example.com',
      charge: { mode: 'legacy' },
    });
    assert.deepEqual(partFields, partExpected);
    const encoded = new URLSearchParams();
    for (const [key, value] of Object.entries(partFields)) encoded.set(key, String(value));
    const partBody = encoded.toString();
    assert.doesNotMatch(partBody, /transfer_data|application_fee|on_behalf_of|seller_organization_id/);
    assert.match(partBody, /metadata%5Bmarketplace_kind%5D=part/);
  } finally {
    if (previousEnforce == null) delete process.env.STRIPE_CONNECT_ENFORCE;
    else process.env.STRIPE_CONNECT_ENFORCE = previousEnforce;
    if (previousExempt == null) delete process.env.STRIPE_CONNECT_EXEMPT_ORG_IDS;
    else process.env.STRIPE_CONNECT_EXEMPT_ORG_IDS = previousExempt;
    if (previousSecret == null) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousSecret;
    if (previousContext == null) delete process.env.CONTEXT;
    else process.env.CONTEXT = previousContext;
  }
});

test('org 4 stays on the platform charge even when enforce is on', () => {
  const decision = decideSellerChargeRoute({
    organizationId: 4,
    account: connected,
    amountCents: 2500,
    schemaReady: true,
    enforce: true,
    exemptOrgIds: '4',
    partnerUrl: null,
  });
  assert.equal(decision.mode, 'legacy');
  const params = buildLegacyInvoiceCheckoutParams(invoiceSample);
  assert.ok(params);
  assert.equal(params.get('payment_intent_data[transfer_data][destination]'), null);
  assert.equal(params.get('payment_intent_data[on_behalf_of]'), null);
  assert.equal(params.get('payment_intent_data[application_fee_amount]'), null);
  const fields = buildPartCheckoutSessionFields({
    site: 'https://repairplanet.example',
    listingId: 'listing-4',
    priceId: 'price_4',
    quantity: 1,
    maxQuantity: null,
    charge: { mode: 'legacy' },
  });
  assert.equal(fields['payment_intent_data[transfer_data][destination]'], undefined);
  assert.equal(fields['payment_intent_data[on_behalf_of]'], undefined);
});

test('missing Stripe columns fall back to the platform charge', async () => {
  assert.equal(isMissingStripeColumn({ code: 'PGRST204', message: 'schema cache' }), true);
  assert.equal(isMissingStripeColumn({ code: '42703', message: 'column organizations.stripe_account_id does not exist' }), true);
  assert.equal(isMissingStripeColumn('column stripe_account_id does not exist'), true);
  assert.equal(isMissingStripeColumn({ code: '42501', message: 'permission denied' }), false);

  const writer = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: null, error: { code: 'PGRST204', message: 'Could not find the column in the schema cache' } }),
      };
    },
  };
  const loaded = await loadSellerPayoutAccount(99, writer as never);
  assert.equal(loaded.schemaReady, false);
  const decision = decideSellerChargeRoute({
    organizationId: 99,
    account: loaded.account,
    amountCents: 2500,
    schemaReady: loaded.schemaReady,
    enforce: true,
    exemptOrgIds: '4',
    partnerUrl: null,
  });
  assert.equal(decision.mode, 'legacy');
  const params = buildLegacyInvoiceCheckoutParams(invoiceSample);
  assert.ok(params);
  assert.equal(params.get('payment_intent_data[transfer_data][destination]'), null);
});

test('enforce on with a connected seller uses a destination charge', () => {
  const decision = decideSellerChargeRoute({
    organizationId: 99,
    account: connected,
    amountCents: 10000,
    schemaReady: true,
    enforce: true,
    exemptOrgIds: '4',
    partnerUrl: null,
  });
  assert.equal(decision.mode, 'destination');
  if (decision.mode !== 'destination') return;
  assert.equal(decision.fields['payment_intent_data[transfer_data][destination]'], 'acct_shop123');
  assert.equal(decision.fields['payment_intent_data[on_behalf_of]'], 'acct_shop123');
  assert.equal(decision.fields['payment_intent_data[application_fee_amount]'], undefined);
  const params = buildInvoiceCheckoutParams({
    amountCents: 10000,
    description: 'Invoice 99',
    invoiceId: 99,
    destinationAccountId: decision.accountId,
    payoutStatus: decision.payoutStatus,
    applicationFeeCents: decision.applicationFeeCents,
  });
  assert.equal(params?.get('payment_intent_data[transfer_data][destination]'), 'acct_shop123');
  assert.equal(params?.get('payment_intent_data[on_behalf_of]'), 'acct_shop123');
  const fields = buildPartCheckoutSessionFields({
    site: 'https://repairplanet.example',
    listingId: 'listing-99',
    priceId: 'price_99',
    quantity: 1,
    maxQuantity: null,
    charge: {
      mode: 'destination',
      fields: decision.fields,
      applicationFeeCents: decision.applicationFeeCents,
      sellerOrganizationId: '99',
    },
  });
  assert.equal(fields['payment_intent_data[transfer_data][destination]'], 'acct_shop123');
  assert.equal(fields['payment_intent_data[on_behalf_of]'], 'acct_shop123');
  assert.equal(platformFeeCents(10000, ''), 0);
});

test('Connect return and refresh require the admin who started onboarding', async () => {
  const previousSecret = process.env.STRIPE_SECRET_KEY;
  const previousContext = process.env.CONTEXT;
  const secret = 'sk_test_connect_state';
  process.env.STRIPE_SECRET_KEY = secret;
  process.env.CONTEXT = 'dev';
  const state = { orgId: '4', accountId: 'acct_shop123', next: '/company', userId: 'user-admin' };
  const token = signConnectState(state, secret);
  const admin = { userId: 'user-admin', orgId: 4, role: 'company_admin', orgType: 'service_company' };
  assert.equal(authorizeConnectCallback(state, null).ok, false);
  if (!authorizeConnectCallback(state, null).ok) {
    assert.equal(authorizeConnectCallback(state, null).reason, 'signed_out');
  }
  const otherOrg = authorizeConnectCallback(state, { ...admin, orgId: 99, userId: 'user-other' });
  assert.equal(otherOrg.ok, false);
  if (!otherOrg.ok) assert.equal(otherOrg.reason, 'other_org');
  const tech = authorizeConnectCallback(state, { ...admin, userId: 'user-tech', role: 'billing_manager' });
  assert.equal(tech.ok, false);
  if (!tech.ok) assert.equal(tech.reason, 'not_admin');
  assert.equal(authorizeConnectCallback(state, { ...admin, role: 'fse', userId: 'user-fse' }).ok, false);
  assert.equal(authorizeConnectCallback(state, { ...admin, role: 'parts_supplier', orgType: 'parts_supplier' }).ok, false);
  assert.equal(authorizeConnectCallback(state, admin).ok, true);

  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error('Stripe must not be called');
  }) as typeof fetch;
  const writer = {
    from() {
      throw new Error('organizations must not be written');
    },
  };
  try {
    await assert.rejects(() => completeOnboardingReturn(token, null, writer as never), /company admin/);
    await assert.rejects(
      () => completeOnboardingReturn(token, { ...admin, orgId: 8 }, writer as never),
      /company admin/
    );
    await assert.rejects(
      () => completeOnboardingReturn(token, { ...admin, role: 'service_manager', userId: 'user-sm' }, writer as never),
      /company admin/
    );
    await assert.rejects(() => refreshOnboardingFromState(token, 'https://repairplanet.example', null), /company admin/);
    await assert.rejects(
      () => refreshOnboardingFromState(token, 'https://repairplanet.example', { ...admin, orgId: 8 }),
      /company admin/
    );
    await assert.rejects(
      () =>
        refreshOnboardingFromState(token, 'https://repairplanet.example', {
          ...admin,
          role: 'billing_manager',
          userId: 'user-bill',
        }),
      /company admin/
    );
    assert.equal(calls, 0);

    globalThis.fetch = (async (url: unknown) => {
      calls += 1;
      const href = String(url);
      if (href.includes('/v1/accounts/acct_shop123')) {
        return new Response(
          JSON.stringify({
            id: 'acct_shop123',
            charges_enabled: true,
            payouts_enabled: false,
            details_submitted: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`unexpected ${href}`);
    }) as typeof fetch;
    const updates: Record<string, unknown>[] = [];
    const savingWriter = {
      from() {
        return {
          update(payload: Record<string, unknown>) {
            updates.push(payload);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      },
    };
    const done = await completeOnboardingReturn(token, admin, savingWriter as never);
    assert.equal(done.connected, true);
    assert.equal(done.next, '/company');
    assert.equal(updates.length, 1);
    assert.equal(updates[0].stripe_account_id, 'acct_shop123');
    assert.equal(updates[0].stripe_charges_enabled, true);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    if (previousSecret == null) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousSecret;
    if (previousContext == null) delete process.env.CONTEXT;
    else process.env.CONTEXT = previousContext;
  }
});

const SITE_ORIGIN_ENV = [
  'CONTEXT',
  'NETLIFY_CONTEXT',
  'URL',
  'DEPLOY_PRIME_URL',
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_SITE_ORIGIN',
] as const;

function withSiteOriginEnv(env: Partial<Record<(typeof SITE_ORIGIN_ENV)[number], string>>, run: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const key of SITE_ORIGIN_ENV) previous.set(key, process.env[key]);
  for (const key of SITE_ORIGIN_ENV) {
    const value = env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const key of SITE_ORIGIN_ENV) {
      const value = previous.get(key);
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('a Netlify deploy-hash host still yields repairplanet.net for Connect return_url and refresh_url', () => {
  const deployHash = '6ac4896698c4fd0008d83d92--totalservicepro.netlify.app';
  const req = {
    headers: {
      get(name: string) {
        if (name === 'x-forwarded-host' || name === 'host') return deployHash;
        if (name === 'x-forwarded-proto') return 'https';
        return null;
      },
    },
  };

  withSiteOriginEnv(
    {
      CONTEXT: 'production',
      NEXT_PUBLIC_SITE_URL: 'https://repairplanet.net',
    },
    () => {
      const urls = connectLinkUrls(connectSiteOrigin(req), 'state_tok');
      assert.equal(urls.returnTo, 'https://repairplanet.net/api/billing/stripe/connect/return?state=state_tok');
      assert.equal(urls.refresh, 'https://repairplanet.net/api/billing/stripe/connect/refresh?state=state_tok');
      assert.doesNotMatch(`${urls.returnTo} ${urls.refresh}`, /6ac4896698c4fd0008d83d92/);
    }
  );

  withSiteOriginEnv(
    {
      CONTEXT: 'deploy-preview',
      NEXT_PUBLIC_SITE_URL: 'https://repairplanet.net',
      DEPLOY_PRIME_URL: 'https://deploy-preview-224--totalservicepro.netlify.app',
    },
    () => {
      const urls = connectLinkUrls(connectSiteOrigin(req), 'state_tok');
      assert.equal(
        urls.returnTo,
        'https://deploy-preview-224--totalservicepro.netlify.app/api/billing/stripe/connect/return?state=state_tok'
      );
      assert.equal(
        urls.refresh,
        'https://deploy-preview-224--totalservicepro.netlify.app/api/billing/stripe/connect/refresh?state=state_tok'
      );
    }
  );

  const here = dirname(fileURLToPath(import.meta.url));
  const onboarding = readFileSync(join(here, '../../app/api/billing/stripe/connect/route.ts'), 'utf8');
  const returned = readFileSync(join(here, '../../app/api/billing/stripe/connect/return/route.ts'), 'utf8');
  const refresh = readFileSync(join(here, '../../app/api/billing/stripe/connect/refresh/route.ts'), 'utf8');
  for (const src of [onboarding, returned, refresh]) {
    assert.match(src, /connectSiteOrigin\(req\)/);
    assert.doesNotMatch(src, /nextUrl\.origin/);
    assert.doesNotMatch(src, /x-forwarded-host/);
  }
});
