import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { teamClaimMovesHome } from './org-membership.ts';
import { switchUserOrganization, upsertMembership } from './org-membership-server.ts';
import { runTeamClaim } from '../app/api/team/claim/route.ts';

const here = dirname(fileURLToPath(import.meta.url));

type HomeRow = {
  userId: string;
  organizationId: number;
  role: string;
  isHome: boolean;
};

/**
 * Same two steps as set_home_membership: clear other homes, then mark the
 * target. A failure after the clear restores the snapshot.
 */
function applyHomeSwitch(
  rows: HomeRow[],
  input: { userId: string; organizationId: number; role: string },
  options?: { failOn?: 'clear' | 'set' }
): { ok: true; rows: HomeRow[] } | { ok: false; rows: HomeRow[]; error: string } {
  const snapshot = rows.map((row) => ({ ...row }));
  try {
    if (options?.failOn === 'clear') throw new Error('clear failed');
    const cleared = snapshot.map((row) => {
      if (row.userId !== input.userId || row.organizationId === input.organizationId || !row.isHome) {
        return row;
      }
      return { ...row, isHome: false };
    });
    if (options?.failOn === 'set') throw new Error('set failed');
    const next = cleared.map((row) => ({ ...row }));
    const hit = next.find(
      (row) => row.userId === input.userId && row.organizationId === input.organizationId
    );
    if (hit) {
      hit.isHome = true;
      hit.role = input.role;
    } else {
      next.push({
        userId: input.userId,
        organizationId: input.organizationId,
        role: input.role,
        isHome: true,
      });
    }
    const homes = next.filter((row) => row.userId === input.userId && row.isHome);
    if (homes.length !== 1) throw new Error(`expected one home, saw ${homes.length}`);
    return { ok: true, rows: next };
  } catch (err) {
    return {
      ok: false,
      rows: snapshot,
      error: err instanceof Error ? err.message : 'home switch failed',
    };
  }
}

test('a first membership becomes home; moonlight does not; a post-invite company does', () => {
  assert.equal(
    teamClaimMovesHome({
      hasMembership: false,
      activeOrgCreatedByCaller: false,
    }),
    true
  );
  assert.equal(
    teamClaimMovesHome({
      hasMembership: true,
      activeOrgCreatedByCaller: false,
    }),
    false
  );
  assert.equal(
    teamClaimMovesHome({
      hasMembership: true,
      activeOrgCreatedByCaller: true,
      activeOrgCreatedAt: '2026-08-01T00:00:00.000Z',
      inviteCreatedAt: '2026-08-25T00:00:00.000Z',
    }),
    false
  );
  assert.equal(
    teamClaimMovesHome({
      hasMembership: true,
      activeOrgCreatedByCaller: true,
      activeOrgCreatedAt: '2026-08-25T04:24:00.000Z',
      inviteCreatedAt: '2026-08-25T00:36:00.000Z',
      activeOrgIsEmpty: true,
    }),
    true
  );
  assert.equal(
    teamClaimMovesHome({
      hasMembership: true,
      activeOrgCreatedByCaller: true,
      activeOrgCreatedAt: '2026-08-25T04:24:00.000Z',
      inviteCreatedAt: '2026-08-25T00:36:00.000Z',
      activeOrgIsEmpty: false,
    }),
    false
  );
  assert.equal(
    teamClaimMovesHome({
      hasMembership: true,
      activeOrgCreatedByCaller: true,
      activeOrgCreatedAt: '2026-08-25T04:24:00.000Z',
      inviteCreatedAt: '2026-08-25T00:36:00.000Z',
    }),
    false
  );
});

