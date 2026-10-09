import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUTH_EMAIL_LOOKUP_MAX_PAGES,
  AUTH_EMAIL_LOOKUP_PAGE_SIZE,
  findAuthUserByEmail,
  type AuthEmailLookup,
  type AuthEmailLookupClient,
  type AuthUserRow,
} from './team-profile.ts';
import { teamInviteSentMessage } from './team-invite.ts';
import { INVITABLE_TEAM_ROLES, isInvitableTeamRole, isPendingTeamInvite } from './org-membership.ts';
import { TEAM_INVITE_TTL_MS } from './team-invite-guard.ts';
import { NextRequest } from 'next/server';
import { runTeamInvite } from '../app/api/team/invite/route.ts';
import { runTeamClaim } from '../app/api/team/claim/route.ts';
import {
  decideInviteSetupResend,
  decideTeamInviteAudience,
  existingUserInviteDeliveryError,
  newUserLinkFailureMode,
  nextSetupLinkType,
  sealInviteResponse,
  teamInviteClosedBody,
  teamInviteMayMintActionLink,
  teamInvitePublicBody,
} from './team-invite-flow.ts';

const here = dirname(fileURLToPath(import.meta.url));

function assertNoCredential(body: unknown) {
  const text = JSON.stringify(body);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'inviteUrl'), false);
  assert.doesNotMatch(text, /action_link/);
  assert.doesNotMatch(text, /recovery/);
  assert.doesNotMatch(text, /magiclink/);
  assert.doesNotMatch(text, /\/auth\/v1\/verify/);
  assert.doesNotMatch(text, /hashed_token/);
  assert.doesNotMatch(text, /email_otp/);
  assert.doesNotMatch(text, /inviteUrl/);
}

function listUsersBomb(): AuthEmailLookupClient['auth'] {
  return {
    admin: {
      listUsers() {
        throw new Error('listUsers must not be used to decide an invite');
      },
    },
  } as AuthEmailLookupClient['auth'];
}

test('existing user with onboarding not done gets no recovery link in the response', () => {
  const audience = decideTeamInviteAudience({
    auth: {
      status: 'found',
      user: {
        id: 'user-1',
        email: 'person@example.com',
        last_sign_in_at: '2026-05-01T00:00:00.000Z',
      },
    },
    profile: 'found',
    onboardingCompleted: false,
    lastSignInAt: '2026-05-01T00:00:00.000Z',
  });
  assert.equal(audience, 'existing');
  assert.equal(teamInviteMayMintActionLink(audience), false);

  const neverSignedIn = decideTeamInviteAudience({
    auth: {
      status: 'found',
      user: { id: 'user-1', email: 'person@example.com', last_sign_in_at: null },
    },
    profile: 'found',
    onboardingCompleted: false,
    lastSignInAt: null,
  });
  assert.equal(neverSignedIn, 'existing');
  assert.equal(teamInviteMayMintActionLink(neverSignedIn), false);

  const body = teamInvitePublicBody({
    email: 'person@example.com',
    emailed: true,
    alreadyRegistered: true,
  });
  assertNoCredential(body);
  assert.match(String(body.message), /^Invite sent to person@example.com\./);
  assert.equal(body.ok, true);
  assert.equal(body.emailed, true);
});

test('a lookup miss or error fails closed with no link', () => {
  const cases: AuthEmailLookup[] = [{ status: 'error' }, { status: 'ambiguous' }];
  for (const auth of cases) {
    const audience = decideTeamInviteAudience({
      auth,
      profile: 'not_found',
      onboardingCompleted: false,
      lastSignInAt: null,
    });
    assert.equal(audience, 'closed');
    assert.equal(teamInviteMayMintActionLink(audience), false);
  }

  const profileKnownButLookupFailed = decideTeamInviteAudience({
    auth: { status: 'error' },
    profile: 'found',
    onboardingCompleted: false,
    lastSignInAt: null,
  });
  assert.equal(profileKnownButLookupFailed, 'closed');

  const closed = teamInviteClosedBody();
  assert.equal(closed.status, 503);
  assert.equal(closed.body.ok, false);
  assertNoCredential(closed.body);
  assert.match(String(closed.body.error), /No invite link was created/);
});

test('a confirmed new user still does not get an action link in the response', () => {
  const audience = decideTeamInviteAudience({
    auth: { status: 'not_found' },
    profile: 'not_found',
    onboardingCompleted: false,
    lastSignInAt: null,
  });
  assert.equal(audience, 'new');
  assert.equal(teamInviteMayMintActionLink(audience), true);

  const secret = 'https://example.test/auth/v1/verify?token=example&type=invite';
  const body = teamInvitePublicBody({
    email: 'new.person@example.com',
    emailed: true,
    alreadyRegistered: false,
  });
  assertNoCredential(body);
  assert.equal(JSON.stringify(body).includes(secret), false);
  assert.match(String(body.message), /^Invite sent to new\.person@example\.com\./);
  assert.equal(newUserLinkFailureMode('A user with this email address has already been registered'), 'existing');
  assert.equal(newUserLinkFailureMode('rate limit'), 'error');
});

