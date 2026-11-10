/**
 * Signed-in email change. supabase.auth.updateUser({ email }) sends Supabase's
 * confirmation mail and leaves auth.users.email in place until that finishes.
 * user_profiles.email is copied only from the confirmed auth email.
 */

import { publicAuthMessage } from './auth-errors.ts';

const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export type AuthEmailUser = {
  email?: string | null;
  new_email?: string | null;
};

export type EmailAuth = {
  updateUser: (
    attributes: { email: string },
    options?: { emailRedirectTo?: string },
  ) => Promise<{ data: { user: AuthEmailUser | null }; error: { message?: string } | null }>;
};

export type EmailChangeResult =
  | { ok: true; email: string; pending: string }
  | { ok: false; error: string };

export function normalizeLoginEmail(raw: string | null | undefined): string {
  return String(raw || '').trim().toLowerCase();
}

/** Address still waiting on the confirmation mail. Empty once auth.users.email moved. */
export function pendingLoginEmail(user: AuthEmailUser | null | undefined): string {
  const pending = String(user?.new_email || '').trim();
  if (!pending) return '';
  const current = String(user?.email || '').trim();
  if (pending.toLowerCase() === current.toLowerCase()) return '';
  return pending;
}

/**
 * Confirmed auth email to store on user_profiles, or null while a change is pending
 * or the profile already matches.
 */
export function profileEmailToSync(
  user: AuthEmailUser | null | undefined,
  profileEmail: string | null | undefined,
): string | null {
  if (pendingLoginEmail(user)) return null;
  const confirmed = normalizeLoginEmail(user?.email);
  if (!confirmed) return null;
  if (normalizeLoginEmail(profileEmail) === confirmed) return null;
  return confirmed;
}

export function loginEmailChangeError(raw: string, currentEmail: string): string | null {
  const email = normalizeLoginEmail(raw);
  if (email.length < 6 || email.length > 254 || /\s/.test(raw) || !EMAIL_RE.test(email)) {
    return 'Enter a valid email address.';
  }
  if (email === normalizeLoginEmail(currentEmail)) return 'That is already your login email.';
  return null;
}

export async function requestLoginEmailChange(
  auth: EmailAuth,
  input: { currentEmail: string; nextEmail: string; emailRedirectTo?: string },
): Promise<EmailChangeResult> {
  const invalid = loginEmailChangeError(input.nextEmail, input.currentEmail);
  if (invalid) return { ok: false, error: invalid };

  const next = normalizeLoginEmail(input.nextEmail);
  const updated = await auth.updateUser(
    { email: next },
    input.emailRedirectTo ? { emailRedirectTo: input.emailRedirectTo } : undefined,
  );
  if (updated.error) {
    return {
      ok: false,
      error: publicAuthMessage(updated.error.message, 'Could not start the email change.'),
    };
  }

  const user = updated.data?.user;
  const email = String(user?.email || input.currentEmail || '').trim();
  const pending =
    pendingLoginEmail(user) || (normalizeLoginEmail(user?.email) === next ? '' : next);
  return { ok: true, email, pending };
}
