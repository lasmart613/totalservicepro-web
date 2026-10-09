import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { POST, runEstimateActionPost } from '../../app/api/billing/estimate-action/route.ts';
import {
  CUSTOMER_ACTION_APPROVED,
  CUSTOMER_ACTION_CHANGES,
  CUSTOMER_ACTION_REJECTED,
  buildOrgNotifyEmail,
  customerActionWrite,
  decideEstimateActionHttp,
  estimateActionRedirectLocation,
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
  const confirm = signEstimateActionConfirm(token, 'approve', 'test-secret', now);
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
  assert.match(client, /confirms\.approve/);
  assert.match(client, /confirms\.reject/);
  assert.match(client, /confirms\.modify/);
  assert.match(client, /status === 409/);
  assert.doesNotMatch(client, /toLocaleDateString/);
});

test('POST approve and reject require the confirm form and then record the action', () => {
  const token = generateEstimateActionToken();
  const now = 1_700_000_000;
  const secret = 'test-secret';
  const confirm = signEstimateActionConfirm(token, 'approve', secret, now);
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

  const rejectConfirm = signEstimateActionConfirm(token, 'reject', secret, now);
  const rejected = decideEstimateActionHttp({
    method: 'POST',
    secret,
    nowSec: now,
    body: { token, action: 'reject', confirm: rejectConfirm, note: 'Too high' },
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
  assert.match(postFn, /result\.already && result\.conflict/);
  assert.match(postFn, /terminalConflict \? 409 : 200/);
});

test('a confirm nonce cannot be reused for a different action and does not write', () => {
  const token = generateEstimateActionToken();
  const now = 1_700_000_000;
  const secret = 'test-secret';
  const pairs = [
    ['approve', 'reject'],
    ['reject', 'approve'],
    ['modify', 'approve'],
  ] as const;

  for (const [signed, posted] of pairs) {
    const confirm = signEstimateActionConfirm(token, signed, secret, now);
    const decision = decideEstimateActionHttp({
      method: 'POST',
      secret,
      nowSec: now,
      body: { token, action: posted, confirm },
    });
    assert.equal(decision.effect, 'none', `${signed} confirm posted as ${posted}`);
    if (decision.effect !== 'none') continue;
    assert.equal(decision.status, 400);
  }

  const legacyExp = now + 60;
  const legacySig = createHmac('sha256', secret)
    .update(`estimate-confirm.${token}.${legacyExp}`)
    .digest('base64url');
  const legacy = decideEstimateActionHttp({
    method: 'POST',
    secret,
    nowSec: now,
    body: { token, action: 'approve', confirm: `${legacyExp}.${legacySig}` },
  });
  assert.equal(legacy.effect, 'none');
  if (legacy.effect === 'none') assert.equal(legacy.status, 400);
});

test('each action nonce succeeds, and approve after modify uses the approve nonce', () => {
  const token = generateEstimateActionToken();
  const now = 1_700_000_000;
  const secret = 'test-secret';
  const at = '2026-10-06T00:00:00.000Z';

  for (const action of ['approve', 'reject', 'modify'] as const) {
    const confirm = signEstimateActionConfirm(token, action, secret, now);
    const decision = decideEstimateActionHttp({
      method: 'POST',
      secret,
      nowSec: now,
      body: { token, action, confirm },
    });
    assert.equal(decision.effect, 'mutate', action);
  }

  const modifyConfirm = signEstimateActionConfirm(token, 'modify', secret, now);
  const modifyDecision = decideEstimateActionHttp({
    method: 'POST',
    secret,
    nowSec: now,
    body: { token, action: 'modify', confirm: modifyConfirm, note: 'Please revise labor' },
  });
  assert.equal(modifyDecision.effect, 'mutate');
  if (modifyDecision.effect !== 'mutate') return;
  const modified = customerActionWrite(
    { estimate_data: { customer_action_token: token } },
    modifyDecision.action,
    modifyDecision.note,
    at
  );
  assert.equal(modified.action, 'changes_requested');

  const approveConfirm = signEstimateActionConfirm(token, 'approve', secret, now);
  const approveDecision = decideEstimateActionHttp({
    method: 'POST',
    secret,
    nowSec: now,
    body: { token, action: 'approve', confirm: approveConfirm },
  });
  assert.equal(approveDecision.effect, 'mutate');
  if (approveDecision.effect !== 'mutate') return;
  const approved = customerActionWrite(
    {
      customer_action: modified.action,
      customer_action_note: modified.patch?.customer_action_note,
      estimate_data: modified.patch?.estimate_data,
    },
    approveDecision.action,
    approveDecision.note,
    '2026-10-06T01:00:00.000Z'
  );
  assert.equal(approved.already, false);
  assert.equal(approved.action, 'approved');
  assert.equal(approved.patch?.customer_action, 'approved');
});

test('form POST redirect stays on an allowlisted host and never a deploy permalink', () => {
  const token = generateEstimateActionToken();
  const encoded = encodeURIComponent(token);
  const prod = estimateActionRedirectLocation({
    token,
    status: 200,
    action: 'approved',
    already: false,
    forwardedHost: 'repairplanet.net',
    host: '6ac445998ecfb20008b96b11--totalservicepro.netlify.app',
  });
  assert.equal(prod, `https://repairplanet.net/e/${encoded}?done=approved`);

  const preview = estimateActionRedirectLocation({
    token,
    status: 200,
    action: 'approved',
    forwardedHost: 'deploy-preview-207--totalservicepro.netlify.app',
  });
  assert.equal(
    preview,
    `https://deploy-preview-207--totalservicepro.netlify.app/e/${encoded}?done=approved`
  );

  const permalink = estimateActionRedirectLocation({
    token,
    status: 200,
    action: 'approved',
    forwardedHost: '6ac445998ecfb20008b96b11--totalservicepro.netlify.app',
    host: '6ac445998ecfb20008b96b11--totalservicepro.netlify.app',
  });
  assert.equal(permalink, `/e/${encoded}?done=approved`);
  assert.doesNotMatch(String(permalink), /netlify|https?:/);

  const local = estimateActionRedirectLocation({
    token,
    status: 200,
    action: 'rejected',
    host: 'localhost:3456',
  });
  assert.equal(local, `http://localhost:3456/e/${encoded}?done=rejected`);

  const replay = estimateActionRedirectLocation({
    token,
    status: 200,
    action: 'approved',
    already: true,
    forwardedHost: 'www.repairplanet.net',
  });
  assert.equal(replay, `https://www.repairplanet.net/e/${encoded}`);

  const route = readFileSync(join(here, '../../app/api/billing/estimate-action/route.ts'), 'utf8');
  const finish = route.slice(route.indexOf('function finish'));
  assert.match(finish, /estimateActionRedirectLocation/);
  assert.match(finish, /lang: body\.lang/);
  assert.doesNotMatch(finish, /req\.url|DEPLOY_URL|DEPLOY_PRIME_URL|process\.env\.URL|new URL\(/);
});

test('no-JS approve, reject, and modify redirects keep the estimate language', () => {
  const token = generateEstimateActionToken();
  const encoded = encodeURIComponent(token);
  const approve = estimateActionRedirectLocation({
    token,
    status: 200,
    action: 'approve',
    lang: 'ar',
    forwardedHost: 'repairplanet.net',
  });
  assert.equal(approve, `https://repairplanet.net/e/${encoded}?done=approved&lang=ar`);

  const reject = estimateActionRedirectLocation({
    token,
    status: 200,
    action: 'reject',
    lang: 'de',
    host: 'localhost:3456',
  });
  assert.equal(reject, `http://localhost:3456/e/${encoded}?done=rejected&lang=de`);

  const modify = estimateActionRedirectLocation({
    token,
    status: 200,
    action: 'modify',
    lang: 'fr',
    forwardedHost: 'repairplanet.net',
  });
  assert.equal(modify, `https://repairplanet.net/e/${encoded}?done=changes_requested&lang=fr`);

  const notice = estimateActionRedirectLocation({
    token,
    status: 400,
    action: 'approve',
    notice: 'confirm',
    lang: 'he',
    forwardedHost: 'repairplanet.net',
  });
  assert.equal(
    notice,
    `https://repairplanet.net/e/${encoded}?action=approve&notice=confirm&lang=he`,
  );

  const dropped = estimateActionRedirectLocation({
    token,
    status: 200,
    action: 'approved',
    lang: 'nope',
    forwardedHost: 'repairplanet.net',
  });
  assert.equal(dropped, `https://repairplanet.net/e/${encoded}?done=approved`);

  const client = readFileSync(join(here, '../../app/e/[token]/EstimateActionClient.tsx'), 'utf8');
  assert.equal((client.match(/name="lang"/g) || []).length, 3);
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

const CONFIRM_SECRET = 'estimate-confirm-test';

function confirmForm(fields: Record<string, string>): NextRequest {
  return new NextRequest('https://repairplanet.net/api/billing/estimate-action', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      host: 'repairplanet.net',
      'x-forwarded-proto': 'https',
    },
    body: new URLSearchParams(fields),
  });
}

function estimateAdmin(estimate: Record<string, unknown>) {
  const query = (table: string) => {
    const api: Record<string, unknown> = {
      select() {
        return api;
      },
      insert() {
        return api;
      },
      update() {
        return api;
      },
      eq() {
        return api;
      },
      filter() {
        return api;
      },
      ilike() {
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return api;
      },
      maybeSingle: async () => {
        if (table === 'service_estimates') return { data: estimate, error: null };
        if (table === 'organizations') {
          return {
            data: { name: 'Shop', currency_code: 'USD', number_format: 'auto' },
            error: null,
          };
        }
        return { data: null, error: null };
      },
      single: async () => {
        if (table === 'service_tickets') return { data: { id: 5, ticket_number: 'TKT-1' }, error: null };
        return { data: null, error: { message: 'no row' } };
      },
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
      },
    };
    return api;
  };
  return {
    from: query,
    auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } },
  };
}

