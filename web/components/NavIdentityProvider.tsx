'use client';

/**
 * Signed-in identity for the header, upgrade entry, ad banner and org
 * switchers, loaded once per app session instead of once per component per
 * mount. Mounted once in Providers (root layout).
 *
 * - Starts on the first consumer. Signed-out visitors with no session make
 *   no network call.
 * - Mount: one getUser(), then loadNavIdentity (profile + orgs + membership).
 *   Unread count, the unread poll and /api/god/me only run while a Header
 *   is mounted.
 * - Every navigation reloads the profile, org and org role (and the unread
 *   count), so a role change shows up on the next navigation exactly as
 *   before. The shared memberships read is dropped on every navigation too.
 * - Auth events follow headerAuthDecision: SIGNED_OUT clears everything
 *   at once, USER_UPDATED and a different user refetch, same-user
 *   INITIAL_SESSION / TOKEN_REFRESHED / SIGNED_IN are ignored.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/lib/supabase/client';
import { headerAuthDecision } from '@/lib/header-auth-events';
import { loadNavIdentity, type NavIdentityProfile, type NavOrg } from '@/lib/nav-identity';
import { ORG_NAV_PENDING, orgNavFromLookup, type OrgNavState } from '@/lib/profile-nav';
import { isUnreadPollBackoffError, startDocumentUnreadPoll, unreadPollUserId } from '@/lib/unread-poll';
import { fetchGodMe } from '@/lib/god-client';
import { invalidateSharedMemberships } from '@/lib/org-membership-client';

export type NavIdentityState = {
  /** The first getUser() + identity load finished (or there is no session). */
  ready: boolean;
  user: User | null;
  profile: NavIdentityProfile | null;
  homeOrg: NavOrg | null;
  orgNav: OrgNavState;
  unread: number;
  isGod: boolean;
};

type NavIdentityContextValue = NavIdentityState & {
  /** A consumer is mounted: start loading if not started. */
  demand: () => () => void;
  /** A Header is mounted: unread count, poll and God status run. */
  header: () => () => void;
  /** Sign-out from the UI: clear now, before the auth event arrives. */
  clear: () => void;
};

const EMPTY: NavIdentityState = {
  ready: false,
  user: null,
  profile: null,
  homeOrg: null,
  orgNav: ORG_NAV_PENDING,
  unread: 0,
  isGod: false,
};

const noop = () => () => {};

const NavIdentityContext = createContext<NavIdentityContextValue>({
  ...EMPTY,
  ready: true,
  demand: noop,
  header: noop,
  clear: () => {},
});

function setBadge(count: number) {
  if (typeof navigator === 'undefined' || !('setAppBadge' in navigator)) return;
  try {
    if (count > 0) (navigator as any).setAppBadge(count);
    else (navigator as any).clearAppBadge?.();
  } catch {
    /* ignore */
  }
}

