import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { destAfterInviteClaim, hasInviteToken, inviteInPlay, shouldSendToMemberOnboarding } from './invite-claim.ts';

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
  const none = { ok: false, status: 404, error: 'No pending invitation found for this email.' };
  assert.equal(inviteInPlay(none), false);
  assert.equal(destAfterInviteClaim(none, '/onboarding'), '/onboarding');
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

test('founder onboarding claims on load and on finish only when an invite token is present', () => {
  const onboarding = readFileSync(join(here, '../app/onboarding/page.tsx'), 'utf8');
  assert.match(onboarding, /hasInviteToken/);
  assert.match(onboarding, /postTeamClaim/);
  assert.match(onboarding, /shouldSendToMemberOnboarding/);
  assert.match(onboarding, /inviteInPlay/);
  assert.match(onboarding, /saveOnboarding/);
  assert.match(onboarding, /destAfterInviteClaim/);
  assert.match(onboarding, /ensureOrganizationMembership/);
  assert.doesNotMatch(onboarding, /organization_memberships'\)\.upsert|organization_memberships'\)\.insert/);
  assert.doesNotMatch(onboarding, /inviteInPlay\(claimJson\) \|\| claimJson\.needsMemberOnboarding/);
  assert.doesNotMatch(
    onboarding,
    /Do not claim FSE invites onto a founder who just created this org/
  );
  const claimCalls = onboarding.match(/await postTeamClaim/g) || [];
  const gates = onboarding.match(/hasInviteToken\(\{/g) || [];
  assert.equal(claimCalls.length, gates.length);
  assert.ok(claimCalls.length >= 3);
});

test('hasInviteToken ignores a plain company signup and matches invite links', () => {
  assert.equal(hasInviteToken({ search: '', metadata: { organization_type: 'service_company' } }), false);
  assert.equal(hasInviteToken({ search: '?type=signup' }), false);
  assert.equal(hasInviteToken({ hash: '#access_token=abc&type=signup' }), false);
  assert.equal(hasInviteToken({ search: '?type=invite&token=abc' }), true);
  assert.equal(hasInviteToken({ search: '?claim=clinic-token' }), true);
  assert.equal(hasInviteToken({ metadata: { claim_token: 'abc' } }), true);
  assert.equal(hasInviteToken({ metadata: { invite_token: '' } }), false);
});

test('applyPendingSignup claims a team invite instead of creating a new shop', () => {
  const pending = readFileSync(join(here, './pending-signup.ts'), 'utf8');
  assert.match(pending, /pending\.extra\?\.claimToken/);
  assert.match(pending, /postTeamClaim/);
  assert.match(pending, /inviteInPlay/);
  assert.match(pending, /destAfterInviteClaim/);
  assert.match(pending, /ensureOrganizationMembership/);
  assert.doesNotMatch(pending, /organization_memberships'\)\.upsert/);
});

test('home and login claim a pending invite before sending someone to founder onboarding', () => {
  const home = readFileSync(join(here, '../components/home/HomeDashboard.tsx'), 'utf8');
  assert.match(home, /claimPendingInvitations/);
  assert.match(home, /inviteInPlay/);

  const login = readFileSync(join(here, '../app/login/page.tsx'), 'utf8');
  assert.match(login, /postTeamClaim|claimPendingInvitations/);
  assert.match(login, /inviteInPlay/);
  assert.match(login, /requireInviteToken: true/);
  assert.match(login, /hasInviteToken/);
});
