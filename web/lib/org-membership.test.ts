import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { runOrgMemberships } from '../app/api/org/memberships/route.ts';
import { exactEmailImatch } from './email-match.ts';
import {
  DEFAULT_STAFF_ROLE,
  decideClaim,
  decideInviteForExistingProfile,
  decideSwitch,
  invitationIsOpen,
  isPendingTeamInvite,
  inviteMustNotLeaveHome,
  isFounderLockedRole,
  isOnOrgRoster,
  membershipRoleForInvite,
  nextActiveAfterLeave,
} from './org-membership.ts';

const TONY_HOME = 101;
const LUXOR = 4;
const COMPANY_A = 10;
const COMPANY_B = 20;

test('empty invite role defaults to fse and expired invites are closed', () => {
  assert.equal(membershipRoleForInvite('admin'), 'admin');
  assert.equal(membershipRoleForInvite(''), 'fse');
  assert.equal(membershipRoleForInvite(null), 'fse');
  assert.equal(membershipRoleForInvite('  FSE  '), 'fse');
  assert.equal(membershipRoleForInvite('fse'), 'fse');
  const now = Date.parse('2026-10-06T00:00:00.000Z');
  assert.equal(
    invitationIsOpen(
      { accepted: false, expires_at: null, created_at: '2026-10-01T00:00:00.000Z' },
      now
    ),
    true
  );
  assert.equal(
    invitationIsOpen(
      { accepted: false, expires_at: null, created_at: '2026-09-01T00:00:00.000Z' },
      now
    ),
    false
  );
  assert.equal(
    invitationIsOpen(
      { accepted: false, expires_at: '2026-10-01T00:00:00.000Z', created_at: '2026-10-05T00:00:00.000Z' },
      now
    ),
    false
  );
  assert.equal(invitationIsOpen({ accepted: true, expires_at: '2026-12-01T00:00:00.000Z' }, now), false);
});

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
  assert.doesNotMatch(source, /applyInviteToExistingUser/);
  assert.doesNotMatch(source, /ensureTeamMemberProfile/);
  assert.doesNotMatch(source, /upsertMembership/);
  assert.match(source, /freshTeamInviteFields/);
  assert.match(source, /moonlight/);
  assert.match(source, /buildTeamInviteHtml/);
  assert.match(source, /alreadyRegistered:/);
  assert.match(source, /RESEND_API_KEY/);
  assert.doesNotMatch(source, /inviteUserByEmail/);
  assert.doesNotMatch(
    source,
    /already belongs to another organization\. Ask them to leave that org first/
  );
  assert.doesNotMatch(source, /status: 409/);
});

test('pending invites are only open unaccepted rows', () => {
  const now = Date.parse('2026-10-09T12:00:00.000Z');
  const open = { accepted: false, expires_at: '2026-10-16T00:00:00.000Z', created_at: '2026-10-08T00:00:00.000Z' };
  assert.equal(isPendingTeamInvite(open, now), true);
  assert.equal(isPendingTeamInvite({ ...open, accepted: true }, now), false);
  assert.equal(isPendingTeamInvite({ ...open, expires_at: '2026-10-01T00:00:00.000Z' }, now), false);
  assert.equal(isPendingTeamInvite({ ...open, revoked: true }, now), false);
  assert.equal(isPendingTeamInvite({ ...open, status: 'revoked' }, now), false);
  assert.equal(isPendingTeamInvite({ ...open, status: 'accepted' }, now), false);

  const here = dirname(fileURLToPath(import.meta.url));
  const list = readFileSync(join(here, '../app/api/team/list/route.ts'), 'utf8');
  assert.match(list, /isPendingTeamInvite/);
  assert.doesNotMatch(list, /onboarding_completed !== true/);
  const admin = readFileSync(join(here, '../app/admin/team/page.tsx'), 'utf8');
  const company = readFileSync(join(here, '../app/company/page.tsx'), 'utf8');
  assert.match(admin, /isPendingTeamInvite/);
  assert.match(company, /isPendingTeamInvite/);
  assert.match(company, /The invite is emailed to them\. They sign in with that address to join\./);
  assert.doesNotMatch(company, /Resend \/ copy link/);
  assert.doesNotMatch(company, /they sign up first/);
  assert.doesNotMatch(company, /Existing account\? Assigned immediately/);
  assert.doesNotMatch(readFileSync(join(here, './i18n/gap-copy.ts'), 'utf8'), /Resend \/ copy link/);
});

test('GET /api/team/list does not enroll people or mark invites accepted', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../app/api/team/list/route.ts'), 'utf8');
  assert.doesNotMatch(source, /upsertMembership/);
  assert.doesNotMatch(source, /accepted: true/);
  assert.match(source, /listMemberUserIdsForOrg/);
  assert.match(source, /onboarding_completed/);
  assert.doesNotMatch(source, /if \(em && memberEmails.has\(em\)\) return false/);
});

