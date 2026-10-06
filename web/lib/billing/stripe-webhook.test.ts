import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import {
  isCheckoutSessionCompleted,
  isSubscriptionLifecycle,
  parseStripeSignatureHeader,
  stripeWebhookObject,
  stripeWebhookSecrets,
  verifyStripeWebhookAgainstSecrets,
  verifyStripeWebhookSignature,
} from './stripe-webhook.ts';

function sign(secret: string, timestamp: string, body: string): string {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

test('valid Stripe signature within tolerance is accepted', () => {
  const body = '{"id":"evt_1","type":"checkout.session.completed"}';
  const now = 1_700_000_000;
  const header = sign('whsec_test', String(now), body);
  assert.equal(verifyStripeWebhookSignature(body, header, 'whsec_test', 300, now), true);
});

test('wrong secret or stale timestamp is rejected', () => {
  const body = '{"id":"evt_1"}';
  const now = 1_700_000_000;
  const header = sign('whsec_test', String(now - 301), body);
  assert.equal(verifyStripeWebhookSignature(body, header, 'whsec_test', 300, now), false);
  assert.equal(verifyStripeWebhookSignature(body, sign('other', String(now), body), 'whsec_test', 300, now), false);
  assert.equal(parseStripeSignatureHeader('nope'), null);
});

test('Connect account.updated verifies with STRIPE_CONNECT_WEBHOOK_SECRET', () => {
  const body = '{"id":"evt_connect","type":"account.updated"}';
  const now = 1_700_000_000;
  const header = sign('whsec_connect', String(now), body);
  assert.equal(verifyStripeWebhookSignature(body, header, 'whsec_test', 300, now), false);
  assert.equal(
    verifyStripeWebhookAgainstSecrets(body, header, ['whsec_test', 'whsec_connect'], 300, now),
    true
  );
  assert.equal(verifyStripeWebhookAgainstSecrets(body, header, ['whsec_test'], 300, now), false);
  assert.equal(verifyStripeWebhookAgainstSecrets(body, sign('other', String(now), body), ['whsec_test', 'whsec_connect'], 300, now), false);

  const previousPlatform = process.env.STRIPE_WEBHOOK_SECRET;
  const previousConnect = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect';
  try {
    assert.deepEqual(stripeWebhookSecrets(), ['whsec_test', 'whsec_connect']);
  } finally {
    if (previousPlatform == null) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previousPlatform;
    if (previousConnect == null) delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    else process.env.STRIPE_CONNECT_WEBHOOK_SECRET = previousConnect;
  }
});

test('only checkout.session.completed and subscription lifecycle apply upgrades', () => {
  assert.equal(isCheckoutSessionCompleted('checkout.session.completed'), true);
  assert.equal(isCheckoutSessionCompleted('invoice.paid'), false);
  assert.equal(isSubscriptionLifecycle('customer.subscription.updated'), true);
  assert.equal(isSubscriptionLifecycle('customer.subscription.deleted'), false);
  assert.deepEqual(stripeWebhookObject({ data: { object: { id: 'cs_1' } } })?.id, 'cs_1');
});