test('create-org switches home and a failed set leaves the old home', async () => {
  const before: HomeRow[] = [
    { userId: 'u', organizationId: 4, role: 'company_admin', isHome: true },
  ];
  const moved = applyHomeSwitch(before, {
    userId: 'u',
    organizationId: 2528,
    role: 'company_admin',
  });
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  assert.equal(moved.rows.find((row) => row.organizationId === 4)?.isHome, false);
  assert.equal(moved.rows.find((row) => row.organizationId === 2528)?.isHome, true);

  const failed = applyHomeSwitch(before, { userId: 'u', organizationId: 2528, role: 'company_admin' }, {
    failOn: 'set',
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.rows.length, 1);
  assert.equal(failed.rows[0].organizationId, 4);
  assert.equal(failed.rows[0].isHome, true);

  let tableWrite = false;
  const saved = await upsertMembership(
    {
      from() {
        tableWrite = true;
        throw new Error('home switch must not fall back to a table write');
      },
      async rpc(fn: string, args: Record<string, unknown>) {
        assert.equal(fn, 'set_home_membership');
        assert.equal(args.p_user_id, 'u');
        assert.equal(args.p_organization_id, 2528);
        assert.equal(args.p_sync_profile, true);
        const result = applyHomeSwitch(
          before,
          { userId: 'u', organizationId: 2528, role: 'company_admin' },
          { failOn: 'set' }
        );
        assert.equal(result.rows[0].isHome, true);
        return { data: null, error: { message: result.ok ? '' : result.error } };
      },
    } as never,
    {
      userId: 'u',
      organizationId: 2528,
      role: 'company_admin',
      isHome: true,
      syncProfile: true,
    }
  );
  assert.equal(saved.ok, false);
  assert.equal(tableWrite, false);
  assert.equal(before[0].isHome, true);
});

type Mem = { user_id: string; organization_id: number; role: string; is_home: boolean };
type Prof = {
  id: string;
  email: string;
  organization_id: number | null;
  role: string | null;
  onboarding_completed: boolean;
};

function claimAdmin(state: {
  invite: Record<string, unknown>;
  memberships: Mem[];
  profiles: Prof[];
  org: { id: number; created_at: string; created_by: string };
  customers: { service_organization_id: number }[];
  tickets: { organization_id: number }[];
  failHome?: 'set' | null;
}) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const notEqual: Record<string, unknown> = {};
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
          if (op === 'update') {
            const row = state.memberships.find(
              (item) =>
                item.user_id === filters.user_id &&
                String(item.organization_id) === String(filters.organization_id)
            );
            if (row && payload.role) row.role = String(payload.role);
            return { data: null, error: null };
          }
          const rows = state.memberships.filter((item) => {
            if (filters.user_id != null && item.user_id !== filters.user_id) return false;
            if (notEqual.user_id != null && item.user_id === notEqual.user_id) return false;
            if (
              filters.organization_id != null &&
              String(item.organization_id) !== String(filters.organization_id)
            ) {
              return false;
            }
            return true;
          });
          return { data: single ? rows[0] || null : rows, error: null };
        }
        if (table === 'engineer_invitations') {
          if (op === 'update') {
            Object.assign(state.invite, payload);
            return { data: null, error: null };
          }
          const email = String(state.invite.email || '').toLowerCase();
          const wanted = filters.email != null ? String(filters.email).toLowerCase() : null;
          if (wanted && wanted !== email) return { data: null, error: null };
          if (filters.accepted === false && state.invite.accepted !== false) {
            return { data: null, error: null };
          }
          return { data: state.invite, error: null };
        }
        if (table === 'user_profiles') {
          if (op === 'upsert' || op === 'update') {
            const id = String(payload.id || filters.id || '');
            const row = state.profiles.find((item) => item.id === id);
            if (row) Object.assign(row, payload);
            else if (op === 'upsert') state.profiles.push(payload as Prof);
            return { data: row || null, error: null };
          }
          const row = state.profiles.find((item) => filters.id == null || item.id === filters.id) || null;
          return { data: row, error: null };
        }
        if (table === 'organizations') {
          const found = String(filters.id) === String(state.org.id) ? state.org : null;
          return { data: found, error: null };
        }
        if (table === 'organization_customers') {
          const rows = state.customers.filter(
            (row) =>
              filters.service_organization_id == null ||
              String(row.service_organization_id) === String(filters.service_organization_id)
          );
          return { data: rows, error: null };
        }
        if (table === 'service_tickets') {
          const rows = state.tickets.filter(
            (row) =>
              filters.organization_id == null ||
              String(row.organization_id) === String(filters.organization_id)
          );
          return { data: rows, error: null };
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
        neq(column: string, value: unknown) {
          notEqual[column] = value;
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
    async rpc(fn: string, args: Record<string, unknown>) {
      if (fn !== 'set_home_membership') {
        return { data: null, error: { message: `unknown rpc ${fn}` } };
      }
      const snapshot = state.memberships.map((row) => ({ ...row }));
      const profiles = state.profiles.map((row) => ({ ...row }));
      const userId = String(args.p_user_id);
      const orgId = Number(args.p_organization_id);
      const role = String(args.p_role || 'fse');
      try {
        for (const row of state.memberships) {
          if (row.user_id === userId && row.organization_id !== orgId && row.is_home) row.is_home = false;
        }
        if (state.failHome === 'set') throw new Error('set failed');
        const existing = state.memberships.find(
          (row) => row.user_id === userId && row.organization_id === orgId
        );
        if (existing) {
          existing.is_home = true;
          existing.role = role;
        } else {
          state.memberships.push({
            user_id: userId,
            organization_id: orgId,
            role,
            is_home: true,
          });
        }
        if (args.p_sync_profile) {
          const profile = state.profiles.find((row) => row.id === userId);
          if (profile) {
            profile.organization_id = orgId;
            profile.role = role;
          }
        }
        return { data: null, error: null };
      } catch (err) {
        state.memberships = snapshot;
        state.profiles = profiles;
        return { data: null, error: { message: err instanceof Error ? err.message : 'set failed' } };
      }
    },
  };
}

