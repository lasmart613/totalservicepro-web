/**
 * Signed-in password change. Re-check the current password, then update.
 * updateUser alone accepts any session, including one that was just created
 * by a recovery link. The profile form asks for the current password first.
 */

import { MIN_PASSWORD_LENGTH } from './auth-constants.ts';
import { publicAuthMessage } from './auth-errors.ts';

export type PasswordAuth = {
  signInWithPassword: (credentials: {
    email: string;
    password: string;
  }) => Promise<{ error: { message?: string } | null }>;
  updateUser: (attributes: { password: string }) => Promise<{ error: { message?: string } | null }>;
};

export type ChangePasswordInput = {
  email: string;
  currentPassword: string;
  nextPassword: string;
  confirmPassword: string;
};

export type ChangePasswordResult = { ok: true } | { ok: false; error: string };

export function validatePasswordChange(input: ChangePasswordInput): string | null {
  const email = String(input.email || '').trim();
  if (!email) return 'Sign in again, then change your password.';
  if (!input.currentPassword) return 'Enter your current password.';
  if (input.nextPassword.length < MIN_PASSWORD_LENGTH) {
    return 'Password must be at least 8 characters.';
  }
  if (input.nextPassword !== input.confirmPassword) return 'Passwords do not match.';
  if (input.currentPassword === input.nextPassword) return 'Choose a different password.';
  return null;
}

function reauthError(raw: string): string {
  if (/invalid login credentials|invalid credentials|email or password/i.test(raw)) {
    return 'Current password is incorrect.';
  }
  return publicAuthMessage(raw, 'Current password is incorrect.');
}

export async function changePasswordWithReauth(
  auth: PasswordAuth,
  input: ChangePasswordInput
): Promise<ChangePasswordResult> {
  const invalid = validatePasswordChange(input);
  if (invalid) return { ok: false, error: invalid };

  const email = input.email.trim().toLowerCase();
  const signed = await auth.signInWithPassword({
    email,
    password: input.currentPassword,
  });
  if (signed.error) return { ok: false, error: reauthError(signed.error.message || '') };

  const updated = await auth.updateUser({ password: input.nextPassword });
  if (updated.error) {
    return {
      ok: false,
      error: publicAuthMessage(updated.error.message, 'Could not change password.'),
    };
  }
  return { ok: true };
}
