import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import {
  isCheckoutSessionCompleted,
  isSubscriptionLifecycle,
  parseStripeSignatureHeader,
  stripeWebhookObject,
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

test('only checkout.session.completed and subscription lifecycle apply upgrades', () => {
  assert.equal(isCheckoutSessionCompleted('checkout.session.completed'), true);
  assert.equal(isCheckoutSessionCompleted('invoice.paid'), false);
  assert.equal(isSubscriptionLifecycle('customer.subscription.updated'), true);
  assert.equal(isSubscriptionLifecycle('customer.subscription.deleted'), false);
  assert.deepEqual(stripeWebhookObject({ data: { object: { id: 'cs_1' } } })?.id, 'cs_1');
});
