/**
 * User-facing auth errors. Never dump JWTs, project refs, or Google auth codes.
 */

const SECRET_LEAK =
  /supabase\.co|yljztfaj|anon key|service_role|jwt|apikey|NEXT_PUBLIC_|eyJ[A-Za-z0-9_-]{20,}/i;

/** Google authorization codes look like 4/0A… — Supabase echoes them on exchange failure. */
const GOOGLE_AUTH_CODE = /\b4\/0A[A-Za-z0-9_\-]*/;

export function publicAuthMessage(
  raw: unknown,
  fallback = 'Sign-in failed. Please try again.'
): string {
  const s = String(raw || '').trim();
  if (!s) return fallback;

  // Production (2026-09-12): Supabase /auth/v1/callback logs
  //   oauth2: "invalid_client" "The provided client secret is invalid."
  //   500: Unable to exchange external code: 4/0A…
  // Redirect allowlist and /auth/callback are fine; Google rejects the secret
  // stored in Supabase → Authentication → Providers → Google.
  if (
    /unable to exchange external code/i.test(s) ||
    (/invalid_client/i.test(s) && /secret/i.test(s)) ||
    GOOGLE_AUTH_CODE.test(s)
  ) {
    return 'Google sign-in is temporarily unavailable. Use email and password, or Forgot password.';
  }

  if (SECRET_LEAK.test(s)) return fallback;
  return s;
}