test('sealInviteResponse strips action links and recovery fields', () => {
  const sealed = sealInviteResponse({
    ok: true,
    message: 'Invite sent to person@example.com.',
    inviteUrl: 'https://example.test/auth/v1/verify?type=recovery&token=example',
    action_link: 'https://example.test/auth/v1/verify?type=invite&token=example',
    signupUrl: 'https://example.test/login',
    properties: { action_link: 'https://example.test/auth/v1/verify?type=magiclink', verification_type: 'recovery' },
    warning: 'provider echoed https://example.test/auth/v1/verify?type=recovery',
    emailed: true,
  });
  assert.deepEqual(sealed, {
    ok: true,
    message: 'Invite sent to person@example.com.',
    emailed: true,
  });
  assertNoCredential(sealed);
});

test('a user past the first 2000 auth rows is found by exact email', async () => {
  const target = {
    id: 'user-2001',
    email: 'past.limit@example.com',
    last_sign_in_at: '2026-04-01T00:00:00.000Z',
  };
  const firstTwoThousand: AuthUserRow[] = Array.from({ length: 2000 }, (_, i) => ({
    id: `user-${i}`,
    email: `user-${i}@example.com`,
  }));
  assert.equal(
    firstTwoThousand.some((row) => row.email === target.email),
    false
  );

  let listed = 0;
  const admin: AuthEmailLookupClient = {
    auth: {
      admin: {
        listUsers() {
          listed += 1;
          return { data: { users: firstTwoThousand.slice(0, 200) }, error: null };
        },
      },
    } as AuthEmailLookupClient['auth'],
    schema(name: string) {
      assert.equal(name, 'auth');
      return {
        from(table: string) {
          assert.equal(table, 'users');
          return {
            select() {
              return {
                eq(column: string, value: string) {
                  assert.equal(column, 'email');
                  assert.equal(value, target.email);
                  return Promise.resolve({ data: [target], error: null });
                },
              };
            },
          };
        },
      };
    },
  };

  const result = await findAuthUserByEmail(admin, 'Past.Limit@example.com', {
    fetchAdminUsers: async () => ({ users: [] }),
  });
  assert.equal(listed, 0);
  assert.equal(result.status, 'found');
  if (result.status === 'found') {
    assert.equal(result.user.id, 'user-2001');
    assert.equal(result.user.email, target.email);
  }
});

test('admin email filter finds an exact user when the table query is unavailable', async () => {
  let listed = 0;
  const admin: AuthEmailLookupClient = {
    auth: {
      admin: {
        listUsers() {
          listed += 1;
          throw new Error('listUsers must not be used');
        },
      },
    } as AuthEmailLookupClient['auth'],
    schema() {
      throw new Error('auth schema unavailable');
    },
  };

  const result = await findAuthUserByEmail(admin, 'past.limit@example.com', {
    fetchAdminUsers: async (email, page, perPage) => {
      assert.equal(email, 'past.limit@example.com');
      assert.equal(perPage, AUTH_EMAIL_LOOKUP_PAGE_SIZE);
      if (page === 1) {
        return {
          users: Array.from({ length: perPage }, (_, i) => ({
            id: `noise-${i}`,
            email: `past.limit@example.com.other${i}`,
          })),
        };
      }
      return {
        users: [
          {
            id: 'user-2001',
            email: 'past.limit@example.com',
            last_sign_in_at: '2026-04-01T00:00:00.000Z',
          },
        ],
      };
    },
  });

  assert.equal(listed, 0);
  assert.equal(result.status, 'found');
  if (result.status === 'found') assert.equal(result.user.id, 'user-2001');
});

test('an unfinished or failed email lookup is an error, not a new user', async () => {
  const admin: AuthEmailLookupClient = {
    auth: listUsersBomb(),
    schema() {
      return {
        from() {
          return {
            select() {
              return {
                eq: () => Promise.resolve({ data: [], error: null }),
              };
            },
          };
        },
      };
    },
  };

  const errored = await findAuthUserByEmail(admin, 'person@example.com', {
    fetchAdminUsers: async () => {
      throw new Error('admin users lookup failed (500)');
    },
  });
  assert.equal(errored.status, 'error');
  assert.equal(
    decideTeamInviteAudience({ auth: errored, profile: 'not_found', onboardingCompleted: false }),
    'closed'
  );

  const unfinished = await findAuthUserByEmail(
    { auth: listUsersBomb() },
    'person@example.com',
    {
      fetchAdminUsers: async (_email, _page, perPage) => ({
        users: Array.from({ length: perPage }, (_, i) => ({
          id: `noise-${i}`,
          email: `other-${i}@example.com`,
        })),
      }),
    }
  );
  assert.equal(unfinished.status, 'error');
  assert.ok(AUTH_EMAIL_LOOKUP_MAX_PAGES >= 1);

  const ambiguous = await findAuthUserByEmail(
    {
      auth: listUsersBomb(),
      schema() {
        return {
          from() {
            return {
              select() {
                return {
                  eq: () =>
                    Promise.resolve({
                      data: [
                        { id: 'a', email: 'person@example.com' },
                        { id: 'b', email: 'person@example.com' },
                      ],
                      error: null,
                    }),
                };
              },
            };
          },
        };
      },
    },
    'person@example.com',
    { fetchAdminUsers: null }
  );
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(decideTeamInviteAudience({ auth: ambiguous, profile: 'found' }), 'closed');
  assert.equal(teamInviteMayMintActionLink('closed'), false);
});

