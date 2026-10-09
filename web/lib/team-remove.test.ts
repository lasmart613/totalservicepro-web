import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { isPendingTeamInvite } from './org-membership.ts';
import {
  callerMayRemoveTeamMembers,
  decideAdminRemoveMember,
  REMOVE_MEMBER_ERRORS,
  teamMemberRemoveBlocked,
} from './team-remove.ts';
import { runRemoveTeamMember } from '../app/api/team/members/remove/route.ts';
import { runTeamInvite } from '../app/api/team/invite/route.ts';
import { runTeamClaim } from '../app/api/team/claim/route.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ADMIN = 'admin-1';
const MEMBER = 'member-1';
const INVITEE = 'new.person@example.com';
const ORG = 9;
const HOME = 4;

type Membership = {
  user_id: string;
  organization_id: number;
  role: string;
  is_home: boolean;
  is_founder?: boolean;
  created_at?: string | null;
};

type Profile = {
  id: string;
  email: string;
  organization_id: number | null;
  active_organization_id?: number | null;
  role: string;
  onboarding_completed?: boolean;
  first_name?: string | null;
  last_name?: string | null;
  is_founder?: boolean;
};

type Invite = {
  id: number;
  email: string;
  organization_id: number;
  role: string;
  accepted: boolean;
  accepted_at: string | null;
  expires_at: string | null;
  created_at: string;
  first_name?: string | null;
  last_name?: string | null;
};

type Org = { id: number; created_by: string | null; name?: string; type?: string };

type Store = {
  memberships: Membership[];
  profiles: Profile[];
  invites: Invite[];
  orgs: Org[];
  authUsers: Array<{ id: string }>;
  failTable?: string;
  rpcError?: boolean;
};

function futureIso() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

function baseStore(overrides: Partial<Store> = {}): Store {
  return {
    memberships: [
      { user_id: ADMIN, organization_id: ORG, role: 'company_admin', is_home: true, created_at: '2026-01-01T00:00:00.000Z' },
      { user_id: MEMBER, organization_id: ORG, role: 'fse', is_home: false, created_at: '2026-03-01T00:00:00.000Z' },
      { user_id: MEMBER, organization_id: HOME, role: 'fse', is_home: true, created_at: '2026-02-01T00:00:00.000Z' },
    ],
    profiles: [
      {
        id: ADMIN,
        email: 'admin@shop.test',
        organization_id: ORG,
        active_organization_id: ORG,
        role: 'company_admin',
        onboarding_completed: true,
      },
      {
        id: MEMBER,
        email: INVITEE,
        organization_id: HOME,
        active_organization_id: HOME,
        role: 'fse',
        onboarding_completed: true,
        first_name: 'New',
        last_name: 'Person',
      },
    ],
    invites: [
      {
        id: 7,
        email: INVITEE,
        organization_id: ORG,
        role: 'fse',
        accepted: false,
        accepted_at: null,
        expires_at: futureIso(),
        created_at: '2026-10-08T00:00:00.000Z',
        first_name: 'New',
        last_name: 'Person',
      },
    ],
    orgs: [{ id: ORG, created_by: ADMIN, name: 'North Shop', type: 'service_company' }, { id: HOME, created_by: 'someone-else', name: 'Home Shop', type: 'service_company' }],
    authUsers: [{ id: ADMIN }, { id: MEMBER }],
    ...overrides,
  };
}

function matches(row: Record<string, unknown>, filters: Record<string, unknown>) {
  return Object.entries(filters).every(([key, value]) => String(row[key]) === String(value));
}

function rowsFor(state: Store, table: string): Record<string, unknown>[] {
  if (table === 'organization_memberships') return state.memberships;
  if (table === 'user_profiles') return state.profiles;
  if (table === 'organizations') return state.orgs;
  if (table === 'engineer_invitations') return state.invites;
  return [];
}

