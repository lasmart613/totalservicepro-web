'use client';

import { useEffect } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { normalizeAndroidSession, persistableAndroidSession } from '@/lib/android-session';

type AndroidBridge = {
  saveSession?: (json: string) => void;
  getStoredSession?: () => string;
  clearSession?: () => void;
};

function androidBridge(): AndroidBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as Window & { Android?: AndroidBridge }).Android;
  if (!bridge || typeof bridge.saveSession !== 'function') return null;
  return bridge;
}

async function applyTokens(
  supabase: ReturnType<typeof getSupabaseClient>,
  raw: unknown
): Promise<boolean> {
  const tokens = normalizeAndroidSession(raw);
  if (!tokens?.access_token) return false;
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
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) {
        try {
          bridge?.saveSession?.(JSON.stringify(data.session));
        } catch {
          /* ignore */
        }
        return true;
      }
      const stored = raw ?? bridge?.getStoredSession?.();
      if (!stored) return false;
      return applyTokens(supabase, stored);
    };

    (window as Window & { __tspRestoreAndroidSession?: (raw: unknown) => Promise<boolean> }).__tspRestoreAndroidSession =
      restore;

    void restore();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!bridge) return;
      try {
        if (session?.access_token) {
          bridge.saveSession?.(JSON.stringify(session));
        } else if (event === 'SIGNED_OUT') {
          bridge.clearSession?.();
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