export function NavIdentityProvider({ children }: { children: React.ReactNode }) {
  const supabase = getSupabaseClient();
  const pathname = usePathname();
  const [state, setState] = useState<NavIdentityState>(EMPTY);

  const started = useRef(false);
  const initialLoadPending = useRef(false);
  const activeUserId = useRef<string | null>(null);
  const loadSeq = useRef(0);
  const headerCount = useRef(0);
  const godFor = useRef<string | null>(null);
  const stopPoll = useRef<(() => void) | null>(null);
  const lastPath = useRef<string | null>(null);

  const patch = useCallback((next: Partial<NavIdentityState>) => {
    setState((prev) => ({ ...prev, ...next }));
  }, []);

  const clearAll = useCallback(() => {
    activeUserId.current = null;
    godFor.current = null;
    loadSeq.current += 1;
    invalidateSharedMemberships();
    setBadge(0);
    setState({ ...EMPTY, ready: true });
  }, []);

  /** @returns true when the poll should back off (504 / timeout / 5xx). */
  const refreshUnread = useCallback(
    async (uid: string): Promise<boolean> => {
      try {
        const { count, error } = await supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', uid)
          .eq('is_read', false);
        if (activeUserId.current !== uid) return false;
        if (error) {
          if (isUnreadPollBackoffError(error)) return true;
          patch({ unread: 0 });
          return false;
        }
        patch({ unread: count || 0 });
        setBadge(count || 0);
        return false;
      } catch (err) {
        if (isUnreadPollBackoffError(err)) return true;
        if (activeUserId.current === uid) patch({ unread: 0 });
        return false;
      }
    },
    [supabase, patch]
  );

  const loadGod = useCallback(
    (uid: string) => {
      if (headerCount.current === 0 || godFor.current === uid) return;
      godFor.current = uid;
      fetchGodMe().then((value) => {
        if (activeUserId.current === uid) patch({ isGod: value });
      });
    },
    [patch]
  );

  const loadIdentity = useCallback(
    async (uid: string) => {
      const seq = ++loadSeq.current;
      const identity = await loadNavIdentity(supabase, uid);
      if (seq !== loadSeq.current || activeUserId.current !== uid) return;
      // A row for someone else is never shown (same guard the Header had).
      const profile = identity.profile && identity.profile.id && identity.profile.id !== uid ? null : identity.profile;
      patch({ profile, homeOrg: identity.homeOrg, orgNav: orgNavFromLookup(identity.orgRole) });
    },
    [supabase, patch]
  );

  const loadForUser = useCallback(
    async (user: User, switched: boolean) => {
      const uid = user.id;
      activeUserId.current = uid;
      if (switched) {
        godFor.current = null;
        invalidateSharedMemberships();
        // Drop the previous account's org chip immediately; do not wait for fetch.
        patch({ user, profile: null, homeOrg: null, orgNav: ORG_NAV_PENDING, unread: 0, isGod: false });
      } else {
        patch({ user });
      }
      await loadIdentity(uid);
      if (activeUserId.current !== uid) return;
      if (headerCount.current > 0) {
        await refreshUnread(uid);
        loadGod(uid);
      }
    },
    [patch, loadIdentity, refreshUnread, loadGod]
  );

  const start = useCallback(() => {
    if (started.current) return;
    started.current = true;
    initialLoadPending.current = true;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        // No stored session: nothing to verify, no network call.
        initialLoadPending.current = false;
        clearAll();
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      initialLoadPending.current = false;
      if (!user) {
        clearAll();
        return;
      }
      await loadForUser(user, true);
      patch({ ready: true });
    })().catch(() => {
      initialLoadPending.current = false;
      clearAll();
    });
  }, [supabase, clearAll, loadForUser, patch]);

  // Auth events.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!started.current) return;
      const decision = headerAuthDecision(event, session?.user?.id, activeUserId.current, initialLoadPending.current);
      if (decision === 'clear' || !session?.user) {
        if (!initialLoadPending.current || event === 'SIGNED_OUT') clearAll();
        return;
      }
      if (decision === 'ignore') {
        if (activeUserId.current === session.user.id) patch({ user: session.user });
        return;
      }
      const switched = activeUserId.current !== session.user.id;
      loadForUser(session.user, switched).then(() => patch({ ready: true }));
    });
    return () => subscription.unsubscribe();
  }, [supabase, clearAll, loadForUser, patch]);

  // Next navigation refetches profile, org role and unread: role changes and
  // removed memberships show up on the next page, as when each page's
  // Header loaded its own copy.
  useEffect(() => {
    const path = pathname || '';
    const prev = lastPath.current;
    lastPath.current = path;
    if (prev === null || prev === path) return;
    invalidateSharedMemberships();
    const uid = activeUserId.current;
    if (!uid || initialLoadPending.current) return;
    loadIdentity(uid);
    if (headerCount.current > 0) refreshUnread(uid);
  }, [pathname, loadIdentity, refreshUnread]);

  const demand = useCallback(() => {
    start();
    return () => {};
  }, [start]);

  const header = useCallback(() => {
    start();
    headerCount.current += 1;
    if (headerCount.current === 1) {
      const uid = activeUserId.current;
      const pollWasRunning = !!stopPoll.current;
      if (uid && !initialLoadPending.current) {
        loadGod(uid);
        // First header after a stretch without one: count now, not at the next tick.
        if (!pollWasRunning) refreshUnread(uid);
      }
      if (!stopPoll.current) {
        stopPoll.current = startDocumentUnreadPoll(async () => {
          const pollUid = await unreadPollUserId(supabase.auth);
          if (!pollUid || pollUid !== activeUserId.current) return false;
          return refreshUnread(pollUid);
        });
      }
    }
    return () => {
      headerCount.current = Math.max(0, headerCount.current - 1);
      if (headerCount.current === 0) {
        // Pages swap headers on navigation (and RequireAuth's pending header
        // hands over to the page's). Keep the poll across that hand-over.
        window.setTimeout(() => {
          if (headerCount.current === 0 && stopPoll.current) {
            stopPoll.current();
            stopPoll.current = null;
          }
        }, 1000);
      }
    };
  }, [start, loadGod, refreshUnread, supabase]);

  useEffect(
    () => () => {
      stopPoll.current?.();
      stopPoll.current = null;
    },
    []
  );

  const value = useMemo<NavIdentityContextValue>(
    () => ({ ...state, demand, header, clear: clearAll }),
    [state, demand, header, clearAll]
  );

  return <NavIdentityContext.Provider value={value}>{children}</NavIdentityContext.Provider>;
}

/** Shared signed-in identity. Starts the load on first use. */
export function useNavIdentity(options?: { header?: boolean }): NavIdentityState & { clear: () => void } {
  const ctx = useContext(NavIdentityContext);
  const isHeader = !!options?.header;
  const { demand, header } = ctx;
  useEffect(() => (isHeader ? header() : demand()), [isHeader, demand, header]);
  return ctx;
}
