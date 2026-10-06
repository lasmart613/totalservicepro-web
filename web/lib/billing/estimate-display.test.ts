import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estimateCountsTowardSent,
  estimateListBadge,
  estimateStatusLabel,
  REJECTED_ESTIMATE_ERROR,
  rejectedEstimateChangeRefusal,
} from './estimate-display.ts';

const fresh = new Date().toISOString();

test('main badge is Approved or Rejected instead of Pending', () => {
  assert.equal(
    estimateListBadge({ status: 'pending', customer_action: 'approved', created_at: fresh }),
    'approved'
  );
  assert.equal(
    estimateListBadge({ status: 'sent', customer_action: 'rejected', created_at: fresh }),
    'rejected'
  );
  assert.equal(estimateStatusLabel('approved'), 'Approved');
  assert.equal(estimateStatusLabel('rejected'), 'Rejected');
  assert.equal(
    estimateListBadge({ status: 'pending', customer_action: null, created_at: fresh }),
    'pending'
  );
  assert.equal(
    estimateListBadge({
      status: 'pending',
      estimate_data: { customer_action: 'rejected' },
      created_at: fresh,
    }),
    'rejected'
  );
});

test('invoiced stays Invoiced after approval', () => {
  assert.equal(
    estimateListBadge({ status: 'invoiced', customer_action: 'approved', created_at: fresh }),
    'invoiced'
  );
});

test('SENT count skips rejected and keeps approved until invoiced', () => {
  const rejected = { status: 'pending', customer_action: 'rejected', created_at: fresh };
  const approved = { status: 'pending', customer_action: 'approved', created_at: fresh };
  const pending = { status: 'sent', customer_action: null, created_at: fresh };
  const invoiced = { status: 'invoiced', customer_action: 'approved', created_at: fresh };
  assert.equal(estimateCountsTowardSent(rejected), false);
  assert.equal(estimateCountsTowardSent(approved), true);
  assert.equal(estimateCountsTowardSent(pending), true);
  assert.equal(estimateCountsTowardSent(invoiced), false);
});

test('rejected estimate status changes are refused with 409', () => {
  const refusal = rejectedEstimateChangeRefusal({
    status: 'pending',
    customer_action: 'rejected',
  });
  assert.equal(refusal?.status, 409);
  assert.equal(refusal?.error, REJECTED_ESTIMATE_ERROR);
  assert.match(refusal?.error || '', /rejected/i);
  assert.equal(
    rejectedEstimateChangeRefusal({ status: 'pending', customer_action: 'approved' }),
    null
  );
});