test('no-JS form post keeps a validated lang on the confirm and success redirects', async () => {
  const previous = process.env.ESTIMATE_ACTION_CONFIRM_SECRET;
  process.env.ESTIMATE_ACTION_CONFIRM_SECRET = CONFIRM_SECRET;
  try {
    const token = generateEstimateActionToken();
    const encoded = encodeURIComponent(token);
    const confirm = await POST(
      confirmForm({
        token,
        action: 'approve',
        confirm: 'bad',
        lang: 'ar',
      })
    );
    assert.equal(confirm.status, 303);
    assert.equal(
      confirm.headers.get('location'),
      `https://repairplanet.net/e/${encoded}?action=approve&notice=confirm&lang=ar`
    );

    const injected = await POST(
      confirmForm({
        token,
        action: 'approve',
        confirm: 'bad',
        lang: 'ar"\r\nhttps://evil.example',
      })
    );
    assert.equal(injected.status, 303);
    const injectedLocation = injected.headers.get('location') || '';
    assert.equal(injectedLocation.includes('lang='), false);
    assert.equal(injectedLocation.includes('evil'), false);

    const approved = await runEstimateActionPost(
      confirmForm({
        token,
        action: 'approve',
        confirm: signEstimateActionConfirm(token, 'approve', CONFIRM_SECRET),
        lang: 'ar',
      }),
      {
        hasServiceRole: () => true,
        getAdmin: () =>
          estimateAdmin({
            id: 9,
            organization_id: 1,
            customer_name: 'Clinic',
            estimate_number: 'EST-1',
            total: 10,
            status: 'sent',
            created_at: new Date().toISOString(),
            estimate_data: {},
          }) as never,
      }
    );
    assert.equal(approved.status, 303);
    assert.equal(
      approved.headers.get('location'),
      `https://repairplanet.net/e/${encoded}?done=approved&lang=ar`
    );

    const crashed = await runEstimateActionPost(
      confirmForm({
        token,
        action: 'approve',
        confirm: signEstimateActionConfirm(token, 'approve', CONFIRM_SECRET),
        lang: 'ar',
      }),
      {
        hasServiceRole: () => true,
        getAdmin: () => {
          throw new Error('db down');
        },
      }
    );
    assert.equal(crashed.status, 303);
    assert.equal(
      crashed.headers.get('location'),
      `https://repairplanet.net/e/${encoded}?action=approve&notice=failed&lang=ar`
    );

    const unavailable = await runEstimateActionPost(
      confirmForm({
        token,
        action: 'reject',
        confirm: signEstimateActionConfirm(token, 'reject', CONFIRM_SECRET),
        lang: 'de',
      }),
      { hasServiceRole: () => false }
    );
    assert.equal(unavailable.status, 303);
    assert.equal(
      unavailable.headers.get('location'),
      `https://repairplanet.net/e/${encoded}?action=reject&notice=failed&lang=de`
    );

    const route = readFileSync(join(here, '../../app/api/billing/estimate-action/route.ts'), 'utf8');
    assert.match(route, /export async function POST\(req: NextRequest\) \{\s*return runEstimateActionPost\(req\);\s*\}/);
    assert.equal((route.match(/\bfinish\(/g) || []).length, 2);
  } finally {
    if (previous == null) delete process.env.ESTIMATE_ACTION_CONFIRM_SECRET;
    else process.env.ESTIMATE_ACTION_CONFIRM_SECRET = previous;
  }
});
