/**
 * Browser identity hygiene. The previous clinic/supplier mix-up was not a
 * stored organization_id in localStorage — pending signup never writes one.
 * What *does* linger is tsp-auth-token (Supabase session) plus tsp-pending-signup
 * company fields from the last attempt. Clear both on logout / before a new signup.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { clearPendingSignup } from '@/lib/pending-signup';

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
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export async function signOutAndClearIdentity(supabase: SupabaseClient): Promise<void> {
  clearBrowserIdentityArtifacts();
  try {
    await supabase.auth.signOut();
  } catch {
    /* still leave local artifacts cleared */
  }
  clearBrowserIdentityArtifacts();
}

/** Call before creating a new account so the previous session cannot stay in the header. */
export async function prepareFreshSignup(supabase: SupabaseClient): Promise<void> {
  await signOutAndClearIdentity(supabase);
}
