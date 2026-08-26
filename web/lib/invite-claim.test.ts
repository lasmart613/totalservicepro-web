import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { destAfterInviteClaim, inviteInPlay } from './invite-claim.ts';

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

test('founder onboarding claims on load and on finish; does not skip claim after save', () => {
  const onboarding = readFileSync(join(here, '../app/onboarding/page.tsx'), 'utf8');
  assert.match(onboarding, /postTeamClaim|claimPendingInvitations/);
  assert.match(onboarding, /inviteInPlay/);
  assert.match(onboarding, /saveOnboarding/);
  assert.match(onboarding, /destAfterInviteClaim/);
  assert.doesNotMatch(
    onboarding,
    /Do not claim FSE invites onto a founder who just created this org/
  );
});

test('applyPendingSignup claims a team invite instead of creating a new shop', () => {
  const pending = readFileSync(join(here, './pending-signup.ts'), 'utf8');
  assert.match(pending, /postTeamClaim/);
  assert.match(pending, /inviteInPlay/);
  assert.match(pending, /destAfterInviteClaim/);
});

test('home and login claim a pending invite before sending someone to founder onboarding', () => {
  const home = readFileSync(join(here, '../app/page.tsx'), 'utf8');
  assert.match(home, /claimPendingInvitations/);
  assert.match(home, /inviteInPlay/);

  const login = readFileSync(join(here, '../app/login/page.tsx'), 'utf8');
  assert.match(login, /postTeamClaim|claimPendingInvitations/);
  assert.match(login, /inviteInPlay/);
});
