'use client';

import React, { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { LandingPage } from '@/components/landing/LandingPage';
import { hasBrowserAuthHint } from '@/lib/auth-session';
import { shouldShowHomeDashboardSplash } from '@/lib/home-splash';

const HomeDashboard = dynamic(
  () => import('@/components/home/HomeDashboard').then((m) => m.HomeDashboard),
  { ssr: false },
);

/**
 * Logged-out first paint is the marketing landing (SSR + crawlers).
 * A localStorage session hint swaps in the authenticated dashboard chunk.
 * getSession lives in HomeDashboard so that query stays out of the landing bundle.
 */
export default function HomePage() {
  const [authHint, setAuthHint] = useState(false);
  const [forceLanding, setForceLanding] = useState(false);

  useEffect(() => {
    setAuthHint(hasBrowserAuthHint());
  }, []);

  const onNoUser = useCallback(() => setForceLanding(true), []);
  const showDashboardSplash = shouldShowHomeDashboardSplash(
    true,
    false,
    authHint && !forceLanding,
  );

  if (showDashboardSplash) {
    return <HomeDashboard onNoUser={onNoUser} />;
  }

  return <LandingPage />;
}
