'use client';

import React, { useEffect, useState } from 'react';
import { adsenseAllowedOnHost } from '@/lib/adsense-host';
import { hasBrowserAuthHint } from '@/lib/auth-session';

/**
 * Keep AdSense + the auth lookup off the logged-out marketing landing.
 * Imperative import() so the AdBanner chunk is not prefetched for guests.
 * Logged-in free-tier users still get the banner after idle (or a short timeout).
 */
export function AdBannerGate() {
  const [Banner, setBanner] = useState<React.ComponentType | null>(null);

  useEffect(() => {
    if (!adsenseAllowedOnHost(window.location.hostname)) return;
    if (!hasBrowserAuthHint()) return;

    let cancelled = false;
    const start = () => {
      import('./AdBanner').then((mod) => {
        if (!cancelled) setBanner(() => mod.default);
      });
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(start, { timeout: 4000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(id);
      };
    }
    const t = window.setTimeout(start, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  if (!Banner) return null;
  return <Banner />;
}