function removeAdmin(state: Store) {
  const rpcCalls: Array<Record<string, unknown>> = [];
  const admin = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const api = {
        select() {
          return api;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return api;
        },
        maybeSingle: async () => {
          if (state.failTable === table) return { data: null, error: { message: 'db down' } };
          const hit = rowsFor(state, table).find((row) => matches(row, filters)) || null;
          return { data: hit, error: null };
        },
        update() {
          throw new Error(`remove route must not update ${table}`);
        },
        delete() {
          throw new Error(`remove route must not delete ${table}`);
        },
      };
      return api;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, ...args });
      if (state.rpcError) return Promise.resolve({ data: null, error: { message: 'db down' } });
      if (name !== 'remove_organization_member') {
        return Promise.resolve({ data: null, error: { message: 'missing function' } });
      }
      const userId = String(args.p_user_id);
      const orgId = Number(args.p_organization_id);
      const mem = state.memberships.find(
        (row) => row.user_id === userId && row.organization_id === orgId
      );
      if (!mem) return Promise.resolve({ data: null, error: { message: 'membership missing' } });
      const profile = state.profiles.find((row) => row.id === userId);
      const wasHome = mem.is_home === true;
      let homeMovedTo: number | null = null;
      let profileCleared = false;
      const latest = (rows: Membership[]) =>
        rows.slice().sort((a, b) => {
          const aMissing = !a.created_at;
          const bMissing = !b.created_at;
          if (aMissing !== bMissing) return aMissing ? 1 : -1;
          if ((a.created_at || '') !== (b.created_at || '')) {
            return (a.created_at || '') < (b.created_at || '') ? 1 : -1;
          }
          return b.organization_id - a.organization_id;
        })[0];
      const pointProfile = (org: number) => {
        if (!profile) return;
        profile.organization_id = org;
        profile.active_organization_id = org;
      };
      if (wasHome) {
        const next = latest(
          state.memberships.filter((row) => row.user_id === userId && row.organization_id !== orgId)
        );
        state.memberships = state.memberships.filter(
          (row) => !(row.user_id === userId && row.organization_id === orgId)
        );
        if (next) {
          next.is_home = true;
          homeMovedTo = next.organization_id;
          pointProfile(next.organization_id);
        } else {
          profileCleared = true;
          if (profile) {
            profile.organization_id = null;
            profile.active_organization_id = null;
          }
        }
      } else {
        const pointersHit =
          profile != null &&
          (String(profile.organization_id) === String(orgId) ||
            String(profile.active_organization_id) === String(orgId));
        state.memberships = state.memberships.filter(
          (row) => !(row.user_id === userId && row.organization_id === orgId)
        );
        if (pointersHit && profile) {
          const remaining = state.memberships.filter((row) => row.user_id === userId);
          const home = latest(remaining.filter((row) => row.is_home));
          const next = home || latest(remaining);
          if (next) {
            if (!home) next.is_home = true;
            homeMovedTo = next.organization_id;
            pointProfile(next.organization_id);
          } else {
            profileCleared = true;
            profile.organization_id = null;
            profile.active_organization_id = null;
          }
        }
      }
      const email = String(profile?.email || '').toLowerCase();
      let revoked = 0;
      for (const invite of state.invites) {
        if (invite.organization_id !== orgId) continue;
        if (invite.email.toLowerCase() !== email) continue;
        if (!isPendingTeamInvite(invite)) continue;
        invite.expires_at = '2000-01-01T00:00:00.000Z';
        revoked += 1;
      }
      return Promise.resolve({
        data: {
          ok: true,
          home_moved_to: homeMovedTo,
          profile_cleared: profileCleared,
          revoked_invite_count: revoked,
          account_kept: true,
        },
        error: null,
      });
    },
    auth: {
      admin: {
        deleteUser() {
          throw new Error('auth user must not be deleted');
        },
      },
    },
  };
  return { admin, rpcCalls };
}

function withEnv<T>(run: () => Promise<T>) {
  const previous = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-value';
  return run().finally(() => {
    if (previous.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous.url;
    if (previous.anon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previous.anon;
  });
}

function callerClient(userId: string) {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: userId, email: 'admin@shop.test' } }, error: null }),
    },
  };
}

async function postRemove(opts: {
  state: Store;
  callerId?: string;
  userId?: string;
  organizationId?: number;
  method?: 'POST' | 'DELETE';
  hasServiceRole?: boolean;
  token?: string;
}) {
  return withEnv(async () => {
    const harness = removeAdmin(opts.state);
    const response = await runRemoveTeamMember(
      new NextRequest('http://127.0.0.1/api/team/members/remove', {
        method: opts.method || 'POST',
        headers: {
          authorization: opts.token === '' ? '' : 'Bearer session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          userId: opts.userId ?? MEMBER,
          organizationId: opts.organizationId ?? ORG,
        }),
      }),
      {
        hasServiceRole: () => opts.hasServiceRole !== false,
        getAdmin: () => harness.admin as never,
        createUserClient: () => callerClient(opts.callerId || ADMIN),
      }
    );
    const body = (await response.json()) as Record<string, unknown>;
    return { status: response.status, body, rpcCalls: harness.rpcCalls, state: opts.state };
  });
}

test('company admin, owner, and founder may remove; other roles may not', () => {
  assert.equal(callerMayRemoveTeamMembers({ role: 'company_admin' }), true);
  assert.equal(callerMayRemoveTeamMembers({ role: 'admin' }), false);
  assert.equal(callerMayRemoveTeamMembers({ role: 'owner' }), true);
  assert.equal(callerMayRemoveTeamMembers({ role: 'fse', isOrgCreator: true }), true);
  assert.equal(callerMayRemoveTeamMembers({ role: 'fse', founder: true }), true);
  assert.equal(callerMayRemoveTeamMembers({ role: 'service_manager' }), false);
  assert.equal(callerMayRemoveTeamMembers({ role: 'fse' }), false);
  assert.equal(callerMayRemoveTeamMembers({ role: 'dispatcher' }), false);
  assert.equal(callerMayRemoveTeamMembers({ role: 'billing_manager' }), false);

  const blocked = {
    memberId: MEMBER,
    callerId: ADMIN,
    role: 'fse',
    founder: false,
    isOrgCreator: false,
  };
  assert.equal(teamMemberRemoveBlocked(blocked), false);
  assert.equal(teamMemberRemoveBlocked({ ...blocked, role: 'owner' }), true);
  assert.equal(teamMemberRemoveBlocked({ ...blocked, founder: true }), true);
  assert.equal(teamMemberRemoveBlocked({ ...blocked, isOrgCreator: true }), true);
  assert.equal(teamMemberRemoveBlocked({ ...blocked, memberId: ADMIN, callerId: ADMIN }), true);

  assert.equal(
    decideAdminRemoveMember({
      callerMayRemove: false,
      callerId: ADMIN,
      targetUserId: MEMBER,
      targetIsMember: true,
    }).ok,
    false
  );
});

