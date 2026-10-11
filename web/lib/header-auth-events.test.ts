import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headerAuthDecision } from './header-auth-events.ts';
import { unreadPollUserId } from './unread-poll.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const A = 'user-a';
const B = 'user-b';

test('sign-out and a missing session user always clear', () => {
  for (const event of ['SIGNED_OUT', 'INITIAL_SESSION', 'TOKEN_REFRESHED', 'SIGNED_IN', 'USER_UPDATED']) {
    assert.equal(headerAuthDecision(event, null, A, false), 'clear', event);
    assert.equal(headerAuthDecision(event, '', A, true), 'clear', event);
  }
  assert.equal(headerAuthDecision('SIGNED_OUT', A, A, false), 'clear');
});

test('INITIAL_SESSION and TOKEN_REFRESHED for the loaded user are ignored', () => {
  assert.equal(headerAuthDecision('INITIAL_SESSION', A, A, false), 'ignore');
  assert.equal(headerAuthDecision('TOKEN_REFRESHED', A, A, false), 'ignore');
  // The mount's own getUser() load is still running: it covers this session.
  assert.equal(headerAuthDecision('INITIAL_SESSION', A, null, true), 'ignore');
  assert.equal(headerAuthDecision('TOKEN_REFRESHED', A, null, true), 'ignore');
});

test('a different or unknown user refetches', () => {
  assert.equal(headerAuthDecision('INITIAL_SESSION', B, A, false), 'refetch');
  assert.equal(headerAuthDecision('TOKEN_REFRESHED', B, A, true), 'refetch');
  assert.equal(headerAuthDecision('INITIAL_SESSION', A, null, false), 'refetch');
  assert.equal(headerAuthDecision('SIGNED_IN', B, A, false), 'refetch');
  assert.equal(headerAuthDecision('SIGNED_IN', A, null, false), 'refetch');
  assert.equal(headerAuthDecision('SIGNED_IN', A, null, true), 'refetch');
});

test('USER_UPDATED always refetches; focus-time SIGNED_IN for the same user does not', () => {
  assert.equal(headerAuthDecision('USER_UPDATED', A, A, false), 'refetch');
  assert.equal(headerAuthDecision('USER_UPDATED', A, null, true), 'refetch');
  assert.equal(headerAuthDecision('SIGNED_IN', A, A, false), 'ignore');
});

test('unread poll reads the local session, not /auth/v1/user', async () => {
  assert.equal(await unreadPollUserId({ getSession: async () => ({ data: { session: { user: { id: A } } } }) }), A);
  assert.equal(await unreadPollUserId({ getSession: async () => ({ data: { session: null } }) }), null);
  assert.equal(
    await unreadPollUserId({
      getSession: async () => {
        throw new Error('storage');
      },
    }),
    null,
  );
});

test('NavIdentityProvider uses the decision; the poll reads the session; consumers make no reads', () => {
  const provider = readFileSync(join(here, '../components/NavIdentityProvider.tsx'), 'utf8');
  assert.match(provider, /headerAuthDecision\(event, session\?\.user\?\.id, activeUserId\.current, initialLoadPending\.current\)/);
  assert.match(provider, /if \(decision === 'ignore'\)/);
  assert.match(provider, /decision === 'clear' \|\| !session\?\.user/);
  const poll = provider.slice(provider.indexOf('startDocumentUnreadPoll('));
  assert.match(poll.slice(0, 300), /unreadPollUserId\(supabase\.auth\)/);
  assert.doesNotMatch(poll.slice(0, 300), /getUser/);
  // One getUser() per app session (verifies the stored session).
  assert.equal((provider.match(/auth\.getUser\(\)/g) || []).length, 1);

  const header = readFileSync(join(here, '../components/Header.tsx'), 'utf8');
  assert.doesNotMatch(header, /onAuthStateChange|auth\.getUser|auth\.getSession|\.from\(/);
  for (const file of ['../lib/use-show-upgrade.ts', '../components/AdBanner.tsx']) {
    const src = readFileSync(join(here, file), 'utf8');
    assert.doesNotMatch(src, /auth\.getUser\(|\.from\('/, file);
    assert.match(src, /useNavIdentity\(\)/, file);
  }
});
