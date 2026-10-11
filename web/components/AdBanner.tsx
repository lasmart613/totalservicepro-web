'use client';

import React, { useEffect } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useNavIdentity } from '@/components/NavIdentityProvider';
import {
  ADSENSE_CLIENT,
  ADSENSE_SLOT,
  adsenseAllowedOnHost,
  onboardingFlagsDone,
  orgIsPaid,
} from '../lib/adsense';

const HIDDEN_PREFIXES = ['/signup', '/onboarding', '/auth', '/login'];

function pathHidesAds(pathname: string): boolean {
  if (!pathname) return true;
  return HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

function pushAdSlot() {
  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch {
    /* AdSense may throw if the slot was already filled */
  }
}

/**
 * Top AdSense banner for logged-in free-tier users.
 * Hidden for premium/paid orgs, incomplete onboarding, /signup /onboarding /auth,
 * and any logged-out marketing chrome.
 */
export default function AdBanner() {
  const pathname = usePathname() || '';
  // Profile and home org come from NavIdentityProvider, which reloads them on
  // every navigation; this banner makes no reads of its own.
  const nav = useNavIdentity();
  const hidden = typeof window === 'undefined' || pathHidesAds(pathname) || !adsenseAllowedOnHost(window.location.hostname);
  const profile = nav.profile;
  const org = nav.homeOrg;
  const showAd =
    !hidden &&
    nav.ready &&
    !!nav.user &&
    !!profile?.organization_id &&
    // Company-admin (and any) onboarding: never show ads until setup is done.
    onboardingFlagsDone(profile) &&
    // A missing org row showed the ad before too.
    !orgIsPaid(org && String(org.id) === String(profile.organization_id) ? org : null);

  useEffect(() => {
    if (!showAd) return;
    const t = window.setTimeout(pushAdSlot, 300);
    return () => window.clearTimeout(t);
  }, [showAd, pathname]);

  if (!showAd) return null;

  return (
    <div
      className="w-full shrink-0 border-b border-[var(--border)] bg-[var(--surface)] flex justify-center"
      data-tsp-ad-banner="1"
      style={{ minHeight: 90 }}
    >
      <ins
        className="adsbygoogle"
        style={{ display: 'block', width: '100%', minHeight: 90 }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={ADSENSE_SLOT}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
      <Script
        id="tsp-adsense"
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
        crossOrigin="anonymous"
        strategy="lazyOnload"
        onLoad={pushAdSlot}
      />
    </div>
  );
}