test('admin remove drops only that membership and revokes pending invites', async () => {
  const state = baseStore();
  state.invites.push({
    id: 8,
    email: INVITEE,
    organization_id: HOME,
    role: 'fse',
    accepted: false,
    accepted_at: null,
    expires_at: futureIso(),
    created_at: '2026-10-08T00:00:00.000Z',
  });
  state.invites.push({
    id: 11,
    email: INVITEE,
    organization_id: ORG,
    role: 'fse',
    accepted: true,
    accepted_at: '2026-10-01T00:00:00.000Z',
    expires_at: futureIso(),
    created_at: '2026-09-01T00:00:00.000Z',
  });
  const profilesBefore = JSON.stringify(state.profiles);
  const authBefore = JSON.stringify(state.authUsers);
  const result = await postRemove({ state });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.ok, true);
  assert.equal(result.body.removed, true);
  assert.equal(result.body.accountKept, true);
  assert.equal(result.body.homeMovedTo, null);
  assert.equal(result.body.profileCleared, false);
  assert.equal(result.body.revokedInviteCount, 1);
  assert.equal(result.rpcCalls.length, 1);
  assert.equal(result.rpcCalls[0].name, 'remove_organization_member');
  assert.equal(result.rpcCalls[0].p_actor_id, ADMIN);
  assert.equal(
    state.memberships.some((row) => row.user_id === MEMBER && row.organization_id === ORG),
    false
  );
  assert.equal(
    state.memberships.some((row) => row.user_id === MEMBER && row.organization_id === HOME && row.is_home === true),
    true
  );
  assert.equal(
    state.memberships.some((row) => row.user_id === ADMIN && row.organization_id === ORG),
    true
  );
  const pending = state.invites.find((row) => row.id === 7);
  assert.equal(isPendingTeamInvite(pending!), false);
  assert.equal(pending?.accepted, false);
  const otherOrg = state.invites.find((row) => row.id === 8);
  assert.equal(isPendingTeamInvite(otherOrg!), true);
  const accepted = state.invites.find((row) => row.id === 11);
  assert.equal(accepted?.accepted, true);
  assert.equal(JSON.stringify(state.profiles), profilesBefore);
  assert.equal(JSON.stringify(state.authUsers), authBefore);
});

test('a profile pointer at the removed org moves to the remaining home', async () => {
  const state = baseStore();
  const profile = state.profiles.find((row) => row.id === MEMBER)!;
  profile.organization_id = ORG;
  profile.active_organization_id = 99;
  profile.role = 'fse';
  const result = await postRemove({ state });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.homeMovedTo, HOME);
  assert.equal(result.body.profileCleared, false);
  assert.equal(profile.organization_id, HOME);
  assert.equal(profile.active_organization_id, HOME);
  assert.equal(profile.role, 'fse');
  assert.equal(
    state.memberships.find((row) => row.user_id === MEMBER && row.organization_id === HOME)?.is_home,
    true
  );
  assert.equal(
    state.memberships.some((row) => row.user_id === MEMBER && row.organization_id === ORG),
    false
  );
});

test('an active-org pointer at the removed org moves both pointers to the remaining home', async () => {
  const state = baseStore();
  const profile = state.profiles.find((row) => row.id === MEMBER)!;
  profile.organization_id = HOME;
  profile.active_organization_id = ORG;
  const result = await postRemove({ state });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.homeMovedTo, HOME);
  assert.equal(result.body.profileCleared, false);
  assert.equal(profile.organization_id, HOME);
  assert.equal(profile.active_organization_id, HOME);
});

test('a non-home removal with no home uses the latest other membership', async () => {
  const state = baseStore();
  const older = state.memberships.find((row) => row.user_id === MEMBER && row.organization_id === HOME)!;
  older.is_home = false;
  older.created_at = '2026-02-01T00:00:00.000Z';
  state.memberships.push({
    user_id: MEMBER,
    organization_id: 12,
    role: 'dispatcher',
    is_home: false,
    created_at: '2026-07-01T00:00:00.000Z',
  });
  const profile = state.profiles.find((row) => row.id === MEMBER)!;
  profile.organization_id = ORG;
  profile.active_organization_id = HOME;
  profile.role = 'fse';
  const result = await postRemove({ state });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.homeMovedTo, 12);
  assert.equal(result.body.profileCleared, false);
  assert.equal(profile.organization_id, 12);
  assert.equal(profile.active_organization_id, 12);
  assert.equal(profile.role, 'fse');
  assert.equal(
    state.memberships.find((row) => row.user_id === MEMBER && row.organization_id === 12)?.is_home,
    true
  );
});

