import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  destAfterInviteClaim,
  inviteInPlay,
  routeAfterTeamClaim,
  shouldSendToMemberOnboarding,
} from './invite-claim.ts';
import {
  CLAIM_INVITE_UNUSED,
  claimTokenSeenOnSignIn,
  clearStaleClaimToken,
  ownerSignupAfterClaim,
} from './customer-invite-client.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('Tony path: pending invite is in play and never routes to founder onboarding', () => {
  const afterReset = {
    ok: true,
    claimed: true,
    pendingInvite: true,
    inviteAccepted: true,
    organization_id: 4,
    role: 'fse',
    needsMemberOnboarding: true,
  };
  assert.equal(inviteInPlay(afterReset), true);
  assert.equal(destAfterInviteClaim(afterReset, '/onboarding'), '/onboarding/member');

  const alreadyJoined = {
    ok: true,
    skipped: true,
    claimed: true,
    pendingInvite: true,
    inviteAccepted: true,
    organization_id: 4,
    role: 'fse',
    needsMemberOnboarding: false,
  };
  assert.equal(inviteInPlay(alreadyJoined), true);
  assert.equal(destAfterInviteClaim(alreadyJoined, '/onboarding'), '/hub');
});

test('new company admin with unfinished onboarding stays on company setup', () => {
  const founder = {
    ok: true,
    skipped: true,
    claimed: false,
    pendingInvite: false,
    organization_id: 12,
    role: 'company_admin',
    needsMemberOnboarding: true,
  };
  assert.equal(inviteInPlay(founder), false);
  assert.equal(shouldSendToMemberOnboarding(founder), false);
  assert.equal(destAfterInviteClaim(founder, '/onboarding'), '/onboarding');

  const invited = {
    ok: true,
    claimed: true,
    pendingInvite: true,
    organization_id: 4,
    role: 'fse',
    needsMemberOnboarding: true,
  };
  assert.equal(shouldSendToMemberOnboarding(invited), true);
  assert.equal(destAfterInviteClaim(invited, '/onboarding'), '/onboarding/member');

  const acceptedMember = {
    ok: true,
    skipped: true,
    claimed: false,
    pendingInvite: false,
    inviteAccepted: true,
    organization_id: 4,
    role: 'fse',
    needsMemberOnboarding: true,
  };
  assert.equal(shouldSendToMemberOnboarding(acceptedMember), true);
});

test('no invitation → founder onboarding is allowed', () => {
  const none = { ok: true, claimed: false, pendingInvite: false, status: 200 };
  assert.equal(inviteInPlay(none), false);
  assert.equal(destAfterInviteClaim(none, '/onboarding'), '/onboarding');
  assert.equal(routeAfterTeamClaim(none, '/onboarding'), '/onboarding');
  assert.equal(inviteInPlay(null), false);
});

test('already-accepted historical invite does not hijack later logins', () => {
  const historical = {
    ok: true,
    skipped: true,
    claimed: false,
    pendingInvite: false,
    inviteAccepted: true,
    organization_id: 4,
    needsMemberOnboarding: false,
  };
  assert.equal(inviteInPlay(historical), false);
  assert.equal(destAfterInviteClaim(historical, '/'), '/hub');
});

test('claim route marks skip as accepted and returns routing flags', () => {
  const source = readFileSync(join(here, '../app/api/team/claim/route.ts'), 'utf8');
  assert.match(source, /pendingInvite/);
  assert.match(source, /inviteAccepted/);
  assert.match(source, /needsMemberOnboarding/);
  assert.match(source, /claimed:\s*true/);
  assert.match(source, /ok:\s*true,\s*claimed:\s*false,\s*pendingInvite:\s*false/);
  assert.doesNotMatch(source, /No pending invitation found for this email/);
  assert.doesNotMatch(source, /status:\s*404/);
});

test('password reset / invite callback claims before founder onboarding', () => {
  const callback = readFileSync(join(here, '../app/auth/callback/page.tsx'), 'utf8');
  assert.match(callback, /claimPendingInvitations/);
  assert.match(callback, /inviteInPlay/);
  assert.match(callback, /isInviteOrRecovery/);

  const setPassword = readFileSync(join(here, '../app/auth/set-password/page.tsx'), 'utf8');
  assert.match(setPassword, /destAfterInviteClaim/);
  assert.match(setPassword, /inviteInPlay/);
});

