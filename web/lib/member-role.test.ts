import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { runChangeMemberRole } from '../app/api/org/members/role/route.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ADMIN = 'admin-1';
const MEMBER = 'member-1';
const FOUNDER = 'founder-1';
const ORG = 9;

type Membership = {
  user_id: string;
  organization_id: number;
  role: string;
  is_home: boolean;
  is_founder?: boolean;
};

type Profile = {
  id: string;
  organization_id: number | null;
  active_organization_id?: number | null;
  role: string;
};

type Org = { id: number; created_by: string | null };

type Store = {
  memberships: Membership[];
  profiles: Profile[];
  orgs: Org[];
};

function baseStore(): Store {
  return {
    memberships: [
      { user_id: ADMIN, organization_id: ORG, role: 'company_admin', is_home: true },
      { user_id: MEMBER, organization_id: ORG, role: 'fse', is_home: false },
      { user_id: FOUNDER, organization_id: ORG, role: 'company_admin', is_home: true, is_founder: true },
    ],
    profiles: [
      { id: ADMIN, organization_id: ORG, active_organization_id: ORG, role: 'company_admin' },
      { id: MEMBER, organization_id: ORG, active_organization_id: ORG, role: 'fse' },
      { id: FOUNDER, organization_id: ORG, active_organization_id: ORG, role: 'company_admin' },
    ],
    orgs: [{ id: ORG, created_by: FOUNDER }],
  };
}

function matches(row: Record<string, unknown>, filters: Record<string, unknown>) {
  return Object.entries(filters).every(([key, value]) => String(row[key]) === String(value));
}

function rowsFor(state: Store, table: string): Record<string, unknown>[] {
  if (table === 'organization_memberships') return state.memberships;
  if (table === 'user_profiles') return state.profiles;
  if (table === 'organizations') return state.orgs;
  return [];
}

function roleAdmin(state: Store) {
  const updates: Array<{ table: string; role: unknown }> = [];
  const admin = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let payload: Record<string, unknown> | null = null;
      const applyUpdate = () => {
        if (!payload) return { data: null, error: null };
        updates.push({ table, role: payload.role });
        for (const row of rowsFor(state, table)) {
          if (matches(row, filters)) Object.assign(row, payload);
        }
        return { data: null, error: null };
      };
      const api = {
        select() {
          return api;
        },
        update(row: Record<string, unknown>) {
          payload = row;
          return api;
        },
        insert() {
          throw new Error(`role route must not insert ${table}`);
        },
        delete() {
          throw new Error(`role route must not delete ${table}`);
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return api;
        },
        maybeSingle: async () => {
          const hit = rowsFor(state, table).find((row) => matches(row, filters)) || null;
          return { data: hit, error: null };
        },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve(applyUpdate()).then(onFulfilled, onRejected);
        },
      };
      return api;
    },
  };
  return { admin, updates };
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
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
    },
  };
}

async function postRole(opts: {
  state: Store;
  callerId?: string;
  userId?: string;
  organizationId?: number;
  role?: string;
}) {
  return withEnv(async () => {
    const harness = roleAdmin(opts.state);
    const response = await runChangeMemberRole(
      new NextRequest('http://127.0.0.1/api/org/members/role', {
        method: 'POST',
        headers: {
          authorization: 'Bearer session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          userId: opts.userId ?? MEMBER,
          organizationId: opts.organizationId ?? ORG,
          role: opts.role,
        }),
      }),
      {
        hasServiceRole: () => true,
        getAdmin: () => harness.admin as never,
        createUserClient: () => callerClient(opts.callerId || ADMIN),
      }
    );
    const body = (await response.json()) as Record<string, unknown>;
    return { status: response.status, body, updates: harness.updates, state: opts.state };
  });
}

function membership(state: Store, userId: string) {
  return state.memberships.find((row) => row.user_id === userId && row.organization_id === ORG);
}

function profile(state: Store, userId: string) {
  return state.profiles.find((row) => row.id === userId);
}

test('owner, admin, and customer roles are refused with no writes', async () => {
  for (const role of ['owner', 'Owner', 'admin', 'ADMIN', 'customer', 'engineer', 'crm', 'parts_supplier', 'scheduler']) {
    const state = baseStore();
    const result = await postRole({ state, role });
    assert.equal(result.status, 403, role);
    assert.equal(result.updates.length, 0, role);
    assert.equal(membership(state, MEMBER)?.role, 'fse', role);
    assert.equal(profile(state, MEMBER)?.role, 'fse', role);
  }
});

test('a company admin cannot promote themselves to owner', async () => {
  const state = baseStore();
  const result = await postRole({ state, callerId: ADMIN, userId: ADMIN, role: 'owner' });
  assert.equal(result.status, 403);
  assert.match(String(result.body.error), /above your own|owner/i);
  assert.equal(result.updates.length, 0);
  assert.equal(membership(state, ADMIN)?.role, 'company_admin');
  assert.equal(profile(state, ADMIN)?.role, 'company_admin');
});