test('a non-home removal with no remaining membership clears both pointers', async () => {
  const state = baseStore();
  state.memberships = state.memberships.filter(
    (row) => !(row.user_id === MEMBER && row.organization_id === HOME)
  );
  const row = state.memberships.find((item) => item.user_id === MEMBER && item.organization_id === ORG)!;
  row.is_home = false;
  const profile = state.profiles.find((item) => item.id === MEMBER)!;
  profile.organization_id = ORG;
  profile.active_organization_id = ORG;
  profile.role = 'fse';
  const result = await postRemove({ state });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.homeMovedTo, null);
  assert.equal(result.body.profileCleared, true);
  assert.equal(profile.organization_id, null);
  assert.equal(profile.active_organization_id, null);
  assert.equal(profile.role, 'fse');
  assert.equal(
    state.memberships.some((item) => item.user_id === MEMBER),
    false
  );
});

test('DELETE /api/team/members/remove uses the same rules', async () => {
  const state = baseStore();
  const result = await postRemove({ state, method: 'DELETE' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(
    state.memberships.some((row) => row.user_id === MEMBER && row.organization_id === ORG),
    false
  );
});

test('a founder of the org can remove a member even when their role is not company_admin', async () => {
  const state = baseStore();
  state.orgs.find((row) => row.id === ORG)!.created_by = ADMIN;
  const caller = state.memberships.find((row) => row.user_id === ADMIN)!;
  caller.role = 'fse';
  caller.is_home = false;
  state.profiles.find((row) => row.id === ADMIN)!.role = 'fse';
  const result = await postRemove({ state });
  assert.equal(result.status, 200, JSON.stringify(result.body));
});

test('403 when the caller is not an admin of that org', async () => {
  for (const role of ['service_manager', 'fse', 'dispatcher', 'billing_manager']) {
    const state = baseStore();
    state.orgs.find((row) => row.id === ORG)!.created_by = 'someone-else';
    state.memberships.find((row) => row.user_id === ADMIN)!.role = role;
    state.profiles.find((row) => row.id === ADMIN)!.role = role;
    const membershipsBefore = JSON.stringify(state.memberships);
    const invitesBefore = JSON.stringify(state.invites);
    const result = await postRemove({ state });
    assert.equal(result.status, 403, role);
    assert.equal(result.body.code, 'not_admin');
    assert.equal(result.body.error, REMOVE_MEMBER_ERRORS.not_admin);
    assert.equal(result.rpcCalls.length, 0);
    assert.equal(JSON.stringify(state.memberships), membershipsBefore);
    assert.equal(JSON.stringify(state.invites), invitesBefore);
  }
});

test('403 when the target is the organization owner', async () => {
  const state = baseStore();
  const row = state.memberships.find((item) => item.user_id === MEMBER && item.organization_id === ORG)!;
  row.role = 'owner';
  row.is_home = true;
  const result = await postRemove({ state });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'owner');
  assert.equal(result.body.error, REMOVE_MEMBER_ERRORS.owner);
  assert.equal(result.rpcCalls.length, 0);
  assert.equal(
    state.memberships.some((row) => row.user_id === MEMBER && row.organization_id === ORG),
    true
  );
});

test('403 when the target has a founder flag or created the org', async () => {
  const flagged = baseStore();
  const flaggedRow = flagged.memberships.find((row) => row.user_id === MEMBER && row.organization_id === ORG)!;
  flaggedRow.is_founder = true;
  flaggedRow.is_home = true;
  const flagResult = await postRemove({ state: flagged });
  assert.equal(flagResult.status, 403);
  assert.equal(flagResult.body.code, 'founder');
  assert.equal(flagResult.rpcCalls.length, 0);

  const creator = baseStore();
  creator.orgs.find((row) => row.id === ORG)!.created_by = MEMBER;
  creator.memberships.find((row) => row.user_id === MEMBER && row.organization_id === ORG)!.is_home = true;
  const creatorResult = await postRemove({ state: creator });
  assert.equal(creatorResult.status, 403);
  assert.equal(creatorResult.body.code, 'founder');
  assert.equal(creatorResult.body.error, REMOVE_MEMBER_ERRORS.founder);
  assert.equal(creatorResult.rpcCalls.length, 0);
  assert.equal(
    creator.memberships.some((row) => row.user_id === MEMBER && row.organization_id === ORG),
    true
  );
});

test('403 when the caller is founder of a different org', async () => {
  const state = baseStore();
  state.orgs.find((row) => row.id === ORG)!.created_by = 'someone-else';
  state.orgs.find((row) => row.id === HOME)!.created_by = ADMIN;
  const here = state.memberships.find((row) => row.user_id === ADMIN && row.organization_id === ORG)!;
  here.role = 'fse';
  here.is_founder = false;
  state.memberships.push({
    user_id: ADMIN,
    organization_id: HOME,
    role: 'company_admin',
    is_home: false,
    is_founder: true,
    created_at: '2026-01-02T00:00:00.000Z',
  });
  const caller = state.profiles.find((row) => row.id === ADMIN)!;
  caller.role = 'fse';
  caller.is_founder = true;
  caller.organization_id = HOME;
  const membershipsBefore = JSON.stringify(state.memberships);
  const result = await postRemove({ state });
  assert.equal(result.status, 403, JSON.stringify(result.body));
  assert.equal(result.body.code, 'not_admin');
  assert.equal(result.rpcCalls.length, 0);
  assert.equal(JSON.stringify(state.memberships), membershipsBefore);
});

test('a founder flag on the caller membership in this org can remove', async () => {
  const state = baseStore();
  state.orgs.find((row) => row.id === ORG)!.created_by = 'someone-else';
  const here = state.memberships.find((row) => row.user_id === ADMIN && row.organization_id === ORG)!;
  here.role = 'fse';
  here.is_founder = true;
  state.profiles.find((row) => row.id === ADMIN)!.is_founder = false;
  const result = await postRemove({ state });
  assert.equal(result.status, 200, JSON.stringify(result.body));
});

test('403 when the caller profile role is admin and they are not company_admin, owner, or founder', async () => {
  const state = baseStore();
  state.orgs.find((row) => row.id === ORG)!.created_by = 'someone-else';
  state.memberships.find((row) => row.user_id === ADMIN)!.role = 'fse';
  const caller = state.profiles.find((row) => row.id === ADMIN)!;
  caller.role = 'admin';
  caller.organization_id = ORG;
  caller.active_organization_id = ORG;
  const membershipsBefore = JSON.stringify(state.memberships);
  const profilesBefore = JSON.stringify(state.profiles);
  const result = await postRemove({ state });
  assert.equal(result.status, 403, JSON.stringify(result.body));
  assert.equal(result.body.code, 'not_admin');
  assert.equal(result.body.error, REMOVE_MEMBER_ERRORS.not_admin);
  assert.equal(result.rpcCalls.length, 0);
  assert.equal(JSON.stringify(state.memberships), membershipsBefore);
  assert.equal(JSON.stringify(state.profiles), profilesBefore);
});

test('removing a home employee with no other membership clears both org pointers and leaves the role', async () => {
  const state = baseStore();
  state.memberships = state.memberships.filter(
    (row) => !(row.user_id === MEMBER && row.organization_id === HOME)
  );
  const row = state.memberships.find((item) => item.user_id === MEMBER && item.organization_id === ORG)!;
  row.is_home = true;
  row.role = 'fse';
  const profile = state.profiles.find((item) => item.id === MEMBER)!;
  profile.organization_id = ORG;
  profile.active_organization_id = ORG;
  profile.role = 'service_manager';
  const result = await postRemove({ state });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.removed, true);
  assert.equal(result.body.homeMovedTo, null);
  assert.equal(result.body.profileCleared, true);
  assert.equal(profile.organization_id, null);
  assert.equal(profile.active_organization_id, null);
  assert.equal(profile.role, 'service_manager');
  assert.equal(
    state.memberships.some((item) => item.user_id === MEMBER),
    false
  );
  assert.equal(
    state.memberships.some((item) => item.user_id === ADMIN && item.organization_id === ORG),
    true
  );
});

