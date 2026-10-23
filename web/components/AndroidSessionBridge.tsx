'use client';

import { useEffect } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { androidSessionIsFresh, normalizeAndroidSession, persistableAndroidSession } from '@/lib/android-session';

type AndroidBridge = {
  saveSession?: (json: string) => void;
  clearSession?: () => void;
};

type TspNativeChannel = {
  postMessage: (message: string) => void;
  onmessage: ((event: { data?: string }) => void) | null;
};

function androidBridge(): AndroidBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as Window & { Android?: AndroidBridge }).Android;
  if (!bridge || typeof bridge.saveSession !== 'function') return null;
  return bridge;
}

function tspNative(): TspNativeChannel | null {
  if (typeof window === 'undefined') return null;
  const channel = (window as Window & { tspNative?: TspNativeChannel }).tspNative;
  if (!channel || typeof channel.postMessage !== 'function') return null;
  return channel;
}

function postToOriginLockedBridge(payload: Record<string, unknown>): boolean {
  const channel = tspNative();
  if (!channel) return false;
  try {
    channel.postMessage(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function requestStoredSession(): Promise<string | null> {
  const channel = tspNative();
  if (!channel) return Promise.resolve(null);
  return new Promise((resolve) => {
    const previous = channel.onmessage;
    const timer = window.setTimeout(() => {
      channel.onmessage = previous;
      resolve(null);
    }, 1500);
    channel.onmessage = (event) => {
      window.clearTimeout(timer);
      channel.onmessage = previous;
      const data = typeof event?.data === 'string' ? event.data : '';
      resolve(data.includes('access_token') ? data : null);
    };
    try {
      channel.postMessage(JSON.stringify({ m: 'getStoredSession' }));
    } catch {
      window.clearTimeout(timer);
      channel.onmessage = previous;
      resolve(null);
    }
  });
}

async function applyTokens(
  supabase: ReturnType<typeof getSupabaseClient>,
  raw: unknown
): Promise<boolean> {
  const tokens = normalizeAndroidSession(raw);
  if (!tokens?.access_token || !androidSessionIsFresh(raw)) return false;
  try {
    localStorage.setItem('tsp-auth-token', persistableAndroidSession(tokens));
  } catch {
    /* private mode */
  }
  const { error } = await supabase.auth.setSession({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || '',
  });
  return !error;
}

/**
 * Keeps the Android SharedPreferences session in sync with the live site.
 * Also restores a biometric/native-stored session onto the Next.js Supabase client.
 */
export function AndroidSessionBridge() {
  useEffect(() => {
    const supabase = getSupabaseClient();
    const bridge = androidBridge();

    const restore = async (raw?: unknown) => {
      if (raw) return applyTokens(supabase, raw);
      const stored = await requestStoredSession();
      if (stored) return applyTokens(supabase, stored);
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) {
        const json = JSON.stringify(data.session);
        if (!postToOriginLockedBridge({ m: 'saveSession', json })) {
          try {
            bridge?.saveSession?.(json);
          } catch {
            /* ignore */
          }
        }
        return true;
      }
      return false;
    };

    (window as Window & { __tspRestoreAndroidSession?: (raw: unknown) => Promise<boolean> }).__tspRestoreAndroidSession =
      restore;

    void restore();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!bridge && !tspNative()) return;
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
      try {
        if (session?.access_token) {
          const json = JSON.stringify(session);
          if (!postToOriginLockedBridge({ m: 'saveSession', json })) {
            bridge.saveSession?.(json);
          }
        } else if (event === 'SIGNED_OUT') {
          if (!postToOriginLockedBridge({ m: 'clearSession' })) {
            bridge.clearSession?.();
          }
        }
      } catch {
        /* ignore */
      }
    });

    return () => {
      subscription.unsubscribe();
      delete (window as Window & { __tspRestoreAndroidSession?: unknown }).__tspRestoreAndroidSession;
    };
  }, []);

  return null;
}