test('founder onboarding claims on load and on finish; does not skip claim after save', () => {
  const onboarding = readFileSync(join(here, '../app/onboarding/page.tsx'), 'utf8');
  const routing = readFileSync(join(here, './no-org-route.ts'), 'utf8');
  assert.match(onboarding, /postTeamClaim/);
  assert.match(onboarding, /onboardingLeaveTarget/);
  assert.match(routing, /shouldSendToMemberOnboarding/);
  assert.match(onboarding, /inviteInPlay/);
  assert.match(onboarding, /saveOnboarding/);
  assert.match(onboarding, /destAfterInviteClaim/);
  assert.match(onboarding, /ensureOrganizationMembership/);
  assert.doesNotMatch(onboarding, /hasInviteToken/);
  assert.doesNotMatch(onboarding, /organization_memberships'\)\.upsert|organization_memberships'\)\.insert/);
  assert.doesNotMatch(onboarding, /inviteInPlay\(claimJson\) \|\| claimJson\.needsMemberOnboarding/);
  assert.doesNotMatch(
    onboarding,
    /Do not claim FSE invites onto a founder who just created this org/
  );
  const claimCalls = onboarding.match(/await postTeamClaim/g) || [];
  assert.equal(claimCalls.length, 3);
});

test('a failed clinic claim does not create a new organization', () => {
  assert.deepEqual(ownerSignupAfterClaim({ fromClaimLink: false, claimed: false, error: 'nope' }), {
    action: 'create-org',
  });
  assert.deepEqual(ownerSignupAfterClaim({ fromClaimLink: true, claimed: true, error: 'ignored' }), {
    action: 'claimed',
  });
  const failed = ownerSignupAfterClaim({
    fromClaimLink: true,
    claimed: false,
    error: 'This company profile already has an owner account.',
  });
  assert.equal(failed.action, 'show-error');
  if (failed.action === 'show-error') assert.match(failed.message, /already has an owner/);
  const blank = ownerSignupAfterClaim({ fromClaimLink: true, claimed: false, error: '   ' });
  assert.equal(blank.action, 'show-error');
  if (blank.action === 'show-error') assert.match(blank.message, /was not created/);

  const owner = readFileSync(join(here, '../app/signup/owner/page.tsx'), 'utf8');
  const claimBranch = owner.slice(owner.indexOf('if (claimToken)'), owner.indexOf('const applied = await applyPendingSignup'));
  assert.match(claimBranch, /ownerSignupAfterClaim/);
  assert.match(claimBranch, /clearStaleClaimToken/);
  assert.doesNotMatch(claimBranch, /applyPendingSignup/);
  assert.match(owner, /applyPendingSignup\(supabase, userId, pending\)/);

  const callback = readFileSync(join(here, '../app/auth/callback/page.tsx'), 'utf8');
  const callbackClaim = callback.slice(callback.indexOf('if (claimToken)'), callback.indexOf('const pending = inviteInPlay'));
  assert.match(callbackClaim, /clinicClaimSignInRoute/);
  assert.match(callbackClaim, /refusedClaimLoginHref/);
  assert.match(callbackClaim, /clearStaleClaimToken/);
  assert.doesNotMatch(callbackClaim, /applyPendingSignup/);
  assert.doesNotMatch(callbackClaim, /\/company\?justSetup=1/);

  const helper = readFileSync(join(here, './customer-invite-client.ts'), 'utf8');
  assert.match(helper, /clearPendingSignup\(\)/);
  assert.match(helper, /refreshSession/);
  const claimRoute = readFileSync(join(here, '../app/api/customers/claim/route.ts'), 'utf8');
  assert.match(claimRoute, /updateUserById/);
  assert.match(claimRoute, /claimSignupMetadataClearPatch/);
});

test('a failed claim clears stored signup so the next sign-in does not rebuild a clinic', async () => {
  let refreshed = 0;
  await clearStaleClaimToken({
    auth: {
      refreshSession: async () => {
        refreshed += 1;
      },
    },
  });
  assert.equal(refreshed, 1);
  assert.equal(claimTokenSeenOnSignIn({ queryClaim: null, metadataClaim: 'still-set', storedClaim: null }), 'still-set');
  assert.equal(claimTokenSeenOnSignIn({ queryClaim: null, metadataClaim: null, storedClaim: null }), '');
});