test('getUserByEmail finds the account without paging listUsers', async () => {
  let listed = 0;
  const admin: AuthEmailLookupClient = {
    auth: {
      admin: {
        listUsers() {
          listed += 1;
          return { data: { users: [] }, error: null };
        },
        async getUserByEmail(email: string) {
          assert.equal(email, 'past.limit@example.com');
          return {
            data: {
              user: {
                id: 'user-2001',
                email,
                last_sign_in_at: '2026-04-01T00:00:00.000Z',
              },
            },
            error: null,
          };
        },
      },
    } as AuthEmailLookupClient['auth'],
  };

  const result = await findAuthUserByEmail(admin, 'past.limit@example.com', {
    fetchAdminUsers: null,
  });
  assert.equal(listed, 0);
  assert.equal(result.status, 'found');
  if (result.status === 'found') assert.equal(result.user.id, 'user-2001');
});

test('invite responses and the team UI never hand the inviter a recovery link', () => {
  const route = readFileSync(join(here, '../app/api/team/invite/route.ts'), 'utf8');
  assert.doesNotMatch(route, /recovery/);
  assert.doesNotMatch(route, /inviteUrl/);
  assert.doesNotMatch(route, /listUsers/);
  assert.doesNotMatch(route, /teamInviteNeedsPasswordSetup/);
  assert.match(route, /type: 'invite'/);
  assert.match(route, /to: \[email\]/);
  assert.match(route, /sealInviteResponse/);
  assert.match(route, /decideTeamInviteAudience/);
  const respondArgs = route.split('respond(').slice(1).map((part) => part.slice(0, part.indexOf(')')));
  assert.ok(respondArgs.length >= 1);
  for (const args of respondArgs) {
    assert.doesNotMatch(args, /actionLink|acceptUrl|action_link|inviteUrl/);
  }

  for (const rel of ['../app/admin/team/page.tsx', '../app/company/page.tsx']) {
    const page = readFileSync(join(here, rel), 'utf8');
    assert.doesNotMatch(page, /inviteUrl/);
    assert.doesNotMatch(page, /clipboard/);
    assert.doesNotMatch(page, /writeText/);
    assert.doesNotMatch(page, /Copy invite link/);
    assert.match(page, /teamInviteSentMessage/);
  }
  assert.equal(teamInviteSentMessage('person@example.com'), 'Invite sent to person@example.com.');
});

const SETUP_LINK = 'https://example.test/auth/v1/verify?token=example&type=invite';
const FOLLOWUP_LINK = 'https://example.test/auth/v1/verify?token=example&type=recovery';
const INVITEE = 'new.person@example.com';

test('setup link types try invite, then the fallback type', () => {
  assert.equal(nextSetupLinkType(null), 'invite');
  assert.equal(nextSetupLinkType('invite'), 'recovery');
  assert.equal(nextSetupLinkType('recovery'), null);
  const blocked = existingUserInviteDeliveryError(INVITEE, 'unconfigured');
  assert.equal(blocked.ok, false);
  assert.match(String(blocked.error), /No link was created/);
  assertNoCredential(blocked);
});

test('a pending invite-created account gets a setup link only when it has never signed in', () => {
  const pending = {
    accepted: false,
    expires_at: '2026-10-16T00:00:00.000Z',
    created_at: '2026-10-08T00:00:00.000Z',
    createdAuthUserId: 'auth-1',
  };
  const now = Date.parse('2026-10-09T12:00:00.000Z');
  assert.equal(
    decideInviteSetupResend({
      authStatus: 'found',
      authUserId: 'auth-1',
      lastSignInAt: null,
      invite: pending,
      now,
    }),
    'setup'
  );
  assert.equal(
    decideInviteSetupResend({
      authStatus: 'found',
      authUserId: 'auth-1',
      lastSignInAt: '2026-10-09T00:00:00.000Z',
      invite: pending,
      now,
    }),
    'sign-in'
  );
  assert.equal(
    decideInviteSetupResend({
      authStatus: 'found',
      authUserId: 'someone-else',
      lastSignInAt: null,
      invite: pending,
      now,
    }),
    'sign-in'
  );
  assert.equal(
    decideInviteSetupResend({
      authStatus: 'found',
      authUserId: 'auth-1',
      lastSignInAt: null,
      invite: { ...pending, createdAuthUserId: null },
      now,
    }),
    'sign-in'
  );
  assert.equal(
    decideInviteSetupResend({
      authStatus: 'found',
      authUserId: 'auth-1',
      lastSignInAt: null,
      invite: { ...pending, accepted: true },
      now,
    }),
    'sign-in'
  );
  assert.equal(
    decideInviteSetupResend({
      authStatus: 'error',
      authUserId: 'auth-1',
      lastSignInAt: null,
      invite: pending,
      now,
    }),
    'closed'
  );
  assert.equal(
    decideInviteSetupResend({
      authStatus: 'found',
      authUserId: 'auth-1',
      lastSignInAt: undefined,
      invite: pending,
      now,
    }),
    'sign-in'
  );
});

type SentMail = { to: string[]; html: string; text: string; subject: string };

