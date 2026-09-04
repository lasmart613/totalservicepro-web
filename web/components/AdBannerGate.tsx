'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { adsenseAllowedOnHost } from '@/lib/adsense';
import { hasBrowserAuthHint } from '@/lib/auth-session';

const AdBanner = dynamic(() => import('./AdBanner'), { ssr: false });

/**
 * Keep AdSense + the auth lookup off the logged-out marketing landing.
 * Logged-in free-tier users still get the banner after idle (or a short timeout).
 */
export function AdBannerGate() {
  const [load, setLoad] = useState(false);

  useEffect(() => {
    if (!adsenseAllowedOnHost(window.location.hostname)) return;
    if (!hasBrowserAuthHint()) return;

    const start = () => setLoad(true);
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(start, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = window.setTimeout(start, 1200);
    return () => window.clearTimeout(t);
  }, []);

  if (!load) return null;
  return <AdBanner />;
}
