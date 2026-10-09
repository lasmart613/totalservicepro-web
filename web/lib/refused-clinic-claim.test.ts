import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAIM_ERROR_CODES, claimErrorMessage, refusedClaimLoginHref } from './claim-error.ts';
import {
  clinicClaimSignInRoute,
  showCompanyJustSetupBanner,
} from './customer-invite-client.ts';
import { shouldPostFounderOrganization } from './org-founder-client.ts';

const here = dirname(fileURLToPath(import.meta.url));
const REFUSAL = 'This invite was issued for an email that is no longer on this clinic.';

test('a refused clinic claim stays off the company just-setup page', () => {
  const refused = clinicClaimSignInRoute({ claimed: false, error: REFUSAL });
  assert.equal(refused.kind, 'stay');
  if (refused.kind === 'stay') {
    assert.equal(refused.code, 'email_mismatch');
    assert.equal('dest' in refused, false);
    assert.equal('message' in refused, false);
  }
  const href = refusedClaimLoginHref(refused.kind === 'stay' ? refused.code : '');
  assert.equal(href, '/login?claimError=email_mismatch');
  assert.doesNotMatch(href, /justSetup|\/company|claim=/);
  assert.doesNotMatch(decodeURIComponent(href), /no longer on this clinic/);

  const claimed = clinicClaimSignInRoute({ claimed: true, error: 'ignored' });
  assert.deepEqual(claimed, { kind: 'company', dest: '/company?justSetup=1' });

  assert.equal(showCompanyJustSetupBanner('1', null), false);
  assert.equal(showCompanyJustSetupBanner('1', ''), false);
  assert.equal(showCompanyJustSetupBanner(null, 2669), false);
  assert.equal(showCompanyJustSetupBanner('1', 2669), true);
  assert.equal(showCompanyJustSetupBanner('true', 12), true);
});

test('login and callback show a refused claim on /login and still clear claim metadata', () => {
  const login = readFileSync(join(here, '../app/login/page.tsx'), 'utf8');
  const finish = login.slice(login.indexOf('async function finishLogin'), login.indexOf('function isValidEmail'));
  const claimBranch = finish.slice(0, finish.indexOf('resetTeamClaimDedupeForSignIn'));
  assert.match(claimBranch, /clinicClaimSignInRoute/);
  assert.match(claimBranch, /clearStaleClaimToken/);
  assert.match(claimBranch, /router\.replace\(refusedClaimLoginHref\(route\.code\)\)/);
  assert.match(claimBranch, /return;/);
  assert.doesNotMatch(claimBranch, /setMsg\(route\.message/);
  assert.doesNotMatch(claimBranch, /loginDest/);
  assert.doesNotMatch(claimBranch, /\/company\?justSetup=1/);
  assert.match(login, /claimErrorMessage\(searchParams\.get\('claimError'\)\)/);
  assert.doesNotMatch(login, /setMessage\(searchParams\.get\('claimError'\)/);
  assert.doesNotMatch(login, /setMessage\(refused\)/);
  assert.match(login, /claimSignupMetadataClearPatch|clearStaleClaimToken/);

  const claimRoute = readFileSync(join(here, '../app/api/customers/claim/route.ts'), 'utf8');
  assert.match(claimRoute, /claimSignupMetadataClearPatch/);
  assert.match(claimRoute, /emailsMatch/);

  const callback = readFileSync(join(here, '../app/auth/callback/page.tsx'), 'utf8');
  const callbackClaim = callback.slice(callback.indexOf('if (claimToken)'), callback.indexOf('const pending = inviteInPlay'));
  assert.match(callbackClaim, /clinicClaimSignInRoute/);
  assert.match(callbackClaim, /router\.replace\(refusedClaimLoginHref\(route\.code\)\)/);
  assert.match(callbackClaim, /clearStaleClaimToken/);
  assert.doesNotMatch(callbackClaim, /setMessage\(route\.message\)/);
  assert.doesNotMatch(callbackClaim, /router\.replace\('\/company\?justSetup=1'\)/);

  const company = readFileSync(join(here, '../app/company/page.tsx'), 'utf8');
  assert.match(company, /showCompanyJustSetupBanner\(justSetup, linkedOrgId\)/);
  assert.match(company, /router\.replace\('\/onboarding'\)/);
  assert.doesNotMatch(company, /\{justSetup && \(/);
});

test('claim error codes render a known message and never echo the query', () => {
  for (const code of CLAIM_ERROR_CODES) {
    const message = claimErrorMessage(code);
    assert.equal(typeof message, 'string', code);
    assert.ok(message && message.length > 0, code);
    assert.notEqual(message, code);
    assert.equal(refusedClaimLoginHref(code), `/login?claimError=${code}`);
    assert.doesNotMatch(refusedClaimLoginHref(code), /claim=/);
  }
  for (const raw of ['', '   ', 'nope', '<b>Click here</b>', '<script>alert(1)</script>', 'Please wire funds to evil.example']) {
    assert.equal(claimErrorMessage(raw), null, raw);
    assert.equal(refusedClaimLoginHref(raw), '/login', raw);
    assert.doesNotMatch(refusedClaimLoginHref(raw), /claimError|script|wire|b>/i);
  }
  const html = clinicClaimSignInRoute({ claimed: false, error: '<script>alert(1)</script> Pay this invoice' });
  assert.equal(html.kind, 'stay');
  if (html.kind === 'stay') {
    assert.equal(html.code, 'server_error');
    assert.equal(refusedClaimLoginHref(html.code), '/login?claimError=server_error');
    assert.doesNotMatch(refusedClaimLoginHref(html.code), /script|invoice/);
  }
});

test('company profile skips the founder link when the user did not create the org', () => {
  assert.equal(
    shouldPostFounderOrganization({ callerId: 'claimer', createdBy: 'shop-staff' }),
    false
  );
  assert.equal(shouldPostFounderOrganization({ callerId: 'founder', createdBy: null }), false);
  assert.equal(shouldPostFounderOrganization({ callerId: '', createdBy: 'founder' }), false);
  assert.equal(
    shouldPostFounderOrganization({ callerId: 'founder', createdBy: 'founder' }),
    true
  );
  assert.equal(
    shouldPostFounderOrganization({ founderFlow: true, callerId: 'founder', createdBy: 'shop-staff' }),
    true
  );

  const company = readFileSync(join(here, '../app/company/page.tsx'), 'utf8');
  const load = company.slice(company.indexOf('if (prof?.organization_id)'), company.indexOf('async function loadTeamMembers'));
  assert.match(load, /shouldPostFounderOrganization/);
  assert.match(load, /createdBy:\s*orgData\.created_by/);
  const created = company.slice(company.indexOf('if (newOrgData?.id)'), company.indexOf('const saveId'));
  assert.match(created, /ensureServiceCreatorLinked/);
});
