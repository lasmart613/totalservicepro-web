import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clinicClaimSignInRoute,
  refusedClaimLoginHref,
  showCompanyJustSetupBanner,
} from './customer-invite-client.ts';
import { shouldPostFounderOrganization } from './org-founder-client.ts';

const here = dirname(fileURLToPath(import.meta.url));
const REFUSAL = 'This invite was issued for an email that is no longer on this clinic.';

test('a refused clinic claim stays off the company just-setup page', () => {
  const refused = clinicClaimSignInRoute({ claimed: false, error: REFUSAL });
  assert.equal(refused.kind, 'stay');
  if (refused.kind === 'stay') {
    assert.equal(refused.message, REFUSAL);
    assert.equal('dest' in refused, false);
  }
  const href = refusedClaimLoginHref(REFUSAL);
  assert.match(href, /^\/login\?claimError=/);
  assert.match(decodeURIComponent(href), new RegExp(REFUSAL));
  assert.doesNotMatch(href, /justSetup|\/company|claim=/);

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
  assert.match(claimBranch, /setMsg\(route\.message, false\)/);
  assert.match(claimBranch, /return;/);
  assert.doesNotMatch(claimBranch, /loginDest/);
  assert.doesNotMatch(claimBranch, /\/company\?justSetup=1/);
  assert.match(login, /searchParams\.get\('claimError'\)/);
  assert.match(login, /claimSignupMetadataClearPatch|clearStaleClaimToken/);

  const claimRoute = readFileSync(join(here, '../app/api/customers/claim/route.ts'), 'utf8');
  assert.match(claimRoute, /claimSignupMetadataClearPatch/);
  assert.match(claimRoute, /emailsMatch/);

  const callback = readFileSync(join(here, '../app/auth/callback/page.tsx'), 'utf8');
  const callbackClaim = callback.slice(callback.indexOf('if (claimToken)'), callback.indexOf('const pending = inviteInPlay'));
  assert.match(callbackClaim, /clinicClaimSignInRoute/);
  assert.match(callbackClaim, /refusedClaimLoginHref\(route\.message\)/);
  assert.match(callbackClaim, /clearStaleClaimToken/);
  assert.doesNotMatch(callbackClaim, /router\.replace\('\/company\?justSetup=1'\)/);

  const company = readFileSync(join(here, '../app/company/page.tsx'), 'utf8');
  assert.match(company, /showCompanyJustSetupBanner\(justSetup, linkedOrgId\)/);
  assert.match(company, /router\.replace\('\/onboarding'\)/);
  assert.doesNotMatch(company, /\{justSetup && \(/);
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
