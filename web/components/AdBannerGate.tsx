'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { adsenseAllowedOnHost } from '@/lib/adsense-host';
import { hasBrowserAuthHint } from '@/lib/auth-session';

/**
 * Keep AdSense + the auth lookup off the logged-out marketing landing.
 * Imperative import() so the AdBanner chunk is not prefetched for guests.
 * Logged-in free-tier users still get the banner after idle (or a short timeout).
 *
 * Re-checks the auth hint on every client-side navigation: sign-in stores the
 * token on /login and then moves to / without a full load, so a mount-only
 * check missed the first page after sign-in.
 */
export function AdBannerGate() {
  const pathname = usePathname();
  const [Banner, setBanner] = useState<React.ComponentType | null>(null);
  // Set once the AdBanner import starts, so later navigations don't reload it.
  const loading = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (loading.current) return;
    if (!adsenseAllowedOnHost(window.location.hostname)) return;
    if (!hasBrowserAuthHint()) return;

    let cancelled = false;
    const start = () => {
      if (cancelled || loading.current) return;
      loading.current = true;
      // A navigation after this point must not drop the banner: only an
      // unmount does.
      import('./AdBanner').then((mod) => {
        if (mounted.current) setBanner(() => mod.default);
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
  }, [pathname]);

  if (!Banner) return null;
  return <Banner />;
}
