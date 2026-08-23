import assert from 'node:assert/strict';
import test from 'node:test';
import { getPlanOffer, PLAN_OFFERS, skuFor } from './plan-catalog.ts';

test('SKUs and display prices match the Android paywall', () => {
  assert.equal(PLAN_OFFERS.premium_monthly.displayAmount, '$9.99');
  assert.equal(PLAN_OFFERS.premium_monthly.unitAmountCents, 999);
  assert.equal(PLAN_OFFERS.premium_annual.displayAmount, '$6.66');
  assert.equal(PLAN_OFFERS.premium_annual.displayOrig, '$119.88');
  assert.equal(PLAN_OFFERS.premium_annual.unitAmountCents, 7992);
  assert.equal(PLAN_OFFERS.team_monthly.displayAmount, '$39.99');
  assert.equal(PLAN_OFFERS.team_monthly.unitAmountCents, 3999);
  assert.equal(PLAN_OFFERS.team_annual.displayAmount, '$24.99');
  assert.equal(PLAN_OFFERS.team_annual.displayOrig, '$479.88');
  assert.equal(PLAN_OFFERS.team_annual.unitAmountCents, 29988);
});

test('lookup keys stay the Android billing SKUs', () => {
  assert.equal(PLAN_OFFERS.premium_monthly.lookupKey, 'premium_monthly');
  assert.equal(PLAN_OFFERS.premium_annual.lookupKey, 'premium_annual');
  assert.equal(PLAN_OFFERS.team_monthly.lookupKey, 'team_monthly');
  assert.equal(PLAN_OFFERS.team_annual.lookupKey, 'team_annual');
});

test('skuFor and getPlanOffer round-trip', () => {
  assert.equal(skuFor('premium', 'monthly'), 'premium_monthly');
  assert.equal(getPlanOffer('team_annual')?.plan, 'team');
  assert.equal(getPlanOffer('not-a-plan'), null);
});
