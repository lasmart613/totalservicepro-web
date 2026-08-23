'use client';

import { useLayoutEffect } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { applyStoredTheme, subscribeThemeSync } from '@/lib/theme';

/** Re-apply after hydration and keep other tabs / system preference / auth in sync. */
export function ThemeSync() {
  useLayoutEffect(() => {
    applyStoredTheme();
    const unsubTheme = subscribeThemeSync();
    const supabase = getSupabaseClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      applyStoredTheme();
    });
    return () => {
      unsubTheme();
      subscription.unsubscribe();
    };
  }, []);
  return null;
}
