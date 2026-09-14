import assert from 'node:assert/strict';
import test from 'node:test';
import {
  customerActionConfirmationTitle,
  customerActionFromEstimate,
  customerActionLabel,
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
});
