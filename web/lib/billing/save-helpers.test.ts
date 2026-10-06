import assert from 'node:assert/strict';
import test from 'node:test';
import {
  customerActionConfirmationTitle,
  customerActionFromEstimate,
  customerActionLabel,
  estimateConfirmMode,
  estimateValidityText,
  isEstimateAwaitingCustomerAction,
  parseCustomerActionKind,
  parseEstimateEmailAction,
  resolveCustomerActionApply,
} from './save-helpers.ts';

test('parseCustomerActionKind accepts email aliases', () => {
  assert.equal(parseCustomerActionKind('approve'), 'approved');
  assert.equal(parseCustomerActionKind('Approved'), 'approved');
  assert.equal(parseCustomerActionKind('reject'), 'rejected');
  assert.equal(parseCustomerActionKind('modify'), 'changes_requested');
  assert.equal(parseCustomerActionKind('request_changes'), 'changes_requested');
  assert.equal(parseCustomerActionKind('modification requested'), 'changes_requested');
  assert.equal(parseCustomerActionKind('nope'), null);
});

test('parseEstimateEmailAction maps stored kinds back to CTA query values', () => {
  assert.equal(parseEstimateEmailAction('approved'), 'approve');
  assert.equal(parseEstimateEmailAction('rejected'), 'reject');
  assert.equal(parseEstimateEmailAction('changes_requested'), 'modify');
});

test('customerActionFromEstimate reads rejected from column or JSON', () => {
  assert.equal(customerActionFromEstimate({ customer_action: 'rejected' }).action, 'rejected');
  assert.equal(
    customerActionFromEstimate({ estimate_data: { customer_action: 'modify' } }).action,
    'changes_requested'
  );
});

test('labels match the customer confirmation copy', () => {
  assert.equal(customerActionLabel('approved'), 'Approved');
  assert.equal(customerActionLabel('rejected'), 'Rejected');
  assert.equal(customerActionLabel('changes_requested'), 'Modification requested');
  assert.equal(customerActionConfirmationTitle('approved'), 'Estimate approved');
  assert.equal(customerActionConfirmationTitle('rejected'), 'Estimate rejected');
  assert.equal(customerActionConfirmationTitle('changes_requested'), 'Modification requested');
});

test('resolveCustomerActionApply is idempotent and treats approve/reject as terminal', () => {
  assert.deepEqual(resolveCustomerActionApply(null, 'approved'), {
    already: false,
    apply: true,
    conflict: false,
  });
  assert.deepEqual(resolveCustomerActionApply('approved', 'approved'), {
    already: true,
    apply: false,
    conflict: false,
  });
  assert.deepEqual(resolveCustomerActionApply('approved', 'rejected'), {
    already: true,
    apply: false,
    conflict: true,
  });
  assert.deepEqual(resolveCustomerActionApply('changes_requested', 'approved'), {
    already: false,
    apply: true,
    conflict: false,
  });
  assert.deepEqual(resolveCustomerActionApply('changes_requested', 'rejected'), {
    already: false,
    apply: true,
    conflict: false,
  });
});

test('confirm page offers approve after a modification and keeps approve or reject final', () => {
  assert.deepEqual(estimateConfirmMode({ customerAction: null, requested: 'approve' }), {
    kind: 'confirm',
    action: 'approve',
    priorModification: false,
  });
  assert.deepEqual(estimateConfirmMode({ customerAction: null, requested: 'reject' }), {
    kind: 'confirm',
    action: 'reject',
    priorModification: false,
  });
  assert.deepEqual(
    estimateConfirmMode({ customerAction: 'changes_requested', requested: 'approve' }),
    { kind: 'confirm', action: 'approve', priorModification: true }
  );
  assert.deepEqual(
    estimateConfirmMode({ customerAction: 'changes_requested', requested: 'reject' }),
    { kind: 'confirm', action: 'reject', priorModification: true }
  );
  assert.deepEqual(estimateConfirmMode({ customerAction: 'approved', requested: 'approve' }), {
    kind: 'final',
    action: 'approved',
  });
  assert.deepEqual(estimateConfirmMode({ customerAction: 'rejected', requested: 'reject' }), {
    kind: 'final',
    action: 'rejected',
  });
  assert.equal(estimateConfirmMode({ customerAction: null, requested: null, expired: true }).kind, 'expired');
});

test('isEstimateAwaitingCustomerAction is sent + not terminal + not expired', () => {
  const fresh = new Date().toISOString();
  assert.equal(
    isEstimateAwaitingCustomerAction({ status: 'sent', created_at: fresh }),
    true
  );
  assert.equal(
    isEstimateAwaitingCustomerAction({ status: 'pending', created_at: fresh, customer_action: 'changes_requested' }),
    true
  );
  assert.equal(
    isEstimateAwaitingCustomerAction({ status: 'sent', created_at: fresh, customer_action: 'approved' }),
    false
  );
  assert.equal(isEstimateAwaitingCustomerAction({ status: 'draft', created_at: fresh }), false);
  assert.equal(isEstimateAwaitingCustomerAction({ status: 'invoiced', created_at: fresh }), false);
});

test('estimate validity text is a stable UTC string', () => {
  const text = estimateValidityText({
    expired: false,
    validDays: 30,
    validUntil: '2026-11-04T00:00:00.000Z',
  });
  assert.equal(text, 'Good for 30 days (through Nov 4, 2026)');
  assert.equal(
    estimateValidityText({ expired: true, validDays: 30, validUntil: '2026-11-04T00:00:00.000Z' }),
    'Expired on Nov 4, 2026'
  );
});