test('claim does not skip founders who have a pending invite to another shop', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../app/api/team/claim/route.ts'), 'utf8');
  assert.match(source, /decideClaim/);
  assert.match(source, /leaveOrganizationId/);
  assert.match(source, /pendingInvite/);
  assert.match(source, /inviteAccepted/);
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

test('creating your own shop after an FSE invite still adds a home membership', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(
    join(here, '../supabase/migrations/20260825_000003_founder_own_org_membership.sql'),
    'utf8'
  );
  assert.match(sql, /own_created OR invited/);
  assert.match(sql, /INSERT INTO public\.organization_memberships/);
  assert.match(sql, /service_company/);
  assert.doesNotMatch(
    sql,
    /IF OLD\.organization_id IS NOT NULL THEN\s+RAISE EXCEPTION 'organization_id cannot be changed by the client';\s+END IF;\s+SELECT EXISTS \(\s+SELECT 1 FROM public\.organizations o\s+WHERE o\.id = NEW\.organization_id AND o\.created_by = actor/
  );

  const onboarding = readFileSync(join(here, '../app/onboarding/page.tsx'), 'utf8');
  assert.match(onboarding, /ensureOrganizationMembership/);
  assert.match(onboarding, /is_home:\s*true/);
  assert.match(onboarding, /createdNewOrg/);
  const pending = readFileSync(join(here, './pending-signup.ts'), 'utf8');
  assert.match(pending, /organization_memberships/);
  assert.doesNotMatch(pending, /organization_memberships'\)\.upsert/);

  const membershipsRoute = readFileSync(join(here, '../app/api/org/memberships/route.ts'), 'utf8');
  assert.match(membershipsRoute, /normalizeLookupEmail\(user\.email\)/);
  assert.doesNotMatch(membershipsRoute, /profile\?\.email/);
  assert.doesNotMatch(membershipsRoute, /upsertMembership/);
  assert.doesNotMatch(membershipsRoute, /\.insert\(|\.update\(|\.upsert\(/);
  assert.match(membershipsRoute, /invitationIsOpen/);
  const founder = readFileSync(join(here, '../app/api/org/founder/route.ts'), 'utf8');
  assert.match(founder, /decideFounderLink/);
  assert.match(founder, /isHome:\s*true/);
});

test('invite acceptance and membership inserts follow the Auth login, not profile email', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(
    join(here, '../supabase/migrations/20261002_000000_auth_account_identity.sql'),
    'utf8'
  );
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.auth_login_email\(\)/);
  assert.match(sql, /FROM auth\.users/);
  assert.match(sql, /Never user_profiles\.email/);
  assert.match(sql, /actor_email := public\.auth_login_email\(\)/);
  assert.doesNotMatch(sql, /SELECT email INTO actor_email FROM public\.user_profiles/);
  assert.match(sql, /lower\(btrim\(i\.email\)\) = public\.auth_login_email\(\)/);
  assert.doesNotMatch(sql, /lower\(i\.email\) = lower\(COALESCE\(NEW\.email/);
  assert.match(sql, /NOT IN \('admin', 'company_admin'\)/);
  assert.match(sql, /COALESCE\(p_is_home, false\) = false/);
  assert.match(sql, /membership_insert_allowed\(user_id, organization_id, role, is_home\)/);
  assert.match(sql, /home := false/);
});

test('memberships drops stored invites that do not exactly match the login email', async () => {
  const previous = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-value';
  const seen: string[] = [];
  const invites = [
    {
      id: 1,
      email: 'a*b@x.com',
      organization_id: 9,
      role: 'fse',
      created_at: '2026-10-01T00:00:00.000Z',
      expires_at: '2099-01-01T00:00:00.000Z',
      accepted: false,
    },
    {
      id: 2,
      email: 'axxb@x.com',
      organization_id: 4,
      role: 'fse',
      created_at: '2026-10-02T00:00:00.000Z',
      expires_at: '2099-01-01T00:00:00.000Z',
      accepted: false,
    },
  ];
  try {
    const response = await runOrgMemberships(
      new NextRequest('http://127.0.0.1/api/org/memberships', {
        headers: { authorization: 'Bearer session-token' },
      }),
      {
        hasServiceRole: () => true,
        listMemberships: async () => [],
        createUserClient: () => ({
          auth: {
            getUser: async () => ({ data: { user: { id: 'user-1', email: 'A*B@x.com' } } }),
          },
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        }),
        getAdmin: () => ({
          from(table: string) {
            const api = {
              select() {
                return api;
              },
              filter(column: string, operator: string, value: string) {
                assert.equal(column, 'email');
                assert.equal(operator, 'imatch');
                seen.push(value);
                return api;
              },
              eq() {
                return api;
              },
              in() {
                return api;
              },
              order() {
                return api;
              },
              limit() {
                return api;
              },
              then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
                const data =
                  table === 'engineer_invitations'
                    ? invites
                    : table === 'organizations'
                      ? [
                          { id: 9, name: 'Star Shop' },
                          { id: 4, name: 'Decoy Shop' },
                        ]
                      : [];
                return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
              },
            };
            return api;
          },
        }),
      }
    );
    const body = (await response.json()) as {
      pendingInvites?: Array<{ id?: number; organizationId?: number; name?: string }>;
    };
    assert.equal(response.status, 200);
    assert.deepEqual(seen, [exactEmailImatch('A*B@x.com')]);
    assert.equal(body.pendingInvites?.length, 1);
    assert.equal(body.pendingInvites?.[0]?.id, 1);
    assert.equal(body.pendingInvites?.[0]?.organizationId, 9);
    assert.equal(body.pendingInvites?.[0]?.name, 'Star Shop');
    assert.equal(JSON.stringify(body).includes('axxb@x.com'), false);
    assert.equal(JSON.stringify(body).includes('Decoy Shop'), false);
  } finally {
    if (previous.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous.url;
    if (previous.anon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previous.anon;
  }
});
