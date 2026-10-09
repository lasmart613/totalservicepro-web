import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { runCustomerClaim } from '../app/api/customers/claim/route.ts';
import { signCustomerInvite } from './customer-invite.ts';

type Profile = {
  id: string;
  organization_id: string | number | null;
  role: string | null;
  email: string;
  onboarding_completed?: boolean;
};

type Write = {
  op: 'update' | 'upsert';
  id: string;
  role?: string;
};

const CLINIC_ID = 42;

function claimRequest(token: string) {
  return new NextRequest('http://127.0.0.1/api/customers/claim', {
    method: 'POST',
    headers: {
      authorization: 'Bearer session-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ token }),
  });
}

function fakeWriter(
  org: { id: number; name: string; email: string; type: string },
  state: { profiles: Profile[]; writes: Write[] }
) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const api: Record<string, unknown> = {
        select() {
          return api;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return api;
        },
        limit() {
          return api;
        },
        maybeSingle: async () => {
          if (table === 'organizations') {
            const found = String(filters.id) === String(org.id) ? org : null;
            return { data: found, error: null };
          }
          const row =
            state.profiles.find((profile) => {
              if (filters.id != null && String(profile.id) !== String(filters.id)) return false;
              if (
                filters.organization_id != null &&
                String(profile.organization_id) !== String(filters.organization_id)
              ) {
                return false;
              }
              return true;
            }) ?? null;
          return { data: row, error: null };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(column: string, value: unknown) {
              if (table === 'user_profiles' && column === 'id') {
                const row = state.profiles.find((profile) => String(profile.id) === String(value));
                if (row) Object.assign(row, patch);
                state.writes.push({
                  op: 'update',
                  id: String(value),
                  role: typeof patch.role === 'string' ? patch.role : undefined,
                });
              }
              return Promise.resolve({ error: null });
            },
          };
        },
        upsert(row: Profile) {
          const existing = state.profiles.find((profile) => profile.id === row.id);
          if (existing) Object.assign(existing, row);
          else state.profiles.push({ ...row });
          state.writes.push({ op: 'upsert', id: row.id, role: row.role ?? undefined });
          return Promise.resolve({ error: null });
        },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          const rows = state.profiles.filter((profile) => {
            if (
              filters.organization_id != null &&
              String(profile.organization_id) !== String(filters.organization_id)
            ) {
              return false;
            }
            return true;
          });
          return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
        },
      };
      return api;
    },
  };
}

async function postClaim(opts: {
  userId: string;
  email: string;
  profiles: Profile[];
}) {
  const previous = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    secret: process.env.CUSTOMER_INVITE_SECRET,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-value';
  process.env.CUSTOMER_INVITE_SECRET = 'invite-test-secret';
  const state = {
    profiles: opts.profiles.map((profile) => ({ ...profile })),
    writes: [] as Write[],
  };
  try {
    const token = signCustomerInvite({
      orgId: String(CLINIC_ID),
      email: opts.email,
      name: 'North Clinic',
    });
    const response = await runCustomerClaim(claimRequest(token), {
      hasServiceRole: () => true,
      getWriter: () =>
        fakeWriter(
          { id: CLINIC_ID, name: 'North Clinic', email: 'front@clinic.test', type: 'customer' },
          state
        ) as never,
      createUserClient: () => ({
        auth: {
          getUser: async () => ({
            data: {
              user: {
                id: opts.userId,
                email: opts.email,
                user_metadata: { first_name: 'Ada', last_name: 'Clinic' },
              },
            },
            error: null,
          }),
        },
      }),
    });
    const body = (await response.json()) as {
      ok?: boolean;
      claimed?: boolean;
      alreadyLinked?: boolean;
      organizationId?: string | number;
      error?: string;
    };
    return { status: response.status, body, profiles: state.profiles, writes: state.writes };
  } finally {
    if (previous.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous.url;
    if (previous.anon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previous.anon;
    if (previous.secret === undefined) delete process.env.CUSTOMER_INVITE_SECRET;
    else process.env.CUSTOMER_INVITE_SECRET = previous.secret;
  }
}

test('a member already in the clinic cannot become a second owner via claim', async () => {
  const result = await postClaim({
    userId: 'member-user',
    email: 'member@clinic.test',
    profiles: [
      { id: 'owner-user', organization_id: CLINIC_ID, role: 'owner', email: 'owner@clinic.test' },
      { id: 'member-user', organization_id: CLINIC_ID, role: 'fse', email: 'member@clinic.test' },
    ],
  });

  assert.equal(result.status, 409);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.claimed, false);
  assert.match(result.body.error || '', /already has an owner/i);
  const member = result.profiles.find((profile) => profile.id === 'member-user');
  assert.equal(member?.role, 'fse');
  assert.equal(member?.organization_id, CLINIC_ID);
  assert.equal(
    result.writes.some((write) => write.id === 'member-user' && write.role === 'owner'),
    false
  );
  assert.equal(result.profiles.filter((profile) => profile.role === 'owner').length, 1);
});

test('the first claim of an unowned clinic makes the claimer owner', async () => {
  const result = await postClaim({
    userId: 'new-user',
    email: 'new@clinic.test',
    profiles: [{ id: 'new-user', organization_id: null, role: null, email: 'new@clinic.test' }],
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.claimed, true);
  assert.equal(result.body.alreadyLinked, undefined);
  assert.equal(String(result.body.organizationId), String(CLINIC_ID));
  const claimer = result.profiles.find((profile) => profile.id === 'new-user');
  assert.equal(claimer?.role, 'owner');
  assert.equal(String(claimer?.organization_id), String(CLINIC_ID));
  assert.equal(result.profiles.filter((profile) => profile.role === 'owner').length, 1);
});

test('an existing member is not promoted when the clinic has no owner yet', async () => {
  const result = await postClaim({
    userId: 'member-user',
    email: 'member@clinic.test',
    profiles: [
      { id: 'member-user', organization_id: CLINIC_ID, role: 'fse', email: 'member@clinic.test' },
    ],
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.claimed, true);
  assert.equal(result.body.alreadyLinked, true);
  const member = result.profiles.find((profile) => profile.id === 'member-user');
  assert.equal(member?.role, 'fse');
  assert.equal(
    result.writes.some((write) => write.role === 'owner'),
    false
  );
});

test('re-claim by the existing owner succeeds without adding another owner', async () => {
  const result = await postClaim({
    userId: 'owner-user',
    email: 'owner@clinic.test',
    profiles: [
      {
        id: 'owner-user',
        organization_id: CLINIC_ID,
        role: 'owner',
        email: 'owner@clinic.test',
        onboarding_completed: true,
      },
    ],
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.claimed, true);
  assert.equal(result.body.alreadyLinked, true);
  assert.equal(String(result.body.organizationId), String(CLINIC_ID));
  const owner = result.profiles.find((profile) => profile.id === 'owner-user');
  assert.equal(owner?.role, 'owner');
  assert.equal(String(owner?.organization_id), String(CLINIC_ID));
  assert.equal(result.profiles.filter((profile) => profile.role === 'owner').length, 1);
  assert.equal(
    result.writes.every((write) => write.id === 'owner-user' && write.role === 'owner'),
    true
  );
});
