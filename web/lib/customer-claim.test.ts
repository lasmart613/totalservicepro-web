import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { CLINIC_OWNER_SLOT_ROLES, runCustomerClaim } from '../app/api/customers/claim/route.ts';
import { runCustomerInvite } from '../app/api/customers/invite/route.ts';
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

type Lookup = {
  table: string;
  inRole: string[] | null;
  limit: number | null;
};

type DbError = { message: string; code?: string };

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
  state: {
    profiles: Profile[];
    writes: Write[];
    lookups: Lookup[];
    ownerLookupError?: DbError | null;
    updateError?: DbError | null;
    uniqueViolation?: boolean;
  }
) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let inRole: string[] | null = null;
      let limitN: number | null = null;
      const api: Record<string, unknown> = {
        select() {
          return api;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return api;
        },
        in(column: string, values: unknown[]) {
          if (column === 'role') inRole = values.map((value) => String(value));
          return api;
        },
        limit(count: number) {
          limitN = count;
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
          const localFilters: Record<string, unknown> = {};
          let applied = false;
          let result: { data: Profile | null; error: DbError | null } = { data: null, error: null };
          const run = () => {
            if (applied) return result;
            applied = true;
            if (state.updateError) {
              result = { data: null, error: state.updateError };
              return result;
            }
            if (table !== 'user_profiles') {
              result = { data: null, error: null };
              return result;
            }
            const row = state.profiles.find((profile) => String(profile.id) === String(localFilters.id));
            if (!row) {
              result = { data: null, error: null };
              return result;
            }
            if (state.uniqueViolation && patch.role === 'owner' && row.role !== 'owner') {
              result = {
                data: null,
                error: {
                  code: '23505',
                  message: 'duplicate key value violates unique constraint "user_profiles_one_owner_per_organization"',
                },
              };
              return result;
            }
            Object.assign(row, patch);
            state.writes.push({
              op: 'update',
              id: String(localFilters.id),
              role: typeof patch.role === 'string' ? patch.role : undefined,
            });
            result = { data: { ...row }, error: null };
            return result;
          };
          const chain: Record<string, unknown> = {
            eq(column: string, value: unknown) {
              localFilters[column] = value;
              return chain;
            },
            select() {
              return chain;
            },
            maybeSingle: async () => run(),
            then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
              return Promise.resolve(run()).then(onFulfilled, onRejected);
            },
          };
          return chain;
        },
        upsert(row: Profile) {
          if (state.uniqueViolation && row.role === 'owner') {
            const existing = state.profiles.find((profile) => profile.id === row.id);
            const alreadyOwner =
              existing?.role === 'owner' && String(existing.organization_id) === String(row.organization_id);
            if (!alreadyOwner) {
              return Promise.resolve({
                data: null,
                error: {
                  code: '23505',
                  message: 'duplicate key value violates unique constraint "user_profiles_one_owner_per_organization"',
                },
              });
            }
          }
          const existing = state.profiles.find((profile) => profile.id === row.id);
          if (existing) Object.assign(existing, row);
          else state.profiles.push({ ...row });
          state.writes.push({ op: 'upsert', id: row.id, role: row.role ?? undefined });
          return Promise.resolve({ error: null });
        },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          if (table === 'contacts') {
            return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
          }
          state.lookups.push({ table, inRole: inRole ? [...inRole] : null, limit: limitN });
          if (state.ownerLookupError && table === 'user_profiles' && filters.id == null) {
            return Promise.resolve({ data: null, error: state.ownerLookupError }).then(onFulfilled, onRejected);
          }
          let rows = state.profiles.filter((profile) => {
            if (
              filters.organization_id != null &&
              String(profile.organization_id) !== String(filters.organization_id)
            ) {
              return false;
            }
            return true;
          });
          if (inRole) {
            const allowed = new Set(inRole.map((role) => role.toLowerCase()));
            rows = rows.filter((profile) => allowed.has(String(profile.role || '').toLowerCase()));
          }
          if (limitN != null) rows = rows.slice(0, limitN);
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
  inviteEmail?: string;
  clinicEmail?: string;
  profiles: Profile[];
  ownerLookupError?: DbError | null;
  updateError?: DbError | null;
  uniqueViolation?: boolean;
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
    lookups: [] as Lookup[],
    ownerLookupError: opts.ownerLookupError,
    updateError: opts.updateError,
    uniqueViolation: opts.uniqueViolation,
  };
  try {
    const token = signCustomerInvite({
      orgId: String(CLINIC_ID),
      email: opts.inviteEmail ?? opts.email,
      name: 'North Clinic',
    });
    const response = await runCustomerClaim(claimRequest(token), {
      hasServiceRole: () => true,
      getWriter: () =>
        fakeWriter(
          {
            id: CLINIC_ID,
            name: 'North Clinic',
            email: opts.clinicEmail ?? opts.inviteEmail ?? opts.email,
            type: 'customer',
          },
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
    return {
      status: response.status,
      body,
      profiles: state.profiles,
      writes: state.writes,
      lookups: state.lookups,
    };
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

test('an existing member of an ownerless clinic with a matching email becomes owner', async () => {
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
  assert.equal(String(result.body.organizationId), String(CLINIC_ID));
  const member = result.profiles.find((profile) => profile.id === 'member-user');
  assert.equal(member?.role, 'owner');
  assert.equal(String(member?.organization_id), String(CLINIC_ID));
  assert.equal(result.profiles.filter((profile) => profile.role === 'owner').length, 1);
});

test('a member whose email does not match the invite is not promoted', async () => {
  const result = await postClaim({
    userId: 'member-user',
    email: 'member@clinic.test',
    inviteEmail: 'other@clinic.test',
    profiles: [
      { id: 'member-user', organization_id: CLINIC_ID, role: 'fse', email: 'member@clinic.test' },
    ],
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.claimed, false);
  assert.match(result.body.error || '', /email this invite was sent to/i);
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

test('an owner lookup error returns 503 and does not write', async () => {
  const result = await postClaim({
    userId: 'new-user',
    email: 'new@clinic.test',
    profiles: [{ id: 'new-user', organization_id: null, role: null, email: 'new@clinic.test' }],
    ownerLookupError: { message: 'connection reset' },
  });

  assert.equal(result.status, 503);
  assert.notEqual(result.body.ok, true);
  assert.equal(result.body.claimed, false);
  assert.match(result.body.error || '', /nothing was changed/i);
  assert.equal(result.writes.length, 0);
  const claimer = result.profiles.find((profile) => profile.id === 'new-user');
  assert.equal(claimer?.role, null);
  assert.equal(claimer?.organization_id, null);
});

test('owner lookup filters owner roles, has no row cap, and ignores non-owner roles', async () => {
  assert.deepEqual([...CLINIC_OWNER_SLOT_ROLES], ['owner', 'customer']);

  const staff = Array.from({ length: 20 }, (_, index) => ({
    id: `fse-${index}`,
    organization_id: CLINIC_ID,
    role: 'fse',
    email: `fse-${index}@clinic.test`,
  }));
  const blocked = await postClaim({
    userId: 'new-user',
    email: 'new@clinic.test',
    profiles: [
      ...staff,
      { id: 'late-owner', organization_id: CLINIC_ID, role: 'owner', email: 'late@clinic.test' },
      { id: 'new-user', organization_id: null, role: null, email: 'new@clinic.test' },
    ],
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.claimed, false);
  assert.equal(
    blocked.writes.some((write) => write.role === 'owner' && write.id === 'new-user'),
    false
  );
  const ownerLookup = blocked.lookups.find((lookup) => lookup.table === 'user_profiles');
  assert.ok(ownerLookup);
  assert.equal(ownerLookup.limit, null);
  assert.deepEqual(ownerLookup.inRole, ['owner', 'customer']);

  const legacyCustomer = await postClaim({
    userId: 'new-user',
    email: 'new@clinic.test',
    profiles: [
      ...staff,
      { id: 'legacy', organization_id: CLINIC_ID, role: 'customer', email: 'legacy@clinic.test' },
      { id: 'new-user', organization_id: null, role: null, email: 'new@clinic.test' },
    ],
  });
  assert.equal(legacyCustomer.status, 409);
  assert.equal(legacyCustomer.profiles.find((profile) => profile.id === 'new-user')?.role, null);

  const staffOnly = await postClaim({
    userId: 'new-user',
    email: 'new@clinic.test',
    profiles: [
      ...staff,
      { id: 'admin-a', organization_id: CLINIC_ID, role: 'admin', email: 'admin-a@clinic.test' },
      { id: 'admin-b', organization_id: CLINIC_ID, role: 'admin', email: 'admin-b@clinic.test' },
      { id: 'lead', organization_id: CLINIC_ID, role: 'company_admin', email: 'lead@clinic.test' },
      { id: 'new-user', organization_id: null, role: null, email: 'new@clinic.test' },
    ],
  });
  assert.equal(staffOnly.status, 200);
  assert.equal(staffOnly.body.ok, true);
  assert.equal(staffOnly.profiles.find((profile) => profile.id === 'new-user')?.role, 'owner');
  assert.equal(staffOnly.profiles.filter((profile) => profile.role === 'owner').length, 1);
  const openLookup = staffOnly.lookups.find((lookup) => lookup.table === 'user_profiles');
  assert.equal(openLookup?.limit, null);
  assert.deepEqual(openLookup?.inRole, ['owner', 'customer']);
});

test('a failed role update is not a successful claim', async () => {
  const result = await postClaim({
    userId: 'member-user',
    email: 'member@clinic.test',
    profiles: [
      { id: 'member-user', organization_id: CLINIC_ID, role: 'fse', email: 'member@clinic.test' },
    ],
    updateError: { message: 'write failed' },
  });

  assert.notEqual(result.status, 200);
  assert.equal(result.status, 503);
  assert.notEqual(result.body.ok, true);
  assert.equal(result.body.claimed, false);
  const member = result.profiles.find((profile) => profile.id === 'member-user');
  assert.equal(member?.role, 'fse');
});

test('a unique owner conflict during claim is 409 and does not succeed', async () => {
  const result = await postClaim({
    userId: 'new-user',
    email: 'new@clinic.test',
    profiles: [{ id: 'new-user', organization_id: null, role: null, email: 'new@clinic.test' }],
    uniqueViolation: true,
  });

  assert.equal(result.status, 409);
  assert.notEqual(result.body.ok, true);
  assert.equal(result.body.claimed, false);
  assert.match(result.body.error || '', /already has an owner/i);
  const claimer = result.profiles.find((profile) => profile.id === 'new-user');
  assert.notEqual(claimer?.role, 'owner');
  assert.equal(
    result.writes.some((write) => write.role === 'owner'),
    false
  );
});

test('a clinic with no email refuses the claim and writes nothing', async () => {
  const result = await postClaim({
    userId: 'new-user',
    email: 'new@clinic.test',
    inviteEmail: 'new@clinic.test',
    clinicEmail: '',
    profiles: [{ id: 'new-user', organization_id: null, role: null, email: 'new@clinic.test' }],
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.claimed, false);
  assert.match(result.body.error || '', /no longer on this clinic/i);
  assert.equal(result.writes.length, 0);
  assert.equal(result.profiles.find((profile) => profile.id === 'new-user')?.role, null);
});

test('a token issued for the old clinic email is refused after the email changes', async () => {
  const result = await postClaim({
    userId: 'new-user',
    email: 'old@clinic.test',
    inviteEmail: 'old@clinic.test',
    clinicEmail: 'new@clinic.test',
    profiles: [{ id: 'new-user', organization_id: null, role: null, email: 'old@clinic.test' }],
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.claimed, false);
  assert.match(result.body.error || '', /no longer on this clinic/i);
  assert.equal(result.writes.length, 0);
  assert.equal(result.profiles.find((profile) => profile.id === 'new-user')?.role, null);
});

test('a token for the clinic current email still claims', async () => {
  const result = await postClaim({
    userId: 'new-user',
    email: 'new@clinic.test',
    inviteEmail: 'new@clinic.test',
    clinicEmail: 'new@clinic.test',
    profiles: [{ id: 'new-user', organization_id: null, role: null, email: 'new@clinic.test' }],
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.claimed, true);
  assert.equal(result.profiles.find((profile) => profile.id === 'new-user')?.role, 'owner');
});

test('the customer invite response has no signup url or token', async () => {
  const previous = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    secret: process.env.CUSTOMER_INVITE_SECRET,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-value';
  process.env.CUSTOMER_INVITE_SECRET = 'invite-test-secret';
  const sent: Array<{ to: string[]; html: string; text: string }> = [];
  try {
    const response = await runCustomerInvite(
      new NextRequest('http://127.0.0.1/api/customers/invite', {
        method: 'POST',
        headers: {
          authorization: 'Bearer session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ customer_organization_id: 42 }),
      }),
      {
        resendKey: 'resend-test',
        sendEmail: async (message) => {
          sent.push({ to: message.to, html: message.html, text: message.text });
          return { ok: true, status: 200, id: 'mail-1' };
        },
        createUserClient: () => ({
          auth: {
            getUser: async () => ({
              data: { user: { id: 'staff-1', email: 'staff@shop.test' } },
              error: null,
            }),
          },
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
              limit() {
                return api;
              },
              maybeSingle: async () => {
                if (table === 'user_profiles') {
                  return { data: { organization_id: 7, role: 'company_admin' }, error: null };
                }
                if (table === 'organization_customers') {
                  return { data: { customer_organization_id: 42 }, error: null };
                }
                if (table === 'organizations') {
                  if (String(filters.id) === '7') {
                    return { data: { id: 7, name: 'North Shop', type: 'service_company' }, error: null };
                  }
                  return {
                    data: {
                      id: 42,
                      name: 'North Clinic',
                      email: 'ada@clinic.test',
                      contact_name: 'Ada',
                      type: 'customer',
                    },
                    error: null,
                  };
                }
                return { data: null, error: null };
              },
              then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
                return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
              },
            };
            return api;
          },
        }),
      }
    );
    const body = (await response.json()) as Record<string, unknown>;
    const packed = JSON.stringify(body);
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.emailed, true);
    assert.equal(body.to, 'ada@clinic.test');
    assert.equal('signupUrl' in body, false);
    assert.equal('token' in body, false);
    assert.doesNotMatch(packed, /signupUrl|claim=|token/i);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ['ada@clinic.test']);
    assert.match(`${sent[0].html}\n${sent[0].text}`, /claim=/);
    assert.equal(packed.includes('claim='), false);
    const client = readFileSync(join(dirname(fileURLToPath(import.meta.url)), './customer-invite-client.ts'), 'utf8');
    const modal = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../components/AddCustomerModal.tsx'), 'utf8');
    assert.doesNotMatch(client, /signupUrl/);
    assert.doesNotMatch(modal, /signupUrl|clipboard|writeText/);
  } finally {
    if (previous.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous.url;
    if (previous.anon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previous.anon;
    if (previous.secret === undefined) delete process.env.CUSTOMER_INVITE_SECRET;
    else process.env.CUSTOMER_INVITE_SECRET = previous.secret;
  }
});

test('one-owner migration is unapplied SQL with a matching rollback', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, '../supabase/migrations');
  const name = '20261009_000903_one_clinic_owner_and_invite_auth_user.sql';
  const sql = readFileSync(join(dir, name), 'utf8');
  const rollback = readFileSync(join(dir, name.replace(/\.sql$/, '_rollback.sql')), 'utf8');
  const firstSql = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim()
    .split(';')[0]
    .trim();
  assert.equal(firstSql, "SET LOCAL lock_timeout = '5s'");
  assert.doesNotMatch(sql, /\bCONCURRENTLY\b/i);
  assert.doesNotMatch(sql, /\bCOMMIT\b/i);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_one_owner_per_organization/);
  assert.match(sql, /ON public\.user_profiles \(organization_id\)/);
  assert.match(sql, /WHERE role = 'owner'/);
  assert.doesNotMatch(sql, /WHERE role IN/);
  assert.doesNotMatch(sql, /WHERE role = 'admin'/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS created_auth_user_id uuid/);
  assert.match(sql, /REVOKE SELECT \(created_auth_user_id\)/);
  assert.match(rollback, /DROP INDEX IF EXISTS public\.user_profiles_one_owner_per_organization/);
  assert.match(rollback, /DROP COLUMN IF EXISTS created_auth_user_id/);
  assert.match(rollback, /SET LOCAL lock_timeout = '5s'/);
});
