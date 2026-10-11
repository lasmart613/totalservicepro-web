/**
 * Which Supabase auth events make the Header refetch profile, org role,
 * unread count and God status.
 *
 * - SIGNED_OUT, or any event without a session user: clear everything.
 * - USER_UPDATED: refetch (email / metadata / role-relevant change).
 * - INITIAL_SESSION and TOKEN_REFRESHED for the user already loaded: ignore.
 *   They also ignore while the mount's own getUser() load is still running
 *   and no user is known yet; that load fetches the same session's data.
 * - SIGNED_IN for the user already loaded: ignore. supabase-js fires it again
 *   when a tab regains focus. SIGNED_IN for a different user: refetch.
 * - Anything else for a new or different user: refetch.
 *
 * Role changes still appear on the next navigation: every page mounts its
 * own Header, and each mount runs getUser() and loads the profile and org
 * role fresh. A token refresh alone no longer refetches.
 */
export type HeaderAuthDecision = 'clear' | 'refetch' | 'ignore';

export function headerAuthDecision(
  event: string,
  sessionUserId: string | null | undefined,
  knownUserId: string | null | undefined,
  initialLoadPending: boolean,
): HeaderAuthDecision {
  const uid = String(sessionUserId || '').trim();
  if (event === 'SIGNED_OUT' || !uid) return 'clear';
  if (event === 'USER_UPDATED') return 'refetch';
  const known = String(knownUserId || '').trim();
  const sameUser = known !== '' && known === uid;
  if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
    if (sameUser) return 'ignore';
    if (initialLoadPending && known === '') return 'ignore';
    return 'refetch';
  }
  if (event === 'SIGNED_IN' && sameUser) return 'ignore';
  return 'refetch';
}
