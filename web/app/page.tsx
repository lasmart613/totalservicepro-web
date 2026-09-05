'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { LandingPage } from '@/components/landing/LandingPage';
import { hasBrowserAuthHint } from '@/lib/auth-session';
import { shouldShowHomeDashboardSplash } from '@/lib/home-splash';

type DashboardComponent = ComponentType<{ onNoUser?: () => void }>;

/**
 * Logged-out first paint is the marketing landing (SSR + crawlers).
 * A localStorage session hint lazy-loads the authenticated dashboard chunk.
 * Imperative import() so webpack does not prefetch the dashboard chunk
 * Header / tickets / lucide onto the marketing landing.
 * getSession lives in HomeDashboard so that query stays out of the landing bundle.
 */
export default function HomePage() {
  const [authHint, setAuthHint] = useState(false);
  const [forceLanding, setForceLanding] = useState(false);
  const [Dashboard, setDashboard] = useState<DashboardComponent | null>(null);

  useEffect(() => {
    const hint = hasBrowserAuthHint();
    setAuthHint(hint);
    if (!hint) return;
    let cancelled = false;
    import('@/components/home/HomeDashboard').then((mod) => {
      if (!cancelled) setDashboard(() => mod.HomeDashboard);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onNoUser = useCallback(() => setForceLanding(true), []);
  const showDashboardSplash = shouldShowHomeDashboardSplash(
    true,
    false,
    authHint && !forceLanding,
  );

  if (showDashboardSplash) {
    if (!Dashboard) {
      return (
        <div className="min-h-screen flex flex-col">
          <div className="flex-1 flex items-center justify-center text-[var(--text3)]">
            Loading dashboard...
          </div>
        </div>
      );
    }
    return <Dashboard onNoUser={onNoUser} />;
  }

  return <LandingPage />;
}