test('removing a home employee moves home to the latest other membership and points the profile there', async () => {
  const state = baseStore();
  const homeRow = state.memberships.find((item) => item.user_id === MEMBER && item.organization_id === ORG)!;
  homeRow.is_home = true;
  homeRow.role = 'fse';
  homeRow.created_at = '2026-01-15T00:00:00.000Z';
  const older = state.memberships.find((item) => item.user_id === MEMBER && item.organization_id === HOME)!;
  older.is_home = false;
  older.role = 'dispatcher';
  older.created_at = '2026-02-01T00:00:00.000Z';
  state.memberships.push({
    user_id: MEMBER,
    organization_id: 12,
    role: 'billing_manager',
    is_home: false,
    created_at: '2026-06-01T00:00:00.000Z',
  });
  state.orgs.push({ id: 12, created_by: 'someone-else', name: 'Side Shop', type: 'service_company' });
  const profile = state.profiles.find((item) => item.id === MEMBER)!;
  profile.organization_id = ORG;
  profile.active_organization_id = ORG;
  profile.role = 'company_admin';
  const result = await postRemove({ state });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.homeMovedTo, 12);
  assert.equal(result.body.profileCleared, false);
  assert.equal(
    state.memberships.some((item) => item.user_id === MEMBER && item.organization_id === ORG),
    false
  );
  const moved = state.memberships.find((item) => item.user_id === MEMBER && item.organization_id === 12)!;
  assert.equal(moved.is_home, true);
  assert.equal(moved.role, 'billing_manager');
  const kept = state.memberships.find((item) => item.user_id === MEMBER && item.organization_id === HOME)!;
  assert.equal(kept.is_home, false);
  assert.equal(profile.organization_id, 12);
  assert.equal(profile.active_organization_id, 12);
  assert.equal(profile.role, 'company_admin');
});

test('a tie on created_at moves home to the higher organization id', async () => {
  const state = baseStore();
  const homeRow = state.memberships.find((item) => item.user_id === MEMBER && item.organization_id === ORG)!;
  homeRow.is_home = true;
  const older = state.memberships.find((item) => item.user_id === MEMBER && item.organization_id === HOME)!;
  older.is_home = false;
  older.created_at = '2026-04-01T00:00:00.000Z';
  state.memberships.push({
    user_id: MEMBER,
    organization_id: 3,
    role: 'fse',
    is_home: false,
    created_at: '2026-04-01T00:00:00.000Z',
  });
  const profile = state.profiles.find((item) => item.id === MEMBER)!;
  profile.organization_id = ORG;
  profile.active_organization_id = ORG;
  const result = await postRemove({ state });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.homeMovedTo, HOME);
  assert.equal(profile.organization_id, HOME);
  assert.equal(profile.active_organization_id, HOME);
  assert.equal(
    state.memberships.find((item) => item.organization_id === HOME && item.user_id === MEMBER)?.is_home,
    true
  );
  assert.equal(
    state.memberships.find((item) => item.organization_id === 3 && item.user_id === MEMBER)?.is_home,
    false
  );
});

