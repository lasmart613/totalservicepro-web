import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CUSTOMER_ACTION_APPROVED,
  CUSTOMER_ACTION_CHANGES,
  CUSTOMER_ACTION_REJECTED,
  buildOrgNotifyEmail,
  customerActionWrite,
  decideEstimateActionHttp,
  generateEstimateActionToken,
  isValidEstimateActionToken,
  mergeCustomerActionIntoEstimateData,
  signEstimateActionConfirm,
} from './estimate-action-helpers.ts';

const here = dirname(fileURLToPath(import.meta.url));

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

test('GET does not change estimate state, even with a valid confirm nonce', () => {
  const token = generateEstimateActionToken();
  const now = 1_700_000_000;
  const confirm = signEstimateActionConfirm(token, 'test-secret', now);
  const decision = decideEstimateActionHttp({
    method: 'GET',
    secret: 'test-secret',
    nowSec: now,
    body: { token, confirm, action: 'approve' },
  });
  assert.equal(decision.effect, 'none');
  if (decision.effect !== 'none') return;
  assert.equal(decision.status, 405);

  const route = readFileSync(join(here, '../../app/api/billing/estimate-action/route.ts'), 'utf8');
  const getFn = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'));
  assert.match(getFn, /method: 'GET'/);
  assert.match(getFn, /Allow: 'POST'/);
  assert.doesNotMatch(getFn, /applyEstimateCustomerAction|service_estimates/);

  const client = readFileSync(join(here, '../../app/e/[token]/EstimateActionClient.tsx'), 'utf8');
  assert.doesNotMatch(client, /useEffect|autoPosted/);
  assert.match(client, /Approve estimate/);
  assert.match(client, /Reject estimate/);
});

test('POST approve and reject require the confirm form and then record the action', () => {
  const token = generateEstimateActionToken();
  const now = 1_700_000_000;
  const secret = 'test-secret';
  const confirm = signEstimateActionConfirm(token, secret, now);
  const at = '2026-10-06T00:00:00.000Z';

  const missing = decideEstimateActionHttp({
    method: 'POST',
    secret,
    nowSec: now,
    body: { token, action: 'approve' },
  });
  assert.equal(missing.effect, 'none');

  const approved = decideEstimateActionHttp({
    method: 'POST',
    secret,
    nowSec: now,
    body: { token, action: 'approve', confirm },
  });
  assert.equal(approved.effect, 'mutate');
  if (approved.effect !== 'mutate') return;
  const approvedWrite = customerActionWrite({ estimate_data: { customer_action_token: token } }, approved.action, approved.note, at);
  assert.equal(approvedWrite.already, false);
  assert.equal(approvedWrite.patch?.customer_action, 'approved');

  const rejected = decideEstimateActionHttp({
    method: 'POST',
    secret,
    nowSec: now,
    body: { token, action: 'reject', confirm, note: 'Too high' },
  });
  assert.equal(rejected.effect, 'mutate');
  if (rejected.effect !== 'mutate') return;
  const rejectedWrite = customerActionWrite(
    { estimate_data: { customer_action_token: token } },
    rejected.action,
    rejected.note,
    at
  );
  assert.equal(rejectedWrite.patch?.customer_action, 'rejected');
  assert.equal(rejectedWrite.patch?.customer_action_note, 'Too high');

  const route = readFileSync(join(here, '../../app/api/billing/estimate-action/route.ts'), 'utf8');
  const postFn = route.slice(route.indexOf('export async function POST'));
  const gate = postFn.indexOf('decideEstimateActionHttp');
  const apply = postFn.indexOf('applyEstimateCustomerAction');
  assert.ok(gate >= 0 && apply > gate);
  assert.doesNotMatch(postFn, /searchParams\.get/);
});

test('approve and reject still work after a modification request; approved stays final', () => {
  const at = '2026-10-06T00:00:00.000Z';
  const modified = customerActionWrite(
    { estimate_data: { customer_action_token: 'abcdefghijklmnopqrstuvwxyz' } },
    CUSTOMER_ACTION_CHANGES,
    'Please revise labor',
    at
  );
  assert.equal(modified.action, 'changes_requested');
  assert.equal(modified.patch?.customer_action_note, 'Please revise labor');

  const approved = customerActionWrite(
    {
      customer_action: modified.action,
      customer_action_note: modified.patch?.customer_action_note,
      estimate_data: modified.patch?.estimate_data,
    },
    CUSTOMER_ACTION_APPROVED,
    null,
    '2026-10-06T01:00:00.000Z'
  );
  assert.equal(approved.already, false);
  assert.equal(approved.conflict, false);
  assert.equal(approved.action, 'approved');
  assert.equal(approved.patch?.customer_action, 'approved');
  assert.equal(approved.patch?.customer_action_note, 'Please revise labor');

  const rejectedAfterModify = customerActionWrite(
    {
      customer_action: 'changes_requested',
      estimate_data: modified.patch?.estimate_data,
    },
    CUSTOMER_ACTION_REJECTED,
    'No thanks',
    '2026-10-06T02:00:00.000Z'
  );
  assert.equal(rejectedAfterModify.already, false);
  assert.equal(rejectedAfterModify.patch?.customer_action, 'rejected');

  const terminal = customerActionWrite(
    { customer_action: 'approved', estimate_data: approved.patch?.estimate_data },
    CUSTOMER_ACTION_REJECTED,
    null,
    '2026-10-06T03:00:00.000Z'
  );
  assert.equal(terminal.already, true);
  assert.equal(terminal.conflict, true);
  assert.equal(terminal.patch, null);
  assert.equal(terminal.action, 'approved');
});