function inviteAdmin(state: {
  invite: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
  linkHandler?: (args: { type?: string }) => {
    data?: { user?: { id?: string }; properties?: { action_link?: string } } | null;
    error?: { message?: string } | null;
  };
}) {
  const linkCalls: Array<{ type?: string }> = [];
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const admin = {
    from(table: string) {
      let selected = '';
      const api = {
        select(columns: string) {
          selected = columns;
          return api;
        },
        eq() {
          return api;
        },
        maybeSingle: async () => {
          if (table === 'organizations') {
            return { data: { id: 9, name: 'North Shop', type: 'service_company', services_offered: null }, error: null };
          }
          if (table === 'user_profiles') {
            return { data: state.profile ?? null, error: null };
          }
          if (table === 'engineer_invitations') {
            if (state.invite && selected.includes('created_auth_user_id') && state.invite.readError) {
              return { data: null, error: { message: String(state.invite.readError) } };
            }
            return { data: state.invite, error: null };
          }
          return { data: null, error: null };
        },
        insert(row: Record<string, unknown>) {
          inserts.push(row);
          return {
            select() {
              return {
                maybeSingle: async () => ({ data: { id: 7 }, error: null }),
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq() {
              updates.push(patch);
              if (state.invite) Object.assign(state.invite, patch);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
      return api;
    },
    auth: {
      admin: {
        generateLink: async (args: { type?: string }) => {
          linkCalls.push(args);
          if (state.linkHandler) return state.linkHandler(args);
          return {
            data: { user: { id: 'auth-1' }, properties: { action_link: SETUP_LINK } },
            error: null,
          };
        },
      },
    },
  };
  return { admin, linkCalls, updates, inserts };
}

async function postExistingInvite(opts: {
  resendKey: string | null;
  auth:
    | { status: 'found'; id: string; lastSignInAt: string | null }
    | { status: 'error' }
    | { status: 'not_found' };
  invite: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
  role?: string;
  linkHandler?: (args: { type?: string }) => {
    data?: { user?: { id?: string }; properties?: { action_link?: string } } | null;
    error?: { message?: string } | null;
  };
  sendOk?: boolean;
}) {
  const previous = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-value';
  const sent: SentMail[] = [];
  const logs: string[] = [];
  const originals = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const capture = (...args: unknown[]) => {
    logs.push(args.map((part) => String(part)).join(' '));
  };
  console.log = capture;
  console.info = capture;
  console.warn = capture;
  console.error = capture;
  const harness = inviteAdmin({
    invite: opts.invite,
    profile: opts.profile,
    linkHandler: opts.linkHandler,
  });
  try {
    const response = await runTeamInvite(
      new NextRequest('http://127.0.0.1/api/team/invite', {
        method: 'POST',
        headers: {
          authorization: 'Bearer session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email: INVITEE, role: opts.role || 'fse', resend: true }),
      }),
      {
        hasServiceRole: () => true,
        resendKey: opts.resendKey,
        getAdmin: () => harness.admin as never,
        findAuthUser: async () => {
          if (opts.auth.status === 'error') return { status: 'error' as const };
          if (opts.auth.status === 'not_found') return { status: 'not_found' as const };
          return {
            status: 'found' as const,
            user: { id: opts.auth.id, email: INVITEE, last_sign_in_at: opts.auth.lastSignInAt },
          };
        },
        createUserClient: () => ({
          auth: {
            getUser: async () => ({
              data: { user: { id: 'admin-user', email: 'admin@shop.test' } },
              error: null,
            }),
          },
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { organization_id: 9, role: 'company_admin' },
                  error: null,
                }),
              }),
            }),
          }),
        }),
        sendEmail: async (input) => {
          sent.push({ to: input.to, html: input.html, text: input.text, subject: input.subject });
          if (opts.sendOk === false) return { ok: false, status: 500, message: 'provider down' };
          return { ok: true, status: 200 };
        },
      }
    );
    const body = (await response.json()) as Record<string, unknown>;
    return {
      status: response.status,
      body,
      sent,
      logs,
      linkCalls: harness.linkCalls,
      updates: harness.updates,
      inserts: harness.inserts,
    };
  } finally {
    console.log = originals.log;
    console.info = originals.info;
    console.warn = originals.warn;
    console.error = originals.error;
    if (previous.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous.url;
    if (previous.anon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previous.anon;
  }
}

const pendingCreated = {
  id: 7,
  email: INVITEE,
  organization_id: 9,
  accepted: false,
  expires_at: '2026-10-16T00:00:00.000Z',
  created_at: '2026-10-08T00:00:00.000Z',
  created_auth_user_id: 'auth-1',
  first_name: 'New',
  last_name: 'Person',
};

function assertNoLink(result: { body: Record<string, unknown>; logs: string[] }, link: string) {
  assertNoCredential(result.body);
  assert.equal(JSON.stringify(result.body).includes(link), false);
  assert.equal(result.logs.some((line) => line.includes(link) || line.includes('/auth/v1/verify')), false);
}

test('resend to a pending invite-created user emails a set-password link and hides it', async () => {
  const result = await postExistingInvite({
    resendKey: 'resend-test',
    auth: { status: 'found', id: 'auth-1', lastSignInAt: null },
    invite: { ...pendingCreated },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.emailed, true);
  assert.equal(result.linkCalls.length, 1);
  assert.equal(result.linkCalls[0].type, 'invite');
  assert.equal(result.sent.length, 1);
  assert.deepEqual(result.sent[0].to, [INVITEE]);
  assert.match(result.sent[0].html, /set password/i);
  assert.ok(result.sent[0].html.includes(SETUP_LINK) || result.sent[0].text.includes(SETUP_LINK));
  assertNoLink(result, SETUP_LINK);
  assert.equal(
    result.updates.some((patch) => patch.created_auth_user_id && patch.created_auth_user_id !== 'auth-1'),
    false
  );
});

test('resend falls forward when invite cannot be reissued, still without returning the link', async () => {
  const result = await postExistingInvite({
    resendKey: 'resend-test',
    auth: { status: 'found', id: 'auth-1', lastSignInAt: null },
    invite: { ...pendingCreated },
    linkHandler: (args) => {
      if (args.type === 'invite') return { data: null, error: { message: 'already been registered' } };
      return { data: { user: { id: 'auth-1' }, properties: { action_link: FOLLOWUP_LINK } }, error: null };
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.emailed, true);
  assert.deepEqual(
    result.linkCalls.map((call) => call.type),
    ['invite', 'recovery']
  );
  assert.equal(result.sent.length, 1);
  assert.deepEqual(result.sent[0].to, [INVITEE]);
  assert.ok(result.sent[0].html.includes(FOLLOWUP_LINK) || result.sent[0].text.includes(FOLLOWUP_LINK));
  assertNoLink(result, FOLLOWUP_LINK);
  assertNoLink(result, SETUP_LINK);
});

test('a pending invite-created user who has signed in gets the sign-in email only', async () => {
  const result = await postExistingInvite({
    resendKey: 'resend-test',
    auth: { status: 'found', id: 'auth-1', lastSignInAt: '2026-10-09T00:00:00.000Z' },
    invite: { ...pendingCreated },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.emailed, true);
  assert.equal(result.linkCalls.length, 0);
  assert.equal(result.sent.length, 1);
  assert.match(result.sent[0].html, /Sign in/);
  assert.doesNotMatch(result.sent[0].html, /\/auth\/v1\/verify/);
  assert.doesNotMatch(result.sent[0].text, /\/auth\/v1\/verify/);
  assertNoLink(result, SETUP_LINK);
});

test('an account not created by the invite gets the sign-in email only', async () => {
  const result = await postExistingInvite({
    resendKey: 'resend-test',
    auth: { status: 'found', id: 'auth-1', lastSignInAt: null },
    invite: { ...pendingCreated, created_auth_user_id: null },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.emailed, true);
  assert.equal(result.linkCalls.length, 0);
  assert.match(result.sent[0].html, /Sign in/);
  assert.doesNotMatch(`${result.sent[0].html}\n${result.sent[0].text}`, /\/auth\/v1\/verify/);
  assertNoLink(result, SETUP_LINK);
});

test('a lookup or proof failure does not mint a setup link', async () => {
  const lookup = await postExistingInvite({
    resendKey: 'resend-test',
    auth: { status: 'error' },
    invite: { ...pendingCreated },
  });
  assert.equal(lookup.status, 503);
  assert.equal(lookup.body.ok, false);
  assert.equal(lookup.linkCalls.length, 0);
  assert.equal(lookup.sent.length, 0);
  assertNoLink(lookup, SETUP_LINK);

  const proof = await postExistingInvite({
    resendKey: 'resend-test',
    auth: { status: 'found', id: 'auth-1', lastSignInAt: null },
    invite: { ...pendingCreated, readError: 'connection reset' },
  });
  assert.equal(proof.status, 200);
  assert.equal(proof.body.emailed, true);
  assert.equal(proof.linkCalls.length, 0);
  assert.match(proof.sent[0].html, /Sign in/);
  assert.doesNotMatch(proof.sent[0].html, /\/auth\/v1\/verify/);
  assertNoLink(proof, SETUP_LINK);
});

const memberHere = {
  id: 'auth-1',
  email: INVITEE,
  organization_id: 9,
  role: 'fse',
  onboarding_completed: true,
  first_name: 'New',
};

test('resend to an existing member whose invite is accepted keeps accepted_at and sends a sign-in email', async () => {
  const acceptedAt = '2026-10-01T12:00:00.000Z';
  const expiresAt = '2026-10-08T12:00:00.000Z';
  const invite = {
    ...pendingCreated,
    accepted: true,
    accepted_at: acceptedAt,
    expires_at: expiresAt,
  };
  const result = await postExistingInvite({
    resendKey: 'resend-test',
    auth: { status: 'found', id: 'auth-1', lastSignInAt: null },
    invite,
    profile: memberHere,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.emailed, true);
  assert.equal(result.linkCalls.length, 0);
  assert.equal(result.sent.length, 1);
  assert.deepEqual(result.sent[0].to, [INVITEE]);
  assert.match(result.sent[0].html, /Sign in/);
  assert.doesNotMatch(`${result.sent[0].html}\n${result.sent[0].text}`, /\/auth\/v1\/verify/);
  assert.equal(invite.accepted, true);
  assert.equal(invite.accepted_at, acceptedAt);
  assert.equal(invite.expires_at, expiresAt);
  const restore = result.updates.find((patch) => patch.accepted === true);
  assert.ok(restore);
  assert.equal(restore?.accepted_at, acceptedAt);
  assert.equal('expires_at' in (restore || {}), false);
  assert.equal(isPendingTeamInvite(invite), false);
  assertNoLink(result, SETUP_LINK);
});

test('resend to an existing member whose invite is not accepted marks it accepted and sends the sign-in email only', async () => {
  const expiresAt = '2026-10-16T00:00:00.000Z';
  const invite = {
    ...pendingCreated,
    accepted: false,
    accepted_at: null,
    expires_at: expiresAt,
  };
  const before = Date.now();
  const result = await postExistingInvite({
    resendKey: 'resend-test',
    auth: { status: 'found', id: 'auth-1', lastSignInAt: null },
    invite,
    profile: memberHere,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.emailed, true);
  assert.equal(result.linkCalls.length, 0);
  assert.equal(result.sent.length, 1);
  assert.match(result.sent[0].html, /Sign in/);
  assert.doesNotMatch(`${result.sent[0].html}\n${result.sent[0].text}`, /\/auth\/v1\/verify/);
  assert.equal(invite.accepted, true);
  assert.equal(typeof invite.accepted_at, 'string');
  assert.ok(Date.parse(String(invite.accepted_at)) >= before);
  assert.equal(invite.expires_at, expiresAt);
  assert.equal(
    result.updates.some((patch) => 'expires_at' in patch),
    false
  );
  assert.equal(isPendingTeamInvite(invite), false);
  assertNoLink(result, SETUP_LINK);
});

test('resend to a removed member reopens the invite and sends the sign-in email only', async () => {
  const acceptedAt = '2026-10-01T12:00:00.000Z';
  const expiresAt = '2026-10-08T12:00:00.000Z';
  for (const organizationId of [null, 4]) {
    const invite = {
      ...pendingCreated,
      accepted: true,
      accepted_at: acceptedAt,
      expires_at: expiresAt,
    };
    const result = await postExistingInvite({
      resendKey: 'resend-test',
      auth: { status: 'found', id: 'auth-1', lastSignInAt: '2026-10-02T00:00:00.000Z' },
      invite,
      profile: {
        id: 'auth-1',
        email: INVITEE,
        organization_id: organizationId,
        role: 'fse',
        onboarding_completed: true,
      },
    });
    assert.equal(result.status, 200, `org ${organizationId}`);
    assert.equal(result.body.emailed, true);
    assert.equal(result.linkCalls.length, 0);
    assert.equal(result.sent.length, 1);
    assert.match(result.sent[0].html, /Sign in/);
    assert.doesNotMatch(`${result.sent[0].html}\n${result.sent[0].text}`, /\/auth\/v1\/verify/);
    assert.equal(invite.accepted, false);
    assert.equal(invite.accepted_at, null);
    assert.notEqual(invite.expires_at, expiresAt);
    assert.equal(isPendingTeamInvite(invite), true);
    assertNoLink(result, SETUP_LINK);
  }
});

test('a removed member with no auth account still gets no setup link', async () => {
  const invite = {
    ...pendingCreated,
    accepted: true,
    accepted_at: '2026-10-01T12:00:00.000Z',
  };
  const result = await postExistingInvite({
    resendKey: 'resend-test',
    auth: { status: 'not_found' },
    invite,
    profile: null,
  });
  assert.equal(result.status, 200);
  assert.equal(result.linkCalls.length, 0);
  assert.equal(result.sent.length, 1);
  assert.match(result.sent[0].html, /Sign in/);
  assert.equal(invite.accepted, false);
  assertNoLink(result, SETUP_LINK);
});

test('an existing user with email not configured gets 503 and no link', async () => {
  const result = await postExistingInvite({
    resendKey: null,
    auth: { status: 'found', id: 'auth-1', lastSignInAt: '2026-10-09T00:00:00.000Z' },
    invite: { ...pendingCreated },
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.ok, false);
  assert.match(String(result.body.error), /not configured/i);
  assert.match(String(result.body.error), /No link was created/);
  assert.equal(result.sent.length, 0);
  assert.equal(result.linkCalls.length, 0);
  assertNoLink(result, SETUP_LINK);
  assert.equal(JSON.stringify(result.body).includes('Invite sent'), false);
});

test('an existing user with email configured still gets 200', async () => {
  const result = await postExistingInvite({
    resendKey: 'resend-test',
    auth: { status: 'found', id: 'auth-9', lastSignInAt: '2026-09-01T00:00:00.000Z' },
    invite: { ...pendingCreated, created_auth_user_id: 'auth-9' },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.emailed, true);
  assert.match(String(result.body.message), /^Invite sent to new\.person@example\.com\./);
  assert.equal(result.sent.length, 1);
  assert.deepEqual(result.sent[0].to, [INVITEE]);
  assertNoLink(result, SETUP_LINK);
});

type MembershipRow = {
  user_id: string;
  organization_id: number;
  role: string;
  is_home: boolean;
};

type ProfileRow = {
  id: string;
  email: string;
  organization_id: number | null;
  role: string | null;
  onboarding_completed: boolean;
  first_name?: string | null;
  last_name?: string | null;
};

function claimAdmin(state: {
  invite: Record<string, unknown>;
  memberships: MembershipRow[];
  profiles: ProfileRow[];
}) {
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
          if (op === 'upsert') {
            const idx = state.profiles.findIndex((item) => item.id === payload.id);
            if (idx >= 0) state.profiles[idx] = { ...state.profiles[idx], ...payload } as ProfileRow;
            else state.profiles.push(payload as ProfileRow);
            return { data: null, error: null };
          }
          if (op === 'update') {
            const row = state.profiles.find((item) => item.id === filters.id);
            if (row) Object.assign(row, payload);
            return { data: null, error: null };
          }
          const row =
            state.profiles.find((item) => filters.id == null || item.id === filters.id) || null;
          return { data: row, error: null };
        }
        if (table === 'organizations') {
          return {
            data: { id: filters.id, created_at: '2020-01-01T00:00:00.000Z', created_by: 'other-user' },
            error: null,
          };
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
        then(
          onFulfilled: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) {
          return Promise.resolve(finish(false)).then(onFulfilled, onRejected);
        },
      };
      return api;
    },
  };
}

async function postRejoinClaim(opts: {
  profileOrg: number | null;
  memberships: MembershipRow[];
  invite: Record<string, unknown>;
}) {
  const previous = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-value';
  const state = {
    invite: { ...opts.invite },
    memberships: opts.memberships.map((row) => ({ ...row })),
    profiles: [
      {
        id: 'auth-1',
        email: INVITEE,
        organization_id: opts.profileOrg,
        role: 'fse',
        onboarding_completed: true,
        first_name: 'New',
        last_name: 'Person',
      },
    ] as ProfileRow[],
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
                  email_confirmed_at: '2026-10-01T00:00:00.000Z',
                  user_metadata: { first_name: 'New', last_name: 'Person' },
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
                    role: 'fse',
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

test('a reopened invite lets a removed member rejoin', async () => {
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const baseInvite = {
    id: 7,
    email: INVITEE,
    organization_id: 9,
    role: 'fse',
    accepted: false,
    accepted_at: null,
    expires_at: future,
    created_at: '2026-10-08T00:00:00.000Z',
    first_name: 'New',
    last_name: 'Person',
  };

  const home = await postRejoinClaim({
    profileOrg: null,
    memberships: [],
    invite: baseInvite,
  });
  assert.equal(home.status, 200, JSON.stringify(home.body));
  assert.equal(home.body.claimed, true);
  assert.equal(home.state.invite.accepted, true);
  assert.equal(String(home.state.profiles[0].organization_id), '9');
  assert.equal(
    home.state.memberships.some((row) => row.organization_id === 9 && row.user_id === 'auth-1'),
    true
  );

  const elsewhere = await postRejoinClaim({
    profileOrg: 4,
    memberships: [{ user_id: 'auth-1', organization_id: 4, role: 'fse', is_home: true }],
    invite: baseInvite,
  });
  assert.equal(elsewhere.status, 200, JSON.stringify(elsewhere.body));
  assert.equal(elsewhere.body.claimed, true);
  assert.equal(elsewhere.body.moonlight, true);
  assert.equal(elsewhere.state.invite.accepted, true);
  assert.equal(String(elsewhere.state.profiles[0].organization_id), '4');
  assert.equal(
    elsewhere.state.memberships.some((row) => row.organization_id === 9),
    true
  );
});

test('reopened-invite repair SQL is a one-off, not a migration', () => {
  const dir = join(here, '../supabase/oneoff');
  const find = readFileSync(join(dir, '20261009_repair_reopened_invites_find.sql'), 'utf8');
  const repair = readFileSync(join(dir, '20261009_repair_reopened_invites.sql'), 'utf8');
  const rollback = readFileSync(join(dir, '20261009_repair_reopened_invites_rollback.sql'), 'utf8');
  const firstSql = (sql: string) =>
    sql
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim()
      .split(';')[0]
      .trim();
  assert.doesNotMatch(find, /\b(UPDATE|INSERT|DELETE|ALTER|DROP)\b/i);
  assert.match(find, /expires_at >= '2026-10-16 15:40:00\+00'/);
  assert.match(find, /expires_at <= '2026-10-16 16:25:00\+00'/);
  assert.match(find, /lower\(u\.email\) = lower\(i\.email\)/);
  assert.match(find, /p\.organization_id = i\.organization_id/);
  assert.equal(firstSql(repair), "SET LOCAL lock_timeout = '5s'");
  assert.match(repair, /accepted = true/);
  assert.match(repair, /accepted_at = COALESCE\(i\.accepted_at, now\(\)\)/);
  assert.match(repair, /RETURNING i\.id/);
  assert.doesNotMatch(repair, /\bWHERE id = 42\b/);
  assert.doesNotMatch(repair, /\bCONCURRENTLY\b/i);
  assert.doesNotMatch(repair, /\bCOMMIT\b/i);
  assert.match(rollback, /SET LOCAL lock_timeout = '5s'/);
  assert.match(rollback, /WHERE id = 42/);
  assert.match(rollback, /accepted = false/);
  assert.match(rollback, /accepted_at = NULL/);
  assert.match(rollback, /2026-10-16 15:57:26\.206\+00/);
  assert.equal(TEAM_INVITE_TTL_MS, 7 * 24 * 60 * 60 * 1000);
});

test('an owner team invite is rejected and writes no row', async () => {
  assert.equal(isInvitableTeamRole('owner'), false);
  assert.equal(isInvitableTeamRole('Owner'), false);
  assert.deepEqual(
    [...INVITABLE_TEAM_ROLES],
    [
      'company_admin',
      'service_manager',
      'fse',
      'dispatcher',
      'billing_manager',
      'scheduler',
      'technician',
      'viewer',
      'admin',
    ]
  );
  const result = await postExistingInvite({
    resendKey: 'resend-test',
    auth: { status: 'found', id: 'auth-1', lastSignInAt: null },
    invite: null,
    role: 'owner',
  });
  assert.equal(result.status, 400);
  assert.match(String(result.body.error), /owner/i);
  assert.equal(result.inserts.length, 0);
  assert.equal(result.updates.length, 0);
  assert.equal(result.sent.length, 0);
  assert.equal(result.linkCalls.length, 0);
  assertNoLink(result, SETUP_LINK);

  for (const rel of ['../app/admin/team/page.tsx', '../app/company/page.tsx', '../app/onboarding/page.tsx']) {
    const page = readFileSync(join(here, rel), 'utf8');
    assert.match(page, /INVITABLE_TEAM_ROLES/);
    assert.doesNotMatch(page, /value=["']owner["']/);
  }
});

test('resend of an owner-role invite is rejected', async () => {
  const invite = {
    ...pendingCreated,
    role: 'owner',
    accepted: false,
    accepted_at: null,
  };
  const explicit = await postExistingInvite({
    resendKey: 'resend-test',
    auth: { status: 'found', id: 'auth-1', lastSignInAt: '2026-10-02T00:00:00.000Z' },
    invite,
    role: 'owner',
  });
  assert.equal(explicit.status, 400);
  assert.equal(explicit.updates.length, 0);
  assert.equal(explicit.inserts.length, 0);
  assert.equal(explicit.sent.length, 0);
  assert.equal(invite.role, 'owner');
  assert.equal(invite.accepted, false);

  const stored = {
    ...pendingCreated,
    role: 'owner',
    accepted: false,
    accepted_at: null,
  };
  const rewritten = await postExistingInvite({
    resendKey: 'resend-test',
    auth: { status: 'found', id: 'auth-1', lastSignInAt: '2026-10-02T00:00:00.000Z' },
    invite: stored,
    role: 'fse',
  });
  assert.equal(rewritten.status, 400);
  assert.equal(rewritten.updates.length, 0);
  assert.equal(rewritten.sent.length, 0);
  assert.equal(stored.role, 'owner');
  assert.equal(stored.accepted, false);
});

test('a staff role can still be invited', async () => {
  for (const role of ['fse', 'dispatcher', 'service_manager', 'billing_manager'] as const) {
    const result = await postExistingInvite({
      resendKey: 'resend-test',
      auth: { status: 'not_found' },
      invite: null,
      profile: null,
      role,
    });
    assert.equal(result.status, 200, role);
    assert.equal(result.body.emailed, true);
    assert.equal(result.inserts.length, 1);
    assert.equal(result.inserts[0].role, role);
    assert.equal(result.linkCalls.length, 1);
    assert.equal(result.linkCalls[0].type, 'invite');
    assertNoLink(result, SETUP_LINK);
  }
});

test('a legacy owner-role invite cannot be claimed and writes nothing', async () => {
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const blocked = await postRejoinClaim({
    profileOrg: null,
    memberships: [],
    invite: {
      id: 7,
      email: INVITEE,
      organization_id: 9,
      role: 'owner',
      accepted: false,
      accepted_at: null,
      expires_at: future,
      created_at: '2026-10-08T00:00:00.000Z',
      first_name: 'New',
      last_name: 'Person',
    },
  });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.claimed, false);
  assert.match(String(blocked.body.error), /owner/i);
  assert.equal(blocked.state.invite.accepted, false);
  assert.equal(blocked.state.invite.role, 'owner');
  assert.equal(blocked.state.memberships.length, 0);
  assert.equal(blocked.state.profiles[0].organization_id, null);
  assert.equal(blocked.state.profiles[0].role, 'fse');

  const staff = await postRejoinClaim({
    profileOrg: null,
    memberships: [],
    invite: {
      id: 8,
      email: INVITEE,
      organization_id: 9,
      role: 'dispatcher',
      accepted: false,
      accepted_at: null,
      expires_at: future,
      created_at: '2026-10-08T00:00:00.000Z',
      first_name: 'New',
      last_name: 'Person',
    },
  });
  assert.equal(staff.status, 200, JSON.stringify(staff.body));
  assert.equal(staff.body.claimed, true);
  assert.equal(String(staff.state.profiles[0].organization_id), '9');
  assert.equal(staff.state.profiles[0].role, 'dispatcher');
  assert.equal(
    staff.state.memberships.some((row) => row.organization_id === 9 && row.role === 'dispatcher'),
    true
  );
});