test('403 when the caller targets themselves and points them at self-leave', async () => {
  const state = baseStore();
  const result = await postRemove({ state, userId: ADMIN });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'self');
  assert.match(String(result.body.error), /Leave company/);
  assert.equal(result.body.error, REMOVE_MEMBER_ERRORS.self);
  assert.equal(result.rpcCalls.length, 0);
  assert.equal(
    state.memberships.some((row) => row.user_id === ADMIN && row.organization_id === ORG),
    true
  );
});

test('403 when the target is not a member of that org', async () => {
  const state = baseStore();
  state.memberships = state.memberships.filter(
    (row) => !(row.user_id === MEMBER && row.organization_id === ORG)
  );
  const result = await postRemove({ state, organizationId: ORG });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'not_member');
  assert.equal(result.body.error, REMOVE_MEMBER_ERRORS.not_member);
  assert.equal(result.rpcCalls.length, 0);
  assert.equal(
    state.memberships.some((row) => row.user_id === MEMBER && row.organization_id === HOME),
    true
  );

  const elsewhere = baseStore();
  const other = await postRemove({ state: elsewhere, organizationId: 99, callerId: ADMIN });
  assert.equal(other.status, 403);
  assert.equal(other.body.code, 'not_admin');
  assert.equal(other.rpcCalls.length, 0);
});

test('503 on a database error writes nothing', async () => {
  const unread = baseStore();
  unread.failTable = 'organization_memberships';
  const before = JSON.stringify(unread);
  const failedRead = await postRemove({ state: unread });
  assert.equal(failedRead.status, 503);
  assert.equal(failedRead.body.error, REMOVE_MEMBER_ERRORS.db);
  assert.equal(failedRead.rpcCalls.length, 0);
  assert.equal(JSON.stringify({ ...unread, failTable: 'organization_memberships' }), before);

  const rpc = baseStore();
  rpc.rpcError = true;
  const snapshot = JSON.stringify(rpc.memberships) + JSON.stringify(rpc.invites) + JSON.stringify(rpc.profiles);
  const failedRpc = await postRemove({ state: rpc });
  assert.equal(failedRpc.status, 503);
  assert.equal(failedRpc.rpcCalls.length, 1);
  assert.equal(
    JSON.stringify(rpc.memberships) + JSON.stringify(rpc.invites) + JSON.stringify(rpc.profiles),
    snapshot
  );

  const missing = await postRemove({ state: baseStore(), hasServiceRole: false });
  assert.equal(missing.status, 503);
  const signedOut = await postRemove({ state: baseStore(), token: '' });
  assert.equal(signedOut.status, 401);
});

