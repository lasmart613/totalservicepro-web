import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CUSTOMER_ACTION_APPROVED,
  CUSTOMER_ACTION_CHANGES,
  CUSTOMER_ACTION_REJECTED,
  buildOrgNotifyEmail,
  generateEstimateActionToken,
  isValidEstimateActionToken,
  mergeCustomerActionIntoEstimateData,
} from './estimate-action-helpers.ts';

test('estimate action tokens are unguessable url-safe secrets', () => {
  const token = generateEstimateActionToken();
  assert.equal(isValidEstimateActionToken(token), true);
  assert.ok(token.length >= 32);
  assert.notEqual(generateEstimateActionToken(), token);
  assert.equal(isValidEstimateActionToken('short'), false);
  assert.equal(isValidEstimateActionToken('../etc/passwd'), false);
});

test('mergeCustomerActionIntoEstimateData writes rejected alongside the token', () => {
  const ed = mergeCustomerActionIntoEstimateData(
    { customer_action_token: 'keep' },
    { action: CUSTOMER_ACTION_REJECTED, at: '2026-09-14T00:00:00.000Z', note: null }
  );
  assert.equal(ed.customer_action, 'rejected');
  assert.equal(ed.customer_action_token, 'keep');
});

test('shop notify subjects cover approve, reject, and modify', () => {
  const approved = buildOrgNotifyEmail({
    action: CUSTOMER_ACTION_APPROVED,
    companyName: 'Acme Repair',
    customerName: 'Northshore Clinic',
    estimateNumber: 'RP-EST-1',
    total: 1200,
    note: null,
    estimateId: 9,
  });
  assert.match(approved.subject, /approved by Northshore Clinic/);

  const rejected = buildOrgNotifyEmail({
    action: CUSTOMER_ACTION_REJECTED,
    companyName: 'Acme Repair',
    customerName: 'Northshore Clinic',
    estimateNumber: 'RP-EST-1',
    total: 1200,
    note: null,
    estimateId: 9,
  });
  assert.match(rejected.subject, /rejected by Northshore Clinic/);

  const modify = buildOrgNotifyEmail({
    action: CUSTOMER_ACTION_CHANGES,
    companyName: 'Acme Repair',
    customerName: 'Northshore Clinic',
    estimateNumber: 'RP-EST-1',
    total: 1200,
    note: 'Please use OEM parts',
    estimateId: 9,
  });
  assert.match(modify.subject, /Modification requested/);
  assert.match(modify.html, /Please use OEM parts/);
});
