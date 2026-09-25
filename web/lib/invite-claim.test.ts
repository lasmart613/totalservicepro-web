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
  assert.match(onboarding, /postTeamClaim/);
  assert.match(onboarding, /shouldSendToMemberOnboarding/);
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
  assert.match(login, /routeAfterTeamClaim\(claim, dest\)/);
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
  assert.match(login, /routeAfterTeamClaim/);
  assert.doesNotMatch(login, /hasInviteToken|requireInviteToken/);
});
