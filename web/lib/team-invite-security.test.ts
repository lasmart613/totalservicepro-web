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
import {
  decideTeamInviteAudience,
  newUserLinkFailureMode,
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
