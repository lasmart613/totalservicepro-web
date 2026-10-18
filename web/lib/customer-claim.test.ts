import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { CLINIC_OWNER_SLOT_ROLES, runCustomerClaim } from '../app/api/customers/claim/route.ts';
import { CLAIM_SIGNUP_METADATA_KEYS } from './claim-signup-metadata.ts';
import { runCustomerInvite } from '../app/api/customers/invite/route.ts';
import { openCustomerInvite, signCustomerInvite } from './customer-invite.ts';
import { CLINIC_OWNER_INVITE_ROLES, canAddCustomers, canSendClinicOwnerInvite } from './roles.ts';

const here = dirname(fileURLToPath(import.meta.url));
const CLINIC_ID = 42;
const INVITE_ID = '3f0c9d2e-8a1b-4c3d-9e8f-0a1b2c3d4e5f';

type DbError = { message: string; code?: string };
type RpcCall = { fn: string; args: Record<string, unknown> };
type RpcReply = { data: unknown; error: DbError | null };

function claimRequest(token: string) {
  return new NextRequest('http://127.0.0.1/api/customers/claim', {
    method: 'POST',
    headers: { authorization: 'Bearer session-token', 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

/** Service-role writer: reads organizations/contacts, records any table write and every rpc. */
function fakeWriter(
  org: { id: number; name: string; email: string; type: string } | null,
  state: { rpcCalls: RpcCall[]; tableWrites: string[]; rpcReply: (call: RpcCall) => RpcReply }
) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const write = (op: string) => () => {
        state.tableWrites.push(`${op}:${table}`);
        return api;
      };
      const api: Record<string, unknown> = {
        select() {
          return api;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return api;
        },
        in() {
          return api;
        },
        limit() {
          return api;
        },
        update: write('update'),
        upsert: write('upsert'),
        insert: write('insert'),
        delete: write('delete'),
        maybeSingle: async () => {
          if (table === 'organizations') {
            return { data: org && String(filters.id) === String(org.id) ? org : null, error: null };
          }
          return { data: null, error: null };
        },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
        },
      };
      return api;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      const call = { fn, args };
      state.rpcCalls.push(call);
      return state.rpcReply(call);
    },
  };
}

function okClaim(alreadyLinked = false): RpcReply {
  return { data: { ok: true, organization_id: CLINIC_ID, already_linked: alreadyLinked }, error: null };
}

