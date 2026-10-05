import assert from 'node:assert/strict';
import test from 'node:test';
import { DETAILED_REPORT_UPGRADE, gateFinancialDetail, gateJobCostingPlan } from './report-tier.ts';

test('free orgs get the summary, and an explicit detail request is 402', () => {
  const free = gateFinancialDetail({ plan: { is_premium: false }, planKnown: true });
  assert.deepEqual(free, { ok: true, detail: false });
  const asked = gateFinancialDetail({
    plan: { is_premium: false, plan: 'free' },
    planKnown: true,
    detailRequested: true,
  });
  assert.equal(asked.ok, false);
  if (!asked.ok) {
    assert.equal(asked.status, 402);
    assert.equal(asked.error, DETAILED_REPORT_UPGRADE);
  }
  const job = gateJobCostingPlan({ plan: { is_premium: false }, planKnown: true });
  assert.equal(job.ok, false);
  if (!job.ok) assert.equal(job.status, 402);
});

test('Premium, Team, Enterprise, and God keep detailed reports', () => {
  for (const plan of [{ is_premium: true }, { plan: 'premium' }, { subscription_tier: 'team' }, { plan: 'enterprise' }]) {
    const gate = gateFinancialDetail({ plan, planKnown: true, detailRequested: true });
    assert.deepEqual(gate, { ok: true, detail: true });
    assert.deepEqual(gateJobCostingPlan({ plan, planKnown: true }), { ok: true });
  }
  assert.deepEqual(
    gateFinancialDetail({ plan: null, planKnown: false, god: true, detailRequested: true }),
    { ok: true, detail: true }
  );
  assert.deepEqual(gateJobCostingPlan({ plan: { is_premium: false }, planKnown: true, god: true }), { ok: true });
});

test('an unreadable plan does not pretend the org is Premium', () => {
  const summary = gateFinancialDetail({ plan: null, planKnown: false });
  assert.deepEqual(summary, { ok: true, detail: false });
  const detail = gateFinancialDetail({ plan: null, planKnown: false, detailRequested: true });
  assert.equal(detail.ok, false);
  if (!detail.ok) assert.equal(detail.status, 503);
  const job = gateJobCostingPlan({ plan: null, planKnown: false });
  assert.equal(job.ok, false);
  if (!job.ok) assert.equal(job.status, 503);
});