test('a failed owner claim hides the verified step and shows how to continue', () => {
  assert.match(CLAIM_INVITE_UNUSED, /couldn't be used/);
  assert.match(CLAIM_INVITE_UNUSED, /Sign in with the email/i);
  const owner = readFileSync(join(here, '../app/signup/owner/page.tsx'), 'utf8');
  assert.match(owner, /CLAIM_INVITE_UNUSED/);
  assert.match(owner, /awaitingConfirm && !claimFailed/);
  assert.match(owner, /claimFailed \? 'hidden'/);
  assert.match(owner, /href="\/login"/);
  assert.match(owner, /\{t\('Sign in'\)\}/);
  const otp = readFileSync(join(here, '../components/AuthOtpBox.tsx'), 'utf8');
  const waited = otp.indexOf('if (onVerified) await onVerified()');
  const green = otp.indexOf('Verified! Continuing');
  assert.ok(waited !== -1 && green !== -1 && waited < green);
});

test('applyPendingSignup claims a team invite by email instead of creating a new shop', () => {
  const pending = readFileSync(join(here, './pending-signup.ts'), 'utf8');
  assert.match(pending, /if \(session\?\.access_token\)/);
  assert.match(pending, /postTeamClaim\(session\.access_token\)/);
  assert.doesNotMatch(pending, /access_token && pending\.extra\?\.claimToken/);
  assert.match(pending, /inviteInPlay/);
  assert.match(pending, /destAfterInviteClaim/);
  assert.match(pending, /ensureOrganizationMembership/);
  assert.doesNotMatch(pending, /organization_memberships'\)\.upsert/);
});

test('invitee who signs up at /login with no token is still claimed onto member onboarding', () => {
  const login = readFileSync(join(here, '../app/login/page.tsx'), 'utf8');
  assert.match(login, /postTeamClaim\(sessionData\.session\.access_token\)/);
  assert.match(login, /loginDest\(claim, dest/);
  assert.match(readFileSync(join(here, './no-org-route.ts'), 'utf8'), /routeAfterTeamClaim\(claim, requested\)/);
  assert.doesNotMatch(login, /hasInviteToken|requireInviteToken/);
  assert.match(login, /await finishLogin\(nextPath && nextPath !== '\/' \? nextPath : '\/onboarding'\)/);
  const claimed = {
    ok: true,
    claimed: true,
    pendingInvite: true,
    organization_id: 4,
    role: 'fse',
    needsMemberOnboarding: true,
  };
  assert.equal(inviteInPlay(claimed), true);
  assert.equal(routeAfterTeamClaim(claimed, '/onboarding'), '/onboarding/member');
});

test('brand-new founder gets 200 claimed false and lands on /onboarding', () => {
  const route = readFileSync(join(here, '../app/api/team/claim/route.ts'), 'utf8');
  assert.match(route, /ok:\s*true,\s*claimed:\s*false,\s*pendingInvite:\s*false/);
  assert.doesNotMatch(route, /status:\s*404/);
  assert.match(route, /Could not look up the team invite\./);
  assert.match(route, /byIdError/);
  assert.match(route, /openError/);
  assert.match(route, /anyError/);
  const founder = { ok: true, claimed: false, pendingInvite: false, status: 200 };
  assert.equal(inviteInPlay(founder), false);
  assert.equal(routeAfterTeamClaim(founder, '/onboarding'), '/onboarding');

  const client = readFileSync(join(here, './supabase/client.ts'), 'utf8');
  assert.match(client, /res\.claimed === false && !res\.pendingInvite/);
});

test('home and login claim a pending invite before sending someone to founder onboarding', () => {
  const home = readFileSync(join(here, '../components/home/HomeDashboard.tsx'), 'utf8');
  assert.match(home, /claimPendingInvitations/);
  assert.match(home, /inviteInPlay/);

  const login = readFileSync(join(here, '../app/login/page.tsx'), 'utf8');
  assert.match(login, /postTeamClaim/);
  assert.match(login, /loginDest/);
  assert.doesNotMatch(login, /hasInviteToken|requireInviteToken/);
});
