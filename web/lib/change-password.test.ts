import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changePasswordWithReauth, type PasswordAuth } from './change-password.ts';

const here = dirname(fileURLToPath(import.meta.url));

const valid = {
  email: 'Tech@Example.com',
  currentPassword: 'old-password',
  nextPassword: 'new-password',
  confirmPassword: 'new-password',
};

function auth(opts?: {
  signError?: string | null;
  updateError?: string | null;
}): { client: PasswordAuth; calls: string[] } {
  const calls: string[] = [];
  const client: PasswordAuth = {
    async signInWithPassword(credentials) {
      calls.push(`sign:${credentials.email}`);
      if (opts?.signError) return { error: { message: opts.signError } };
      return { error: null };
    },
    async updateUser(attributes) {
      calls.push(`update:${attributes.password}`);
      if (opts?.updateError) return { error: { message: opts.updateError } };
      return { error: null };
    },
  };
  return { client, calls };
}

test('change password re-authenticates before updateUser', async () => {
  const { client, calls } = auth();
  const result = await changePasswordWithReauth(client, valid);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ['sign:tech@example.com', 'update:new-password']);
});

test('a wrong current password does not call updateUser', async () => {
  const { client, calls } = auth({ signError: 'Invalid login credentials' });
  const result = await changePasswordWithReauth(client, valid);
  assert.deepEqual(result, { ok: false, error: 'Current password is incorrect.' });
  assert.deepEqual(calls, ['sign:tech@example.com']);
});

test('validation fails before any auth call', async () => {
  const { client, calls } = auth();
  const cases: Array<[typeof valid, string]> = [
    [{ ...valid, email: '  ' }, 'Sign in again, then change your password.'],
    [{ ...valid, currentPassword: '' }, 'Enter your current password.'],
    [{ ...valid, nextPassword: 'short', confirmPassword: 'short' }, 'Password must be at least 8 characters.'],
    [{ ...valid, confirmPassword: 'new-password-x' }, 'Passwords do not match.'],
    [{ ...valid, nextPassword: valid.currentPassword, confirmPassword: valid.currentPassword }, 'Choose a different password.'],
  ];
  for (const [input, error] of cases) {
    const result = await changePasswordWithReauth(client, input);
    assert.deepEqual(result, { ok: false, error }, error);
  }
  assert.deepEqual(calls, []);
});

test('updateUser errors stay user-facing and do not leak tokens', async () => {
  const weak = auth({ updateError: 'Password should be at least 8 characters.' });
  assert.deepEqual(await changePasswordWithReauth(weak.client, valid), {
    ok: false,
    error: 'Password should be at least 8 characters.',
  });

  const leaked = auth({
    updateError: 'failed https://yljztfajyvjzqikxdddf.supabase.co/auth/v1/user',
  });
  const result = await changePasswordWithReauth(leaked.client, valid);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, 'Could not change password.');
});

test('profile and settings show the auth email and the reauth password form', () => {
  const profile = readFileSync(join(here, '../app/profile/page.tsx'), 'utf8');
  const settings = readFileSync(join(here, '../app/settings/page.tsx'), 'utf8');
  const ui = readFileSync(join(here, '../components/AccountSecurity.tsx'), 'utf8');
  assert.match(profile, /<AccountSecurity \/>/);
  assert.match(settings, /<AccountSecurity \/>/);
  assert.match(ui, /auth\.getUser\(\)/);
  assert.match(ui, /signInWithPassword: \(credentials\) => supabase\.auth\.signInWithPassword/);
  assert.match(ui, /updateUser: \(attributes\) => supabase\.auth\.updateUser/);
  assert.match(ui, /readOnly/);
  assert.match(ui, /Sign-in email/);
  assert.match(ui, /Change password/);
  assert.match(ui, /Account and security/);
  const emailForm = ui.slice(ui.indexOf('editingEmail ?'), ui.indexOf("t('Send confirmation')"));
  assert.match(emailForm, /A confirmation link will be emailed to the new address\./);
  assert.match(ui, /requestLoginEmailChange/);
  assert.match(ui, /signOutAndClearIdentity\(supabase, \{ scope: 'others' \}\)/);
  assert.doesNotMatch(ui, /updateUser\(\{ password/);
  assert.doesNotMatch(ui, /\.auth\.signOut\(/);
  assert.doesNotMatch(ui, /scope: 'global'/);
});