test('a removed member can be re-invited and the rejoin claim adds the membership back', async () => {
  const state = baseStore();
  const removed = await postRemove({ state });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(isPendingTeamInvite(state.invites[0]), false);
  assert.equal(
    state.memberships.some((row) => row.user_id === MEMBER && row.organization_id === ORG),
    false
  );

  const reopened = await withEnv(async () => {
    const invite = state.invites[0];
    const response = await runTeamInvite(
      new NextRequest('http://127.0.0.1/api/team/invite', {
        method: 'POST',
        headers: { authorization: 'Bearer session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ email: INVITEE, role: 'fse', resend: true }),
      }),
      {
        hasServiceRole: () => true,
        resendKey: 'resend-test',
        getAdmin: () =>
          ({
            from(table: string) {
              const api = {
                select() {
                  return api;
                },
                eq() {
                  return api;
                },
                maybeSingle: async () => {
                  if (table === 'organizations') {
                    return { data: { id: ORG, name: 'North Shop', type: 'service_company', services_offered: null }, error: null };
                  }
                  if (table === 'user_profiles') {
                    return { data: state.profiles.find((row) => row.id === MEMBER) || null, error: null };
                  }
                  if (table === 'engineer_invitations') return { data: invite, error: null };
                  return { data: null, error: null };
                },
                update(patch: Record<string, unknown>) {
                  return {
                    eq() {
                      Object.assign(invite, patch);
                      return Promise.resolve({ error: null });
                    },
                  };
                },
                insert() {
                  return { select: () => ({ maybeSingle: async () => ({ data: { id: invite.id }, error: null }) }) };
                },
              };
              return api;
            },
            auth: { admin: { generateLink: async () => ({ data: null, error: { message: 'unused' } }) } },
          }) as never,
        findAuthUser: async () => ({
          status: 'found' as const,
          user: { id: MEMBER, email: INVITEE, last_sign_in_at: '2026-10-02T00:00:00.000Z' },
        }),
        createUserClient: () => ({
          auth: {
            getUser: async () => ({ data: { user: { id: ADMIN, email: 'admin@shop.test' } }, error: null }),
          },
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { organization_id: ORG, role: 'company_admin' }, error: null }),
              }),
            }),
          }),
        }),
        sendEmail: async () => ({ ok: true, status: 200 }),
      }
    );
    const body = (await response.json()) as Record<string, unknown>;
    return { status: response.status, body, invite };
  });

  assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
  assert.equal(reopened.body.emailed, true);
  assert.equal(reopened.invite.accepted, false);
  assert.equal(isPendingTeamInvite(reopened.invite), true);

  const claimed = await withEnv(async () => {
    const invite = state.invites[0];
    const memberships = state.memberships.map((row) => ({ ...row }));
    const profiles = state.profiles.map((row) => ({ ...row }));
    const response = await runTeamClaim(
      new NextRequest('http://127.0.0.1/api/team/claim', {
        method: 'POST',
        headers: { authorization: 'Bearer session-token', 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      {
        hasServiceRole: () => true,
        getAdmin: () => claimAdmin({ invite, memberships, profiles }) as never,
        createUserClient: () => ({
          auth: {
            getUser: async () => ({
              data: {
                user: {
                  id: MEMBER,
                  email: INVITEE,
                  email_confirmed_at: '2026-10-01T00:00:00.000Z',
                  user_metadata: {},
                },
              },
              error: null,
            }),
          },
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { organization_id: HOME, role: 'fse', onboarding_completed: true },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }
    );
    const body = (await response.json()) as Record<string, unknown>;
    return { status: response.status, body, memberships, profiles, invite };
  });

  assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
  assert.equal(claimed.body.claimed, true);
  assert.equal(claimed.invite.accepted, true);
  assert.equal(
    claimed.memberships.some((row) => row.user_id === MEMBER && row.organization_id === ORG && row.is_home === false),
    true
  );
  assert.equal(String(claimed.profiles.find((row) => row.id === MEMBER)?.organization_id), String(HOME));
});

test('an accepted invite stays accepted so the rejoin path can reopen it', async () => {
  const state = baseStore();
  state.invites[0].accepted = true;
  state.invites[0].accepted_at = '2026-10-01T00:00:00.000Z';
  const removed = await postRemove({ state });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.revokedInviteCount, 0);
  assert.equal(state.invites[0].accepted, true);

  const reopened = await withEnv(() =>
    reopenAccepted(state.invites[0], state.profiles.find((row) => row.id === MEMBER)!)
  );
  assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
  assert.equal(reopened.invite.accepted, false);
  assert.equal(isPendingTeamInvite(reopened.invite), true);
});

async function reopenAccepted(invite: Invite, profile: Profile) {
  const response = await runTeamInvite(
    new NextRequest('http://127.0.0.1/api/team/invite', {
      method: 'POST',
      headers: { authorization: 'Bearer session-token', 'content-type': 'application/json' },
      body: JSON.stringify({ email: INVITEE, role: 'fse', resend: true }),
    }),
    {
      hasServiceRole: () => true,
      resendKey: 'resend-test',
      getAdmin: () =>
        ({
          from(table: string) {
            const api = {
              select() {
                return api;
              },
              eq() {
                return api;
              },
              maybeSingle: async () => {
                if (table === 'organizations') {
                  return { data: { id: ORG, name: 'North Shop', type: 'service_company', services_offered: null }, error: null };
                }
                if (table === 'user_profiles') return { data: profile, error: null };
                if (table === 'engineer_invitations') return { data: invite, error: null };
                return { data: null, error: null };
              },
              update(patch: Record<string, unknown>) {
                return {
                  eq() {
                    Object.assign(invite, patch);
                    return Promise.resolve({ error: null });
                  },
                };
              },
              insert() {
                return { select: () => ({ maybeSingle: async () => ({ data: { id: invite.id }, error: null }) }) };
              },
            };
            return api;
          },
          auth: { admin: { generateLink: async () => ({ data: null, error: { message: 'unused' } }) } },
        }) as never,
      findAuthUser: async () => ({
        status: 'found' as const,
        user: { id: MEMBER, email: INVITEE, last_sign_in_at: '2026-10-02T00:00:00.000Z' },
      }),
      createUserClient: () => ({
        auth: {
          getUser: async () => ({ data: { user: { id: ADMIN, email: 'admin@shop.test' } }, error: null }),
        },
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { organization_id: ORG, role: 'company_admin' }, error: null }),
            }),
          }),
        }),
      }),
      sendEmail: async () => ({ ok: true, status: 200 }),
    }
  );
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body, invite };
}

function claimAdmin(state: { invite: Invite; memberships: Membership[]; profiles: Profile[] }) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
      let payload: Record<string, unknown> = {};
      const finish = (single: boolean) => {
        if (table === 'organization_memberships') {
          if (op === 'insert') {
            state.memberships.push({
              user_id: String(payload.user_id),
              organization_id: Number(payload.organization_id),
              role: String(payload.role || 'fse'),
              is_home: !!payload.is_home,
            });
            return { data: null, error: null };
          }
          const rows = state.memberships.filter((item) => matches(item, filters));
          return { data: single ? rows[0] || null : rows, error: null };
        }
        if (table === 'engineer_invitations') {
          if (op === 'update') {
            Object.assign(state.invite, payload);
            return { data: null, error: null };
          }
          return { data: state.invite, error: null };
        }
        if (table === 'user_profiles') {
          if (op === 'update' || op === 'upsert') {
            const row = state.profiles.find((item) => item.id === (filters.id || payload.id));
            if (row) Object.assign(row, payload);
            return { data: null, error: null };
          }
          const row = state.profiles.find((item) => filters.id == null || item.id === filters.id) || null;
          return { data: row, error: null };
        }
        if (table === 'organizations') {
          return { data: { id: filters.id, created_at: '2020-01-01T00:00:00.000Z', created_by: 'other-user' }, error: null };
        }
        return { data: null, error: null };
      };
      const api = {
        select() {
          return api;
        },
        insert(row: Record<string, unknown>) {
          op = 'insert';
          payload = row;
          return api;
        },
        update(row: Record<string, unknown>) {
          op = 'update';
          payload = row;
          return api;
        },
        upsert(row: Record<string, unknown>) {
          op = 'upsert';
          payload = row;
          return api;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return api;
        },
        ilike(column: string, value: unknown) {
          filters[column] = value;
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return api;
        },
        maybeSingle() {
          return Promise.resolve(finish(true));
        },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve(finish(false)).then(onFulfilled, onRejected);
        },
      };
      return api;
    },
  };
}

