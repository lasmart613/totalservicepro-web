import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pendingLoginEmail,
  profileEmailToSync,
  requestLoginEmailChange,
  type EmailAuth,
} from './change-email.ts';

test('a pending address is not copied onto the profile', () => {
  const user = { email: 'old@qa.test', new_email: 'new@qa.test' };
  assert.equal(pendingLoginEmail(user), 'new@qa.test');
  assert.equal(profileEmailToSync(user, 'old@qa.test'), null);
  assert.equal(profileEmailToSync(user, null), null);
});

test('a confirmed auth email syncs only when the profile differs', () => {
  const user = { email: 'New@qa.test', new_email: '' };
  assert.equal(pendingLoginEmail(user), '');
  assert.equal(profileEmailToSync(user, 'old@qa.test'), 'new@qa.test');
  assert.equal(profileEmailToSync(user, 'new@qa.test'), null);
  assert.equal(profileEmailToSync(user, null), 'new@qa.test');
});

test('updateUser email reports pending and does not treat it as confirmed', async () => {
  const calls: string[] = [];
  const auth: EmailAuth = {
    async updateUser(attributes, options) {
      calls.push(`${attributes.email}|${options?.emailRedirectTo || ''}`);
      return {
        data: { user: { email: 'old@qa.test', new_email: attributes.email } },
        error: null,
      };
    },
  };
  const result = await requestLoginEmailChange(auth, {
    currentEmail: 'old@qa.test',
    nextEmail: 'New@qa.test',
    emailRedirectTo: 'https://repairplanet.net/profile',
  });
  assert.deepEqual(result, { ok: true, email: 'old@qa.test', pending: 'new@qa.test' });
  assert.deepEqual(calls, ['new@qa.test|https://repairplanet.net/profile']);
  assert.equal(profileEmailToSync({ email: 'old@qa.test', new_email: 'new@qa.test' }, 'old@qa.test'), null);
});

test('email validation fails before updateUser', async () => {
  let called = false;
  const auth: EmailAuth = {
    async updateUser() {
      called = true;
      return { data: { user: null }, error: null };
    },
  };
  const same = await requestLoginEmailChange(auth, {
    currentEmail: 'Old@qa.test',
    nextEmail: 'old@qa.test',
  });
  assert.deepEqual(same, { ok: false, error: 'That is already your login email.' });
  const bad = await requestLoginEmailChange(auth, {
    currentEmail: 'old@qa.test',
    nextEmail: 'not-an-email',
  });
  assert.deepEqual(bad, { ok: false, error: 'Enter a valid email address.' });
  assert.equal(called, false);
});

test('updateUser email errors do not leak project URLs', async () => {
  const auth: EmailAuth = {
    async updateUser() {
      return {
        data: { user: null },
        error: { message: 'https://yljztfajyvjzqikxdddf.supabase.co/auth/v1/user' },
      };
    },
  };
  const result = await requestLoginEmailChange(auth, {
    currentEmail: 'old@qa.test',
    nextEmail: 'new@qa.test',
  });
  assert.deepEqual(result, { ok: false, error: 'Could not start the email change.' });
});
