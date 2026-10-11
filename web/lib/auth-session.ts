/**
 * Browser identity hygiene. The previous clinic/supplier mix-up was not a
 * stored organization_id in localStorage — pending signup never writes one.
 * What *does* linger is tsp-auth-token (Supabase session) plus tsp-pending-signup
 * company fields from the last attempt. Clear both on logout / before a new signup.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { clearTeamClaimDedupe } from '@/lib/invite-claim';
import { clearPendingSignup } from '@/lib/pending-signup';
import { FINANCIAL_REPORTING_API } from '@/lib/financial-reporting-access';
import { JOB_COSTING_API } from '@/lib/job-costing-access';

export const AUTH_STORAGE_KEY = 'tsp-auth-token';

/** True when a Supabase session blob is in localStorage. Used before getUser() resolves. */
export function hasBrowserAuthHint(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    return !!raw && raw !== 'null' && raw !== '{}' && raw !== 'undefined';
  } catch {
    return false;
  }
}

export function clearBrowserIdentityArtifacts() {
  clearPendingSignup();
  clearTeamClaimDedupe();
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    window.localStorage.removeItem(`${AUTH_STORAGE_KEY}-code-verifier`);
  } catch {
    /* ignore */
  }
  try {
    window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** How long sign-out waits for /auth/v1/logout before clearing locally anyway. */
export const SIGN_OUT_REVOKE_TIMEOUT_MS = 5000;

/**
 * Sign out: revoke the session on the server first, then clear local state.
 *
 * Order matters. supabase-js reads the session from tsp-auth-token to call
 * POST /auth/v1/logout; clearing the token first made it skip the call, so the
 * old access and refresh tokens stayed valid. Default scope, so the server
 * revokes the refresh token. If the revoke fails or stalls (offline), the
 * local session is still dropped and the caller still redirects.
 */
export async function signOutAndClearIdentity(
  supabase: SupabaseClient,
  options: { revokeTimeoutMs?: number } = {}
): Promise<void> {
  const revokeTimeoutMs = options.revokeTimeoutMs ?? SIGN_OUT_REVOKE_TIMEOUT_MS;
  let revoked = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      supabase.auth.signOut(),
      new Promise<{ error: Error }>((resolve) =>
        (timer = setTimeout(() => resolve({ error: new Error('sign-out timed out') }), revokeTimeoutMs))
      ),
    ]);
    revoked = !result?.error;
  } catch {
    /* offline or network error: fall through to the local clear */
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!revoked) {
    // signOut({ scope: 'local' }) would also call /auth/v1/logout and keep the
    // session on a network error, so stop the refresh timer here and let the
    // storage clear below drop the session locally.
    try {
      await supabase.auth.stopAutoRefresh();
    } catch {
      /* ignore */
    }
  }
  try {
    if (typeof fetch !== 'undefined') {
      await fetch(FINANCIAL_REPORTING_API, { method: 'DELETE', cache: 'no-store' });
    }
  } catch {
    /* cookie clear is best-effort */
  }
  try {
    if (typeof fetch !== 'undefined') {
      await fetch(JOB_COSTING_API, { method: 'DELETE', cache: 'no-store' });
    }
  } catch {
    /* cookie clear is best-effort */
  }
  clearBrowserIdentityArtifacts();
}

/**
 * Call before creating a new account so a previous session cannot stay in the header.
 * A logged-out browser has no report cookie, so this does not DELETE the financial
 * or job-costing routes. Those DELETEs only clear an httpOnly cookie on sign-out.
 */
export async function prepareFreshSignup(supabase: SupabaseClient): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    clearBrowserIdentityArtifacts();
    return;
  }
  await signOutAndClearIdentity(supabase);
}
