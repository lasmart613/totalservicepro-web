import assert from 'node:assert/strict';
import test from 'node:test';
import { orgIsPaid } from './org-plan.ts';

test('null or missing org is not paid', () => {
  assert.equal(orgIsPaid(null), false);
  assert.equal(orgIsPaid(undefined), false);
  assert.equal(orgIsPaid({}), false);
});

test('is_premium true is paid', () => {
  assert.equal(orgIsPaid({ is_premium: true }), true);
  assert.equal(orgIsPaid({ is_premium: true, subscription_tier: 'pro' }), true);
  assert.equal(orgIsPaid({ is_premium: true, plan: 'free' }), true);
});

test('is_premium false or null is not paid by itself', () => {
  assert.equal(orgIsPaid({ is_premium: false }), false);
  assert.equal(orgIsPaid({ is_premium: null }), false);
});

test('exact tier premium|team|enterprise is paid (any case)', () => {
  assert.equal(orgIsPaid({ subscription_tier: 'premium' }), true);
  assert.equal(orgIsPaid({ subscription_tier: 'TEAM' }), true);
  assert.equal(orgIsPaid({ subscription_tier: ' Enterprise ' }), true);
});

test('exact plan premium|team|enterprise is paid (any case)', () => {
  assert.equal(orgIsPaid({ plan: 'premium' }), true);
  assert.equal(orgIsPaid({ plan: 'team' }), true);
  assert.equal(orgIsPaid({ plan: 'ENTERPRISE' }), true);
});

test('pro and product-like names are not paid', () => {
  assert.equal(orgIsPaid({ subscription_tier: 'pro' }), false);
  assert.equal(orgIsPaid({ subscription_tier: 'professional' }), false);
  assert.equal(orgIsPaid({ subscription_tier: 'service_pro' }), false);
  assert.equal(orgIsPaid({ subscription_tier: 'total service pro' }), false);
  assert.equal(orgIsPaid({ plan: 'pro' }), false);
  assert.equal(orgIsPaid({ plan: 'free' }), false);
  assert.equal(orgIsPaid({ is_premium: false, subscription_tier: 'pro', plan: 'pro' }), false);
});