test('a valid team role change is trimmed, lowercased, and copied onto the profile', async () => {
  const state = baseStore();
  const result = await postRole({ state, role: '  DISPATCHER ' });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.role, 'dispatcher');
  assert.equal(membership(state, MEMBER)?.role, 'dispatcher');
  assert.equal(profile(state, MEMBER)?.role, 'dispatcher');
  assert.notEqual(profile(state, MEMBER)?.role, 'admin');
  assert.equal(profile(state, MEMBER)?.role, membership(state, MEMBER)?.role);
  assert.deepEqual(
    result.updates.map((row) => row.role),
    ['dispatcher', 'dispatcher']
  );
});

test('profile role admin with an fse membership cannot change roles', async () => {
  const state = baseStore();
  const caller = 'platform-1';
  state.memberships.push({ user_id: caller, organization_id: ORG, role: 'fse', is_home: false });
  state.profiles.push({
    id: caller,
    organization_id: ORG,
    active_organization_id: ORG,
    role: 'admin',
  });
  const result = await postRole({ state, callerId: caller, role: 'dispatcher' });
  assert.equal(result.status, 403);
  assert.equal(result.updates.length, 0);
  assert.equal(membership(state, MEMBER)?.role, 'fse');
  assert.equal(profile(state, caller)?.role, 'admin');
  assert.equal(profile(state, MEMBER)?.role, 'fse');
});

test('the org owner and founder cannot have their role changed', async () => {
  const owner = baseStore();
  const ownerRow = membership(owner, MEMBER);
  if (!ownerRow) throw new Error('missing member');
  ownerRow.role = 'owner';
  const ownerResult = await postRole({ state: owner, role: 'fse' });
  assert.equal(ownerResult.status, 403);
  assert.equal(ownerResult.updates.length, 0);
  assert.equal(membership(owner, MEMBER)?.role, 'owner');

  const founder = baseStore();
  const founderResult = await postRole({ state: founder, userId: FOUNDER, role: 'fse' });
  assert.equal(founderResult.status, 403);
  assert.equal(founderResult.updates.length, 0);
  assert.equal(membership(founder, FOUNDER)?.role, 'company_admin');
});

test('the org founder can assign a team role, but cannot raise their own', async () => {
  const state = baseStore();
  const founder = membership(state, FOUNDER);
  const founderProfile = profile(state, FOUNDER);
  if (!founder || !founderProfile) throw new Error('missing founder');
  founder.role = 'fse';
  founderProfile.role = 'fse';
  const result = await postRole({ state, callerId: FOUNDER, role: 'service_manager' });
  assert.equal(result.status, 200);
  assert.equal(result.body.role, 'service_manager');
  assert.equal(membership(state, MEMBER)?.role, 'service_manager');
  assert.equal(profile(state, MEMBER)?.role, 'service_manager');

  const raised = await postRole({ state, callerId: FOUNDER, userId: FOUNDER, role: 'company_admin' });
  assert.equal(raised.status, 403);
  assert.equal(raised.updates.length, 0);
  assert.equal(membership(state, FOUNDER)?.role, 'fse');
  assert.equal(profile(state, FOUNDER)?.role, 'fse');
});

test('an owner membership can still change another member to a team role', async () => {
  const state = baseStore();
  state.memberships.push({ user_id: 'owner-1', organization_id: ORG, role: 'owner', is_home: true });
  state.profiles.push({ id: 'owner-1', organization_id: ORG, active_organization_id: ORG, role: 'owner' });
  const result = await postRole({ state, callerId: 'owner-1', role: 'billing_manager' });
  assert.equal(result.status, 200);
  assert.equal(result.body.role, 'billing_manager');
  assert.equal(membership(state, MEMBER)?.role, 'billing_manager');
  assert.equal(profile(state, MEMBER)?.role, 'billing_manager');
  assert.notEqual(profile(state, MEMBER)?.role, 'admin');
});

test('a profile-only admin with no membership in the org is refused', async () => {
  const state = baseStore();
  state.profiles.push({
    id: 'outsider',
    organization_id: ORG,
    active_organization_id: ORG,
    role: 'admin',
  });
  const result = await postRole({ state, callerId: 'outsider', role: 'service_manager' });
  assert.equal(result.status, 403);
  assert.equal(result.updates.length, 0);
  assert.equal(membership(state, MEMBER)?.role, 'fse');
});

test('role route takes authority from membership and only assigns invitable team roles', () => {
  const route = readFileSync(join(here, '../app/api/org/members/role/route.ts'), 'utf8');
  assert.match(route, /isInvitableTeamRole/);
  assert.match(route, /teamRoleForInvite/);
  assert.match(route, /callerMayChangeMemberRole/);
  assert.match(route, /decideMemberRoleChange/);
  assert.match(route, /memberRoleSelfRaiseRefused/);
  assert.match(route, /memberRoleTargetIsLocked/);
  assert.doesNotMatch(route, /profile\.role/);
  assert.doesNotMatch(route, /callerRole = profile/);
});