const INVITEE = 'founder@example.com';

async function postClaim(opts: {
  profileOrg: number | null;
  profileRole?: string;
  memberships: Mem[];
  org: { id: number; created_at: string; created_by: string };
  inviteCreatedAt: string;
  failHome?: 'set' | null;
  otherMembers?: Mem[];
  customers?: { service_organization_id: number }[];
  tickets?: { organization_id: number }[];
}) {
  const previous = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-value';
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const state = {
    invite: {
      id: 7,
      email: INVITEE,
      organization_id: 9,
      role: 'fse',
      accepted: false,
      accepted_at: null,
      expires_at: future,
      created_at: opts.inviteCreatedAt,
      first_name: 'Ada',
      last_name: 'Founder',
    } as Record<string, unknown>,
    memberships: [...opts.memberships, ...(opts.otherMembers || [])].map((row) => ({ ...row })),
    profiles: [
      {
        id: 'auth-1',
        email: INVITEE,
        organization_id: opts.profileOrg,
        role: opts.profileRole || 'company_admin',
        onboarding_completed: true,
      },
    ] as Prof[],
    org: opts.org,
    customers: opts.customers || [],
    tickets: opts.tickets || [],
    failHome: opts.failHome ?? null,
  };
  try {
    const response = await runTeamClaim(
      new NextRequest('http://127.0.0.1/api/team/claim', {
        method: 'POST',
        headers: {
          authorization: 'Bearer session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      }),
      {
        hasServiceRole: () => true,
        getAdmin: () => claimAdmin(state) as never,
        createUserClient: () => ({
          auth: {
            getUser: async () => ({
              data: {
                user: {
                  id: 'auth-1',
                  email: INVITEE,
                  email_confirmed_at: '2026-08-01T00:00:00.000Z',
                  user_metadata: { first_name: 'Ada', last_name: 'Founder' },
                },
              },
              error: null,
            }),
          },
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    organization_id: opts.profileOrg,
                    role: opts.profileRole || 'company_admin',
                    onboarding_completed: true,
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }
    );
    const body = (await response.json()) as Record<string, unknown>;
    return { status: response.status, body, state };
  } finally {
    if (previous.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous.url;
    if (previous.anon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previous.anon;
  }
}

test('claim switches home when the active org is an empty shop created after the invite', async () => {
  const result = await postClaim({
    profileOrg: 4,
    memberships: [{ user_id: 'auth-1', organization_id: 4, role: 'company_admin', is_home: true }],
    org: { id: 4, created_at: '2026-08-25T04:24:00.000Z', created_by: 'auth-1' },
    inviteCreatedAt: '2026-08-25T00:36:00.000Z',
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.claimed, true);
  assert.equal(result.body.moonlight, false);
  assert.equal(String(result.state.profiles[0].organization_id), '9');
  const oldHome = result.state.memberships.find((row) => row.organization_id === 4);
  const newHome = result.state.memberships.find((row) => row.organization_id === 9);
  assert.equal(oldHome?.is_home, false);
  assert.equal(oldHome?.role, 'company_admin');
  assert.equal(newHome?.is_home, true);
  assert.equal(newHome?.role, 'fse');
});

test('moonlight claim keeps the existing home', async () => {
  const result = await postClaim({
    profileOrg: 4,
    memberships: [{ user_id: 'auth-1', organization_id: 4, role: 'company_admin', is_home: true }],
    org: { id: 4, created_at: '2026-08-01T00:00:00.000Z', created_by: 'auth-1' },
    inviteCreatedAt: '2026-08-25T00:36:00.000Z',
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.moonlight, true);
  assert.equal(String(result.state.profiles[0].organization_id), '4');
  assert.equal(result.state.memberships.find((row) => row.organization_id === 4)?.is_home, true);
  assert.equal(result.state.memberships.find((row) => row.organization_id === 9)?.is_home, false);
});

async function claimOccupiedShop(extra: {
  otherMembers?: Mem[];
  customers?: { service_organization_id: number }[];
  tickets?: { organization_id: number }[];
}) {
  return postClaim({
    profileOrg: 4,
    profileRole: 'owner',
    memberships: [{ user_id: 'auth-1', organization_id: 4, role: 'owner', is_home: true }],
    org: { id: 4, created_at: '2026-08-25T04:24:00.000Z', created_by: 'auth-1' },
    inviteCreatedAt: '2026-08-25T00:36:00.000Z',
    ...extra,
  });
}

function assertFounderKeptHome(result: Awaited<ReturnType<typeof postClaim>>) {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.moonlight, true);
  assert.equal(String(result.state.profiles[0].organization_id), '4');
  assert.equal(result.state.profiles[0].role, 'owner');
  const home = result.state.memberships.find((row) => row.organization_id === 4 && row.user_id === 'auth-1');
  const joined = result.state.memberships.find((row) => row.organization_id === 9);
  assert.equal(home?.is_home, true);
  assert.equal(home?.role, 'owner');
  assert.equal(joined?.is_home, false);
}

test('an empty shop created after the invite moves home', async () => {
  const result = await claimOccupiedShop({});
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.moonlight, false);
  assert.equal(String(result.state.profiles[0].organization_id), '9');
  assert.equal(result.state.memberships.find((row) => row.organization_id === 4)?.is_home, false);
  assert.equal(result.state.memberships.find((row) => row.organization_id === 9)?.is_home, true);
});

test('a shop with another member does not move home or the founder role', async () => {
  const result = await claimOccupiedShop({
    otherMembers: [{ user_id: 'staff-2', organization_id: 4, role: 'fse', is_home: false }],
  });
  assertFounderKeptHome(result);
});

test('a shop with a customer does not move home or the founder role', async () => {
  const result = await claimOccupiedShop({
    customers: [{ service_organization_id: 4 }],
  });
  assertFounderKeptHome(result);
});

test('a shop with a service ticket does not move home or the founder role', async () => {
  const result = await claimOccupiedShop({
    tickets: [{ organization_id: 4 }],
  });
  assertFounderKeptHome(result);
});

test('a failed home switch on claim leaves the old home and does not accept the invite', async () => {
  const result = await postClaim({
    profileOrg: 4,
    memberships: [{ user_id: 'auth-1', organization_id: 4, role: 'company_admin', is_home: true }],
    org: { id: 4, created_at: '2026-08-25T04:24:00.000Z', created_by: 'auth-1' },
    inviteCreatedAt: '2026-08-25T00:36:00.000Z',
    failHome: 'set',
  });
  assert.equal(result.status, 503, JSON.stringify(result.body));
  assert.equal(result.body.ok, false);
  assert.equal(result.state.invite.accepted, false);
  assert.equal(result.state.memberships.length, 1);
  assert.equal(result.state.memberships[0].organization_id, 4);
  assert.equal(result.state.memberships[0].is_home, true);
  assert.equal(result.state.memberships[0].role, 'company_admin');
  assert.equal(String(result.state.profiles[0].organization_id), '4');
});

type SwitchState = {
  memberships: Mem[];
  profile: Prof;
};

/** Service-role profile sync from 000904, plus the single-home trigger. */
function applyServiceRoleProfileSync(state: SwitchState, userId: string, organizationId: number, role: string) {
  const hasHome = state.memberships.some((row) => row.user_id === userId && row.is_home);
  const markHome = !hasHome;
  let row = state.memberships.find(
    (item) => item.user_id === userId && item.organization_id === organizationId
  );
  if (!row) {
    row = { user_id: userId, organization_id: organizationId, role, is_home: markHome };
    state.memberships.push(row);
  } else {
    const wasHome = row.is_home;
    row.is_home = wasHome || markHome;
    if (!wasHome) row.role = role;
  }
  if (row.is_home) {
    for (const other of state.memberships) {
      if (other.user_id === userId && other.organization_id !== organizationId && other.is_home) {
        other.is_home = false;
      }
    }
  }
  state.profile.organization_id = organizationId;
  state.profile.role = role;
}

function switchAdmin(state: SwitchState) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let payload: Record<string, unknown> = {};
      const api = {
        select() {
          return api;
        },
        update(row: Record<string, unknown>) {
          payload = row;
          return api;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return api;
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          if (table === 'organization_memberships') {
            const rows = state.memberships.filter((item) => filters.user_id == null || item.user_id === filters.user_id);
            return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
          }
          if (table === 'user_profiles') {
            applyServiceRoleProfileSync(
              state,
              String(filters.id),
              Number(payload.organization_id),
              String(payload.role || state.profile.role || 'fse')
            );
            return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
          }
          return Promise.resolve({ data: null, error: { message: `unexpected ${table}` } }).then(onFulfilled, onRejected);
        },
      };
      return api;
    },
  };
}

test('switching to an org you created keeps the existing home', async () => {
  const state: SwitchState = {
    memberships: [
      { user_id: 'auth-1', organization_id: 4, role: 'company_admin', is_home: true },
      { user_id: 'auth-1', organization_id: 2528, role: 'company_admin', is_home: false },
    ],
    profile: {
      id: 'auth-1',
      email: 'founder@example.com',
      organization_id: 4,
      role: 'company_admin',
      onboarding_completed: true,
    },
  };
  const result = await switchUserOrganization(switchAdmin(state) as never, {
    userId: 'auth-1',
    targetOrgId: 2528,
  });
  assert.equal(result.ok, true);
  assert.equal(state.profile.organization_id, 2528);
  assert.equal(state.memberships.find((row) => row.organization_id === 4)?.is_home, true);
  assert.equal(state.memberships.find((row) => row.organization_id === 2528)?.is_home, false);
  assert.equal(state.memberships.find((row) => row.organization_id === 4)?.role, 'company_admin');
});

test('switching when the user has no home makes it home', async () => {
  const state: SwitchState = {
    memberships: [
      { user_id: 'auth-1', organization_id: 4, role: 'fse', is_home: false },
      { user_id: 'auth-1', organization_id: 2528, role: 'company_admin', is_home: false },
    ],
    profile: {
      id: 'auth-1',
      email: 'founder@example.com',
      organization_id: 4,
      role: 'fse',
      onboarding_completed: true,
    },
  };
  const result = await switchUserOrganization(switchAdmin(state) as never, {
    userId: 'auth-1',
    targetOrgId: 2528,
  });
  assert.equal(result.ok, true);
  assert.equal(state.profile.organization_id, 2528);
  assert.equal(state.memberships.find((row) => row.organization_id === 4)?.is_home, false);
  assert.equal(state.memberships.find((row) => row.organization_id === 2528)?.is_home, true);
});

test('one home migration, rollback, and Tony oneoff stay data-safe', () => {
  const migration = readFileSync(
    join(here, '../supabase/migrations/20261009_000904_one_home_membership.sql'),
    'utf8'
  );
  const rollback = readFileSync(
    join(here, '../supabase/migrations/20261009_000904_one_home_membership_rollback.sql'),
    'utf8'
  );
  const find = readFileSync(
    join(here, '../supabase/oneoff/20261009_duplicate_home_memberships_find.sql'),
    'utf8'
  );
  const oneoff = readFileSync(join(here, '../supabase/oneoff/20261009_tony_single_home.sql'), 'utf8');
  const oneoffRollback = readFileSync(
    join(here, '../supabase/oneoff/20261009_tony_single_home_rollback.sql'),
    'utf8'
  );
  const founder = readFileSync(join(here, '../app/api/org/founder/route.ts'), 'utf8');
  const onboarding = readFileSync(join(here, '../app/onboarding/page.tsx'), 'utf8');
  const customer = readFileSync(join(here, '../app/api/customers/claim/route.ts'), 'utf8');

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
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS organization_memberships_one_home_per_user\s+ON public\.organization_memberships \(user_id\)\s+WHERE is_home/
  );
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = public, pg_temp/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.set_home_membership\(uuid, bigint, text, boolean\) TO service_role/);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.set_home_membership\(uuid, bigint, text, boolean\) TO authenticated/);
  assert.doesNotMatch(migration, /\bCONCURRENTLY\b/i);
  assert.doesNotMatch(migration, /\bCOMMIT\b/i);
  assert.doesNotMatch(migration, /home := own_created/);
  assert.match(migration, /SELECT NOT EXISTS \([\s\S]*?m\.is_home IS TRUE[\s\S]*?\) INTO home/);
  assert.match(migration, /user_profiles_sync_membership/);
  const fn = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION public.set_home_membership'),
    migration.indexOf('COMMENT ON FUNCTION public.set_home_membership')
  );
  const clearAt = fn.indexOf('SET is_home = false');
  const insertAt = fn.indexOf('INSERT INTO public.organization_memberships');
  assert.ok(clearAt > 0 && insertAt > clearAt);
  assert.match(fn, /IF n <> 1 THEN/);
  assert.match(fn, /IF homes <> 1 THEN/);

  assert.match(rollback, /SET LOCAL lock_timeout = '5s'/);
  assert.match(rollback, /DROP INDEX IF EXISTS public\.organization_memberships_one_home_per_user/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.set_home_membership\(uuid, bigint, text, boolean\)/);
  assert.doesNotMatch(rollback, /\bCOMMIT\b/i);
  assert.doesNotMatch(rollback, /UPDATE public\.organization_memberships/);
  assert.match(rollback, /home := own_created/);
  assert.ok(
    rollback.indexOf('DROP TRIGGER IF EXISTS organization_memberships_enforce_single_home') <
      rollback.indexOf('home := own_created')
  );

  assert.doesNotMatch(find, /\b(UPDATE|INSERT|DELETE|ALTER|DROP)\b/i);
  assert.match(find, /WHERE is_home/);
  assert.match(find, /HAVING count\(\*\) > 1/);

  assert.equal(firstSql(oneoff), "SET LOCAL lock_timeout = '5s'");
  assert.match(oneoff, /WHERE id = 17/);
  assert.match(oneoff, /user_id = '3841fd9c-4931-4993-91f7-a7b785e4341e'/);
  assert.match(oneoff, /organization_id = 2528/);
  assert.match(oneoff, /is_home IS TRUE/);
  assert.match(oneoff, /IF n <> 1 THEN/);
  assert.doesNotMatch(oneoff, /user_profiles/);
  assert.doesNotMatch(oneoff, /\bCOMMIT\b/i);
  assert.doesNotMatch(oneoff, /SET role/);

  assert.match(oneoffRollback, /SET is_home = true/);
  assert.match(oneoffRollback, /WHERE id = 17/);
  assert.match(oneoffRollback, /user_id = '3841fd9c-4931-4993-91f7-a7b785e4341e'/);
  assert.match(oneoffRollback, /organization_id = 2528/);
  assert.match(oneoffRollback, /IF n <> 1 THEN/);
  assert.doesNotMatch(oneoffRollback, /user_profiles/);
  assert.doesNotMatch(oneoffRollback, /SET role/);
  assert.match(oneoffRollback, /20261009_000904_one_home_membership_rollback\.sql/);
  assert.match(oneoffRollback, /FIRST/);
  assert.match(oneoffRollback, /clears membership 13/);

  assert.match(founder, /isHome:\s*true/);
  assert.match(founder, /syncProfile:\s*true/);
  assert.match(onboarding, /is_home:\s*true/);
  assert.match(onboarding, /ensureOrganizationMembership/);
  assert.match(customer, /set_home_membership/);
  assert.match(customer, /p_role:\s*'owner'/);
  assert.match(customer, /p_sync_profile:\s*true/);
});