test('remove migration is one transaction and the rollback drops the function', () => {
  const migration = readFileSync(
    join(here, '../supabase/migrations/20261009_000905_remove_organization_member.sql'),
    'utf8'
  );
  const rollback = readFileSync(
    join(here, '../supabase/migrations/20261009_000905_remove_organization_member_rollback.sql'),
    'utf8'
  );
  const firstSql = (sql: string) =>
    sql
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim()
      .split(';')[0]
      .trim();
  assert.equal(firstSql(migration), "SET LOCAL lock_timeout = '5s'");
  assert.equal(firstSql(rollback), "SET LOCAL lock_timeout = '5s'");
  assert.match(migration, /remove_organization_member/);
  assert.match(migration, /DELETE FROM public\.organization_memberships/);
  assert.match(migration, /organization_id = p_organization_id/);
  assert.match(migration, /UPDATE public\.engineer_invitations/);
  assert.match(migration, /invitation_is_open/);
  assert.match(migration, /is_home = false/);
  assert.match(migration, /ORDER BY m\.created_at DESC NULLS LAST, m\.organization_id DESC/);
  assert.match(migration, /PERFORM public\.set_home_membership\(p_user_id, next_org, NULL, false\)/);
  assert.match(migration, /organization_id = next_org/);
  assert.match(migration, /active_organization_id = next_org/);
  assert.match(migration, /organization_id = NULL/);
  assert.match(migration, /active_organization_id = NULL/);
  assert.match(migration, /home_moved_to/);
  assert.match(migration, /profile_cleared/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.remove_organization_member\(uuid, bigint, uuid\) TO service_role/);
  assert.doesNotMatch(migration, /profile_still_points_here/);
  assert.doesNotMatch(migration, /role = public\.profile_role_from_membership/);
  assert.doesNotMatch(migration, /DELETE FROM auth\.users/);
  assert.doesNotMatch(migration, /A home membership cannot be removed/);
  assert.doesNotMatch(migration, /\bCONCURRENTLY\b/i);
  assert.doesNotMatch(migration, /\bCOMMIT\b/i);
  assert.doesNotMatch(rollback, /\bCONCURRENTLY\b/i);
  assert.doesNotMatch(rollback, /\bCOMMIT\b/i);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.remove_organization_member\(uuid, bigint, uuid\)/);

  const route = readFileSync(join(here, '../app/api/team/members/remove/route.ts'), 'utf8');
  assert.match(route, /REMOVE_MEMBER_RPC/);
  assert.match(route, /homeMovedTo/);
  assert.match(route, /profileCleared/);
  assert.doesNotMatch(route, /profileStillPointsHere/);
  assert.doesNotMatch(route, /rowFounderFlag\(callerProfile\)/);
  assert.doesNotMatch(route, /callerProfileHere/);
  assert.match(readFileSync(join(here, './team-remove.ts'), 'utf8'), /remove_organization_member/);
  const homeDash = readFileSync(join(here, '../components/home/HomeDashboard.tsx'), 'utf8');
  const callback = readFileSync(join(here, '../app/auth/callback/page.tsx'), 'utf8');
  assert.match(homeDash, /!prof\?\.organization_id/);
  assert.match(homeDash, /router\.replace\('\/onboarding'\)/);
  assert.match(callback, /!prof\?\.organization_id/);
  assert.match(callback, /dest = '\/onboarding'/);
  assert.doesNotMatch(route, /\.update\(/);
  assert.doesNotMatch(route, /\.delete\(/);
  assert.doesNotMatch(route, /deleteUser/);

  const company = readFileSync(join(here, '../app/company/page.tsx'), 'utf8');
  const admin = readFileSync(join(here, '../app/admin/team/page.tsx'), 'utf8');
  const button = readFileSync(join(here, '../components/RemoveTeamMemberButton.tsx'), 'utf8');
  assert.match(company, /RemoveTeamMemberButton/);
  assert.match(admin, /RemoveTeamMemberButton/);
  assert.match(button, /Remove from team/);
  assert.match(button, /window\.confirm/);
  assert.match(button, /teamMemberRemoveBlocked/);
  assert.doesNotMatch(button, /profileStillPointsHere/);
  assert.doesNotMatch(button, /still points at this company/);
  const gap = readFileSync(join(here, './i18n/gap-copy.ts'), 'utf8');
  assert.match(gap, /Remove from team/);
  assert.doesNotMatch(gap, /still points at this company/);
});