async function withEnv<T>(fn: () => Promise<T>): Promise<T> {
  const previous = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    secret: process.env.CUSTOMER_INVITE_SECRET,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-value';
  process.env.CUSTOMER_INVITE_SECRET = 'invite-test-secret';
  try {
    return await fn();
  } finally {
    if (previous.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous.url;
    if (previous.anon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previous.anon;
    if (previous.secret === undefined) delete process.env.CUSTOMER_INVITE_SECRET;
    else process.env.CUSTOMER_INVITE_SECRET = previous.secret;
  }
}

async function postClaim(opts: {
  userId: string;
  email: string;
  inviteEmail?: string;
  clinicEmail?: string;
  inv?: string | null;
  rpcReply?: (call: RpcCall) => RpcReply;
  userMetadata?: Record<string, unknown>;
  token?: string;
  org?: { id: number; name: string; email: string; type: string } | null;
}) {
  return withEnv(async () => {
    const state = {
      rpcCalls: [] as RpcCall[],
      tableWrites: [] as string[],
      rpcReply: opts.rpcReply ?? (() => okClaim()),
    };
    const metadataClears: Array<{ userId: string; patch: Record<string, null> }> = [];
    const token =
      opts.token ??
      signCustomerInvite({
        orgId: String(CLINIC_ID),
        email: opts.inviteEmail ?? opts.email,
        name: 'North Clinic',
        ...(opts.inv === null ? {} : { inv: opts.inv ?? INVITE_ID }),
      });
    const org =
      opts.org === undefined
        ? { id: CLINIC_ID, name: 'North Clinic', email: opts.clinicEmail ?? opts.inviteEmail ?? opts.email, type: 'customer' }
        : opts.org;
    const response = await runCustomerClaim(claimRequest(token), {
      hasServiceRole: () => true,
      getWriter: () => fakeWriter(org, state) as never,
      clearClaimSignupMetadata: async (userId, patch) => {
        metadataClears.push({ userId, patch });
      },
      createUserClient: () => ({
        auth: {
          getUser: async () => ({
            data: {
              user: {
                id: opts.userId,
                email: opts.email,
                user_metadata: opts.userMetadata ?? { first_name: 'Ada', last_name: 'Clinic' },
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
      code?: string;
    };
    return { status: response.status, body, rpcCalls: state.rpcCalls, tableWrites: state.tableWrites, metadataClears };
  });
}

test('a first claim goes through claim_clinic_owner_invite with the token invite id; the route writes no table', async () => {
  const result = await postClaim({ userId: 'new-user', email: 'new@clinic.test' });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.claimed, true);
  assert.equal(result.body.alreadyLinked, undefined);
  assert.equal(String(result.body.organizationId), String(CLINIC_ID));
  assert.deepEqual(result.rpcCalls, [
    {
      fn: 'claim_clinic_owner_invite',
      args: { p_invite_id: INVITE_ID, p_user_id: 'new-user', p_first_name: 'Ada', p_last_name: 'Clinic' },
    },
  ]);
  assert.deepEqual(result.tableWrites, []);
});

test('an idempotent re-claim reports alreadyLinked', async () => {
  const result = await postClaim({ userId: 'owner-user', email: 'owner@clinic.test', rpcReply: () => okClaim(true) });
  assert.equal(result.status, 200);
  assert.equal(result.body.alreadyLinked, true);
});

test('every database refusal is mapped to a fixed code and never a success', async () => {
  const cases: Array<[string, number, string, RegExp]> = [
    ['owner_exists', 409, 'owner_exists', /already has an owner/i],
    ['shop_staff', 403, 'claim_refused', /service company that added this clinic/i],
    ['other_org', 409, 'claim_refused', /another organization/i],
    ['email_unconfirmed', 403, 'claim_refused', /confirm your email/i],
    ['email_mismatch', 403, 'email_mismatch', /email this invite was sent to/i],
    ['invite_not_email_of_record', 403, 'email_mismatch', /no longer on this clinic/i],
    ['invite_used', 400, 'token_invalid', /not valid/i],
    ['invite_revoked', 400, 'token_invalid', /not valid/i],
    ['invite_invalid', 400, 'token_invalid', /not valid/i],
    ['invite_expired', 400, 'token_expired', /expired/i],
    ['not_clinic', 400, 'claim_refused', /not for a clinic/i],
    ['something_new', 403, 'claim_refused', /could not be claimed/i],
  ];
  for (const [code, status, claimCode, message] of cases) {
    const result = await postClaim({
      userId: 'u',
      email: 'u@clinic.test',
      rpcReply: () => ({ data: { ok: false, code }, error: null }),
    });
    assert.equal(result.status, status, code);
    assert.equal(result.body.ok, false, code);
    assert.equal(result.body.claimed, false, code);
    assert.equal(result.body.code, claimCode, code);
    assert.match(result.body.error || '', message, code);
    assert.deepEqual(result.tableWrites, [], code);
  }
});

test('a unique-owner race inside the claim is 409; any other database error is 503, never success', async () => {
  const race = await postClaim({
    userId: 'u',
    email: 'u@clinic.test',
    rpcReply: () => ({ data: null, error: { code: '23505', message: 'this clinic already has an owner' } }),
  });
  assert.equal(race.status, 409);
  assert.equal(race.body.code, 'owner_exists');
  const down = await postClaim({
    userId: 'u',
    email: 'u@clinic.test',
    rpcReply: () => ({ data: null, error: { message: 'connection reset' } }),
  });
  assert.equal(down.status, 503);
  assert.equal(down.body.claimed, false);
  assert.equal(down.body.code, 'server_error');
  const wrongOrg = await postClaim({
    userId: 'u',
    email: 'u@clinic.test',
    rpcReply: () => ({ data: { ok: true, organization_id: 999 }, error: null }),
  });
  assert.equal(wrongOrg.status, 500);
  assert.notEqual(wrongOrg.body.ok, true);
});

test('a token signed before 000923 (no invite id) is refused before the database', async () => {
  const result = await postClaim({ userId: 'u', email: 'u@clinic.test', inv: null });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'token_invalid');
  assert.equal(result.rpcCalls.length, 0);
});

test('the route refuses a wrong login email or a non-clinic before calling the claim', async () => {
  const wrongLogin = await postClaim({ userId: 'u', email: 'member@clinic.test', inviteEmail: 'other@clinic.test' });
  assert.equal(wrongLogin.status, 403);
  assert.match(wrongLogin.body.error || '', /email this invite was sent to/i);
  assert.equal(wrongLogin.rpcCalls.length, 0);

  const notClinic = await postClaim({
    userId: 'u',
    email: 'u@clinic.test',
    org: { id: CLINIC_ID, name: 'Shop', email: 'u@clinic.test', type: 'service_company' },
  });
  assert.equal(notClinic.status, 400);
  assert.equal(notClinic.rpcCalls.length, 0);
});

test('L-4 (000924): a CRM edit to the clinic main email does not break a pending claim; the DB email of record decides', async () => {
  const changed = await postClaim({ userId: 'u', email: 'old@clinic.test', clinicEmail: 'new@clinic.test' });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.claimed, true);
  assert.equal(changed.rpcCalls.length, 1);
  assert.equal(changed.rpcCalls[0].args.p_invite_id, INVITE_ID);

  const empty = await postClaim({ userId: 'u', email: 'new@clinic.test', clinicEmail: '' });
  assert.equal(empty.status, 200);
  assert.equal(empty.rpcCalls.length, 1);

  // The database refuses an invite that is not for its email of record.
  const notRecord = await postClaim({
    userId: 'u',
    email: 'old@clinic.test',
    clinicEmail: 'old@clinic.test',
    rpcReply: () => ({ data: { ok: false, code: 'invite_not_email_of_record' }, error: null }),
  });
  assert.equal(notRecord.status, 403);
  assert.equal(notRecord.body.code, 'email_mismatch');

  const src = readFileSync(join(here, '../app/api/customers/claim/route.ts'), 'utf8');
  assert.doesNotMatch(src, /pickCrmReachEmail|fetchDirectoryContactSources/);
});

test('the claim route source writes no profile or membership itself', () => {
  const src = readFileSync(join(here, '../app/api/customers/claim/route.ts'), 'utf8');
  assert.match(src, /rpc\('claim_clinic_owner_invite'/);
  assert.doesNotMatch(src, /from\('user_profiles'\)/);
  assert.doesNotMatch(src, /from\('organization_memberships'\)/);
  assert.doesNotMatch(src, /set_home_membership/);
  assert.doesNotMatch(src, /\.(upsert|insert|update)\(/);
  assert.deepEqual([...CLINIC_OWNER_SLOT_ROLES], ['owner', 'customer']);
});

test('claim tokens carry a well-formed invite id or are refused', () =>
  withEnv(async () => {
    const token = signCustomerInvite({ orgId: '42', email: 'A@B.co', name: 'X', inv: INVITE_ID.toUpperCase() });
    const opened = openCustomerInvite(token);
    assert.equal(opened.ok, true);
    assert.equal(opened.ok && opened.payload.inv, INVITE_ID);
    assert.throws(() => signCustomerInvite({ orgId: '42', email: 'a@b.co', name: 'X', inv: 'not-a-uuid' }));
    const legacy = openCustomerInvite(signCustomerInvite({ orgId: '42', email: 'a@b.co', name: 'X' }));
    assert.equal(legacy.ok, true);
    assert.equal(legacy.ok && legacy.payload.inv, undefined);
  }));

// ---------------- POST /api/customers/invite ----------------

type InviteSetup = {
  profileRole?: string;
  membershipRole?: string | null;
  membershipError?: DbError | null;
  rpcReply?: (call: RpcCall) => RpcReply;
  body?: Record<string, unknown>;
  resendKey?: string | null;
};

async function postInvite(opts: InviteSetup = {}) {
  return withEnv(async () => {
    const sent: Array<{ to: string[]; html: string; text: string }> = [];
    const rpcCalls: RpcCall[] = [];
    const response = await runCustomerInvite(
      new NextRequest('http://127.0.0.1/api/customers/invite', {
        method: 'POST',
        headers: { authorization: 'Bearer session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ customer_organization_id: 42, ...(opts.body || {}) }),
      }),
      {
        resendKey: opts.resendKey === undefined ? 'resend-test' : opts.resendKey,
        sendEmail: async (message) => {
          sent.push({ to: message.to, html: message.html, text: message.text });
          return { ok: true, status: 200, id: 'mail-1' };
        },
        createUserClient: () => ({
          auth: {
            getUser: async () => ({ data: { user: { id: 'staff-1', email: 'staff@shop.test' } }, error: null }),
          },
          async rpc(fn: string, args: Record<string, unknown>) {
            const call = { fn, args };
            rpcCalls.push(call);
            return (opts.rpcReply ?? (() => ({ data: { ok: true, invite_id: INVITE_ID, email: 'ada@clinic.test' }, error: null })))(call);
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
                  return { data: { organization_id: 7, role: opts.profileRole ?? 'company_admin' }, error: null };
                }
                if (table === 'organization_memberships') {
                  if (opts.membershipError) return { data: null, error: opts.membershipError };
                  const role = opts.membershipRole === undefined ? 'company_admin' : opts.membershipRole;
                  return { data: role == null ? null : { role }, error: null };
                }
                if (table === 'organization_customers') {
                  return { data: { customer_organization_id: 42 }, error: null };
                }
                if (table === 'organizations') {
                  if (String(filters.id) === '7') {
                    return { data: { id: 7, name: 'North Shop', type: 'service_company' }, error: null };
                  }
                  return {
                    data: { id: 42, name: 'North Clinic', email: 'ada@clinic.test', contact_name: 'Ada', type: 'customer' },
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
    return { status: response.status, body, sent, rpcCalls };
  });
}

test('the customer invite response has no signup url or token; the emailed token carries the invite id', async () => {
  const result = await postInvite();
  const packed = JSON.stringify(result.body);
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.emailed, true);
  assert.equal(result.body.to, 'ada@clinic.test');
  assert.equal('signupUrl' in result.body, false);
  assert.equal('token' in result.body, false);
  assert.doesNotMatch(packed, /signupUrl|claim=|token|invite_id/i);
  assert.equal(result.sent.length, 1);
  assert.deepEqual(result.sent[0].to, ['ada@clinic.test']);
  assert.deepEqual(result.rpcCalls, [
    {
      fn: 'issue_clinic_owner_invite',
      args: { p_service_org: 7, p_customer_org: 42, p_email: 'ada@clinic.test', p_confirmed_out_of_band: false },
    },
  ]);
  const claim = /claim=([^&"'\s<]+)/.exec(`${result.sent[0].html}\n${result.sent[0].text}`);
  assert.ok(claim, 'email carries a claim link');
  const opened = await withEnv(async () => openCustomerInvite(decodeURIComponent(claim[1]).replace(/&amp;.*$/, '')));
  assert.equal(opened.ok, true);
  assert.equal(opened.ok && opened.payload.inv, INVITE_ID);
  const client = readFileSync(join(here, './customer-invite-client.ts'), 'utf8');
  const modal = readFileSync(join(here, '../components/AddCustomerModal.tsx'), 'utf8');
  assert.doesNotMatch(client, /signupUrl/);
  assert.doesNotMatch(modal, /signupUrl|clipboard|writeText/);
});

test('(1) only a shop owner, company_admin or admin membership may send the clinic owner invite', async () => {
  for (const role of ['fse', 'technician', 'dispatcher', 'service_manager', 'crm', 'billing_manager', null]) {
    const result = await postInvite({ membershipRole: role, profileRole: 'company_admin' });
    assert.equal(result.status, 403, String(role));
    assert.equal(result.body.code, 'not_shop_admin', String(role));
    assert.equal(result.rpcCalls.length, 0, String(role));
    assert.equal(result.sent.length, 0, String(role));
  }
  for (const role of ['owner', 'company_admin', 'admin']) {
    const result = await postInvite({ membershipRole: role, profileRole: 'fse' });
    assert.equal(result.status, 200, role);
    assert.equal(result.sent.length, 1, role);
  }
  const lookupFailed = await postInvite({ membershipError: { message: 'timeout' } });
  assert.equal(lookupFailed.status, 503);
  assert.equal(lookupFailed.sent.length, 0);
});

test('database refusals of the invite send nothing and keep their code', async () => {
  const cases: Array<[string, number]> = [
    ['confirm_required', 409],
    ['email_of_record_differs', 409],
    ['owner_exists', 409],
    ['email_not_on_clinic', 409],
    ['not_shop_admin', 403],
    ['not_linked', 403],
    ['rate_limited', 429],
  ];
  for (const [code, status] of cases) {
    const result = await postInvite({ rpcReply: () => ({ data: { ok: false, code }, error: null }) });
    assert.equal(result.status, status, code);
    assert.equal(result.body.code, code, code);
    assert.equal(result.body.emailed, false, code);
    assert.equal(result.sent.length, 0, code);
  }
  const broken = await postInvite({ rpcReply: () => ({ data: null, error: { message: 'boom' } }) });
  assert.equal(broken.status, 503);
  assert.equal(broken.sent.length, 0);
});

test('confirm_out_of_band is passed only when exactly true', async () => {
  const confirmed = await postInvite({ body: { confirm_out_of_band: true } });
  assert.equal(confirmed.rpcCalls[0].args.p_confirmed_out_of_band, true);
  const truthy = await postInvite({ body: { confirm_out_of_band: 'yes' } });
  assert.equal(truthy.rpcCalls[0].args.p_confirmed_out_of_band, false);
});

test('without email delivery no invite row is issued', async () => {
  const result = await postInvite({ resendKey: null });
  assert.equal(result.body.skipped, 'not_configured');
  assert.equal(result.rpcCalls.length, 0);
});

test('role helpers: anyone on a service company may add customers, only admins may invite the owner', () => {
  assert.deepEqual([...CLINIC_OWNER_INVITE_ROLES], ['owner', 'company_admin', 'admin']);
  assert.equal(canAddCustomers('fse', 'service_company'), true);
  assert.equal(canSendClinicOwnerInvite('fse', 'service_company'), false);
  assert.equal(canSendClinicOwnerInvite('company_admin', 'service_company'), true);
  assert.equal(canSendClinicOwnerInvite('owner', 'service_company'), true);
  assert.equal(canSendClinicOwnerInvite('admin', 'service'), true);
  assert.equal(canSendClinicOwnerInvite('owner', 'customer'), false);
  assert.equal(canSendClinicOwnerInvite('company_admin', 'parts_supplier'), false);
});

test('000924 migration: lock_timeout first, definer functions, service_role writes revoked, exact rollback', () => {
  const dir = join(here, '../supabase/migrations');
  const name = '20261017_000924_clinic_claim_hardening.sql';
  const sql = readFileSync(join(dir, name), 'utf8');
  const rollback = readFileSync(join(dir, name.replace(/\.sql$/, '_rollback.sql')), 'utf8');
  const strip = (text: string) => text.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  const code = strip(sql);
  const rb = strip(rollback);
  assert.equal(code.trim().split(';')[0].trim(), "SET LOCAL lock_timeout = '5s'");
  assert.equal(rb.trim().split(';')[0].trim(), "SET LOCAL lock_timeout = '5s'");
  for (const text of [code, rb]) {
    assert.doesNotMatch(text, /\bCOMMIT\b|\bCONCURRENTLY\b/i);
    assert.doesNotMatch(text, /pg_catalog\.(coalesce|extract)\b/i);
  }
  const functions = [...code.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(functions.sort(), [
    'claim_clinic_owner_invite',
    'clinic_shop_staff_now_or_recent',
    'guard_clinic_owner_membership',
    'log_membership_departure',
    'record_departure_emails_on_account_delete',
    'void_clinic_owner_invite_on_owner_removal',
  ]);
  for (const fn of functions) {
    const body = code.slice(code.indexOf(`FUNCTION public.${fn}(`));
    const header = body.slice(0, body.indexOf('AS $function$'));
    assert.match(header, /SECURITY DEFINER/, fn);
    assert.match(header, /SET search_path = ''/, fn);
  }
  // New functions are dropped; replaced ones get their exact 000923 body back.
  for (const fn of ['record_departure_emails_on_account_delete', 'void_clinic_owner_invite_on_owner_removal']) {
    assert.match(code, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(\\) FROM PUBLIC, anon, authenticated`), fn);
    assert.match(rb, new RegExp(`DROP FUNCTION IF EXISTS public\\.${fn}\\(\\)`), fn);
  }
  const m923 = readFileSync(join(dir, '20261017_000923_clinic_claim_invite_binding.sql'), 'utf8');
  const block = (text: string, fn: string) => {
    const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    const end = text.indexOf('$function$;', text.indexOf('AS $function$', start)) + '$function$;'.length;
    return text.slice(start, end);
  };
  for (const fn of ['claim_clinic_owner_invite', 'clinic_shop_staff_now_or_recent', 'guard_clinic_owner_membership', 'log_membership_departure']) {
    assert.equal(block(rollback, fn), block(m923, fn), `${fn} rollback body is the 000923 body`);
    assert.notEqual(block(sql, fn), block(m923, fn), `${fn} is changed by 000924`);
  }
  assert.match(code, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON TABLE public\.clinic_owner_invites,\s+public\.clinic_reach_email_changes, public\.organization_membership_departures\s+FROM service_role/);
  assert.match(rb, /GRANT INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON TABLE public\.clinic_owner_invites,\s+public\.clinic_reach_email_changes, public\.organization_membership_departures\s+TO service_role/);
  assert.doesNotMatch(code, /clinic_claim_emails[^;]*FROM service_role/);
  assert.match(code, /ADD COLUMN IF NOT EXISTS email text/);
  assert.match(rb, /DROP COLUMN IF EXISTS email/);
  assert.match(code, /CREATE TRIGGER trg_record_departure_emails_on_account_delete\s+BEFORE DELETE ON auth\.users/);
  assert.match(rb, /DROP TRIGGER IF EXISTS trg_record_departure_emails_on_account_delete ON auth\.users/);
  assert.match(rb, /DROP TRIGGER IF EXISTS trg_void_clinic_owner_invite_on_owner_removal ON public\.organization_memberships/);
  // L-1 lock order in the claim: clinic row, advisory lock, then the invite row.
  const claim = block(sql, 'claim_clinic_owner_invite');
  const orgLock = claim.indexOf('FROM public.organizations o WHERE o.id = v_org_id FOR UPDATE');
  const adv = claim.indexOf('pg_advisory_xact_lock');
  const invLock = claim.indexOf('FROM public.clinic_owner_invites i WHERE i.id = p_invite_id FOR UPDATE');
  assert.ok(orgLock > 0 && orgLock < adv && adv < invLock);
});

test('000923 migration: lock_timeout first, SECURITY DEFINER with empty search_path, anon denied, exact rollback', () => {
  const dir = join(here, '../supabase/migrations');
  const name = '20261017_000923_clinic_claim_invite_binding.sql';
  const sql = readFileSync(join(dir, name), 'utf8');
  const rollback = readFileSync(join(dir, name.replace(/\.sql$/, '_rollback.sql')), 'utf8');
  const code = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  assert.equal(code.trim().split(';')[0].trim(), "SET LOCAL lock_timeout = '5s'");
  assert.equal(rollback.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim().split(';')[0].trim(), "SET LOCAL lock_timeout = '5s'");
  assert.doesNotMatch(code, /\bCOMMIT\b|\bCONCURRENTLY\b/i);
  assert.doesNotMatch(code, /pg_catalog\.(coalesce|extract)\b/i);
  const functions = [...code.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([^)]*)\)/g)].map((m) => m[1]);
  assert.equal(functions.length, 10);
  for (const fn of functions) {
    const body = code.slice(code.indexOf(`FUNCTION public.${fn}(`));
    const header = body.slice(0, body.indexOf('AS $function$'));
    assert.match(header, /SECURITY DEFINER/, fn);
    assert.match(header, /SET search_path = ''/, fn);
    assert.match(code, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon`), fn);
    assert.match(rollback, new RegExp(`DROP FUNCTION IF EXISTS public\\.${fn}\\(`), fn);
  }
  for (const table of ['clinic_owner_invites', 'clinic_claim_emails', 'clinic_reach_email_changes', 'organization_membership_departures']) {
    assert.match(code, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`), table);
    assert.match(code, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`), table);
    assert.match(rollback, new RegExp(`DROP TABLE IF EXISTS public\\.${table};`), table);
  }
  for (const trigger of [...code.matchAll(/CREATE TRIGGER (\w+)\s+\w+ [^;]* ON (public\.\w+)/g)]) {
    assert.match(rollback, new RegExp(`DROP TRIGGER IF EXISTS ${trigger[1]} ON ${trigger[2].replace('.', '\\.')}`), trigger[1]);
  }
  assert.match(code, /GRANT EXECUTE ON FUNCTION public\.issue_clinic_owner_invite\(bigint, bigint, text, boolean\) TO authenticated, service_role/);
  assert.match(code, /REVOKE ALL ON FUNCTION public\.claim_clinic_owner_invite\(uuid, uuid, text, text\) FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(code, /GRANT [^;]*claim_clinic_owner_invite[^;]*authenticated/);
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

const CLAIM_SIGNUP_META = {
  signup_kind: 'owner',
  signup_type: 'claim',
  role: 'owner',
  organization_type: 'customer',
  company: 'QA TEST 238 Clinic 1026',
  facility: 'QA TEST 238 Clinic 1026',
  claim_token: 'live-token',
  facility_type: 'Clinic',
  phone: '555',
  address: '1 Main',
  city: 'Ventura',
  state: 'CA',
  preferred_services: 'PM',
  job_title: 'Owner',
  first_name: 'QATEST238',
  last_name: 'ClinicD',
};

test('a failed claim clears claim-signup metadata and a successful claim does not', async () => {
  const refused = await postClaim({
    userId: 'claimer',
    email: 'claimer@clinic.test',
    inviteEmail: 'other@clinic.test',
    userMetadata: CLAIM_SIGNUP_META,
  });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.claimed, false);
  assert.equal(refused.metadataClears.length, 1);
  assert.equal(refused.metadataClears[0].userId, 'claimer');
  for (const key of CLAIM_SIGNUP_METADATA_KEYS) {
    assert.equal(refused.metadataClears[0].patch[key], null, key);
  }
  assert.equal('first_name' in refused.metadataClears[0].patch, false);

  const invalid = await postClaim({
    userId: 'claimer',
    email: 'claimer@clinic.test',
    token: 'not-a-claim-token',
    userMetadata: CLAIM_SIGNUP_META,
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.metadataClears.length, 1);

  const taken = await postClaim({
    userId: 'claimer',
    email: 'claimer@clinic.test',
    userMetadata: CLAIM_SIGNUP_META,
    rpcReply: () => ({ data: { ok: false, code: 'owner_exists' }, error: null }),
  });
  assert.equal(taken.status, 409);
  assert.equal(taken.metadataClears.length, 1);

  const company = await postClaim({
    userId: 'founder',
    email: 'founder@shop.test',
    inviteEmail: 'other@clinic.test',
    userMetadata: {
      signup_kind: 'company',
      role: 'company_admin',
      organization_type: 'service_company',
      company: 'QA TEST 245 Founder 1210',
    },
  });
  assert.equal(company.status, 403);
  assert.equal(company.metadataClears.length, 0);

  const claimed = await postClaim({ userId: 'claimer', email: 'claimer@clinic.test', userMetadata: CLAIM_SIGNUP_META });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.claimed, true);
  assert.equal(claimed.metadataClears.length, 0);
  assert.equal(String(claimed.body.organizationId), String(CLINIC_ID));
  assert.equal(claimed.rpcCalls[0].args.p_first_name, 'QATEST238');
});

test('a bad or expired clinic claim token is a code, not the token text', async () => {
  process.env.CUSTOMER_INVITE_SECRET = 'invite-test-secret';
  const expiredToken = signCustomerInvite(
    { orgId: String(CLINIC_ID), email: 'a@b.co', name: 'North Clinic', inv: INVITE_ID },
    -30
  );
  const expired = await postClaim({ userId: 'new-user', email: 'a@b.co', token: expiredToken });
  assert.equal(expired.status, 400);
  assert.equal(expired.body.code, 'token_expired');
  assert.equal(JSON.stringify(expired.body).includes(expiredToken), false);

  const invalid = await postClaim({ userId: 'new-user', email: 'a@b.co', token: 'not-a-token<script>' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, 'token_invalid');
  assert.equal(JSON.stringify(invalid.body).includes('<script>'), false);
});
