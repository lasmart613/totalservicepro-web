'use client';

import { useLayoutEffect } from 'react';
import { applyStoredTheme, subscribeThemeSync } from '@/lib/theme';

/** Re-apply after hydration and keep other tabs / system preference in sync. */
export function ThemeSync() {
  useLayoutEffect(() => {
    applyStoredTheme();
    return subscribeThemeSync();
  }, []);
  return null;
}
