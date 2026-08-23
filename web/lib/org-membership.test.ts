import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_STAFF_ROLE,
  decideClaim,
  decideInviteForExistingProfile,
  decideSwitch,
  inviteMustNotLeaveHome,
  isFounderLockedRole,
  isOnOrgRoster,
  nextActiveAfterLeave,
} from './org-membership.ts';

const TONY_HOME = 101;
const LUXOR = 4;
const COMPANY_A = 10;
const COMPANY_B = 20;

test('default staff role is FSE; founder roles are locked', () => {
  assert.equal(DEFAULT_STAFF_ROLE, 'fse');
  assert.equal(isFounderLockedRole('owner'), true);
  assert.equal(isFounderLockedRole('company_admin'), true);
  assert.equal(isFounderLockedRole('admin'), true);
  assert.equal(isFounderLockedRole('fse'), false);
  assert.equal(isFounderLockedRole('dispatcher'), false);
});

test('Tony moonlight: inviting a dummy-shop founder to Luxor adds FSE membership, no 409', () => {
  const decision = decideInviteForExistingProfile({
    inviteOrgId: LUXOR,
    inviteRole: 'fse',
    profileOrgId: TONY_HOME,
    profileRole: 'company_admin',
    membershipOrgIds: [TONY_HOME],
  });
  assert.equal(decision.action, 'add_membership');
  if (decision.action !== 'add_membership') return;
  assert.equal(decision.role, 'fse');
  assert.equal(decision.activate, false);
  assert.equal(decision.isHome, false);
  assert.equal(decision.moonlight, true);
  assert.match(decision.message, /second membership|home shop/i);
});

test('Tony moonlight: invite does not overwrite founder role on the home shop', () => {
  const alreadyHome = decideInviteForExistingProfile({
    inviteOrgId: TONY_HOME,
    inviteRole: 'fse',
    profileOrgId: TONY_HOME,
    profileRole: 'company_admin',
    membershipOrgIds: [TONY_HOME],
  });
  assert.equal(alreadyHome.action, 'already_on_team');
  if (alreadyHome.action !== 'already_on_team') return;
  assert.equal(alreadyHome.overwriteRole, false);
});

test('claim moonlight keeps home org; does not activate Luxor by default', () => {
  const decision = decideClaim({
    inviteOrgId: LUXOR,
    inviteRole: 'fse',
    memberships: [{ organizationId: TONY_HOME, role: 'company_admin', isHome: true }],
  });
  assert.equal(decision.action, 'accept');
  if (decision.action !== 'accept') return;
  assert.equal(decision.add.organizationId, String(LUXOR));
  assert.equal(decision.add.role, 'fse');
  assert.equal(decision.add.isHome, false);
  assert.equal(decision.activateOrganizationId, null);
  assert.equal(decision.keepHome, true);
  assert.equal(decision.leaveOrganizationId, null);
});

test('move A→B: staff on A can accept B and leave A; account is not deleted', () => {
  const decision = decideClaim({
    inviteOrgId: COMPANY_B,
    inviteRole: 'fse',
    memberships: [{ organizationId: COMPANY_A, role: 'fse', isHome: false }],
    leaveOrganizationId: COMPANY_A,
  });
  assert.equal(decision.action, 'accept');
  if (decision.action !== 'accept') return;
  assert.equal(decision.add.organizationId, String(COMPANY_B));
  assert.equal(decision.leaveOrganizationId, String(COMPANY_A));
  assert.equal(decision.keepHome, false);
});

test('invite/claim cannot strip a founder home shop (Tony cannot be stolen)', () => {
  const check = inviteMustNotLeaveHome({
    leaveOrganizationId: TONY_HOME,
    memberships: [{ organizationId: TONY_HOME, role: 'company_admin', isHome: true }],
  });
  assert.equal(check.ok, false);
  if (check.ok) return;
  assert.match(check.error, /home shop/i);
});

test('switcher only activates an org the user is a member of', () => {
  const ok = decideSwitch({
    targetOrgId: LUXOR,
    memberships: [
      { organizationId: TONY_HOME, role: 'company_admin', isHome: true },
      { organizationId: LUXOR, role: 'fse', isHome: false },
    ],
  });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(String(ok.organizationId), String(LUXOR));
  assert.equal(ok.role, 'fse');

  const denied = decideSwitch({
    targetOrgId: 999,
    memberships: [{ organizationId: TONY_HOME, role: 'company_admin', isHome: true }],
  });
  assert.equal(denied.ok, false);
});

test('after leaving the active shop, fall back to home org', () => {
  const next = nextActiveAfterLeave({
    leftOrgId: LUXOR,
    wasActiveOrgId: LUXOR,
    remaining: [{ organizationId: TONY_HOME, role: 'company_admin', isHome: true }],
  });
  assert.ok(next);
  assert.equal(String(next?.organizationId), String(TONY_HOME));
  assert.equal(next?.role, 'company_admin');
});

test('Luxor roster includes a moonlighting FSE even if their active org is the dummy shop', () => {
  assert.equal(
    isOnOrgRoster(
      {
        userId: 'tony',
        profileOrgId: TONY_HOME,
        membershipOrgIds: [TONY_HOME, LUXOR],
      },
      LUXOR
    ),
    true
  );
  assert.equal(
    isOnOrgRoster({ userId: 'tony', profileOrgId: TONY_HOME, membershipOrgIds: [TONY_HOME] }, LUXOR),
    false
  );
});

test('invite route no longer 409s just because the email already has an org', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../app/api/team/invite/route.ts'), 'utf8');
  assert.match(source, /applyInviteToExistingUser/);
  assert.match(source, /moonlight/);
  assert.match(source, /buildTeamInviteHtml/);
  assert.match(source, /alreadyRegistered: true/);
  assert.match(source, /RESEND_API_KEY/);
  assert.doesNotMatch(source, /inviteUserByEmail/);
  assert.doesNotMatch(
    source,
    /already belongs to another organization\. Ask them to leave that org first/
  );
  assert.doesNotMatch(source, /status: 409/);
});

test('claim does not skip founders who have a pending invite to another shop', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../app/api/team/claim/route.ts'), 'utf8');
  assert.match(source, /decideClaim/);
  assert.match(source, /leaveOrganizationId/);
  assert.doesNotMatch(source, /alreadyFounder && \(existingProf\?\.organization_id/);
});

test('Android WebView switcher uses the same memberships RPCs as the website', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const js = readFileSync(join(here, '../../app/src/main/assets/org-switcher.js'), 'utf8');
  assert.match(js, /organization_memberships/);
  assert.match(js, /switch_active_organization/);
  assert.match(js, /leave_organization/);
  assert.match(js, /Working as/);
});

test('schema keeps organization_id as the active RLS pointer', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(
    join(here, '../supabase/migrations/20260824_000000_organization_memberships.sql'),
    'utf8'
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.organization_memberships/);
  assert.match(sql, /active_organization_id/);
  assert.match(sql, /switch_active_organization/);
  assert.match(sql, /leave_organization/);
  assert.match(sql, /accept_team_invite/);
  assert.match(sql, /user_profiles\.organization_id stays the ACTIVE company/);
});
