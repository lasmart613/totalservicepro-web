import assert from 'node:assert/strict';
import test from 'node:test';
import {
  orgCanUpgrade,
  orgIsPaid,
  orgIsTopPaid,
  orgMayStartPaidPlan,
  shouldPreserveSessionForExistingOrg,
  upgradeTargetForOrg,
} from './org-plan.ts';

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

test('existing org ids must keep the session', () => {
  assert.equal(shouldPreserveSessionForExistingOrg(12), true);
  assert.equal(shouldPreserveSessionForExistingOrg('12'), true);
  assert.equal(shouldPreserveSessionForExistingOrg(' 88 '), true);
});

test('missing org does not preserve a session (public signup may clear it)', () => {
  assert.equal(shouldPreserveSessionForExistingOrg(null), false);
  assert.equal(shouldPreserveSessionForExistingOrg(undefined), false);
  assert.equal(shouldPreserveSessionForExistingOrg(''), false);
  assert.equal(shouldPreserveSessionForExistingOrg('   '), false);
});

test('free and "pro" still see Upgrade to /plans', () => {
  assert.equal(upgradeTargetForOrg({}), 'plans');
  assert.equal(upgradeTargetForOrg({ is_premium: false, plan: 'pro' }), 'plans');
  assert.equal(orgCanUpgrade({ plan: 'free' }), true);
  assert.equal(orgMayStartPaidPlan({ plan: 'free' }, 'premium'), true);
  assert.equal(orgMayStartPaidPlan({ plan: 'free' }, 'team'), true);
});

test('Premium / is_premium mid-tier still sees Upgrade to Team', () => {
  assert.equal(upgradeTargetForOrg({ plan: 'premium' }), 'team');
  assert.equal(upgradeTargetForOrg({ subscription_tier: 'PREMIUM' }), 'team');
  assert.equal(upgradeTargetForOrg({ is_premium: true }), 'team');
  assert.equal(upgradeTargetForOrg({ is_premium: true, plan: 'pro' }), 'team');
  assert.equal(orgIsTopPaid({ plan: 'premium' }), false);
  assert.equal(orgCanUpgrade({ plan: 'premium' }), true);
  assert.equal(orgMayStartPaidPlan({ plan: 'premium' }, 'team'), true);
  assert.equal(orgMayStartPaidPlan({ plan: 'premium' }, 'premium'), false);
  assert.equal(orgMayStartPaidPlan({ is_premium: true }, 'team'), true);
});

test('Team and Enterprise hide Upgrade and cannot start checkout', () => {
  assert.equal(upgradeTargetForOrg({ plan: 'team' }), null);
  assert.equal(upgradeTargetForOrg({ subscription_tier: 'ENTERPRISE' }), null);
  assert.equal(orgIsTopPaid({ plan: 'team' }), true);
  assert.equal(orgCanUpgrade({ is_premium: true, plan: 'team' }), false);
  assert.equal(orgMayStartPaidPlan({ plan: 'team' }, 'team'), false);
  assert.equal(orgMayStartPaidPlan({ plan: 'enterprise' }, 'premium'), false);
});
