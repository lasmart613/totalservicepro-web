'use client';

import React, { useEffect, useState } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { getSupabaseClient } from '../lib/supabase/client';

/** Same publisher / slot as Android AdMob top banner + existing AdSense client. */
const ADSENSE_CLIENT = 'ca-pub-5353320292042327';
const ADSENSE_SLOT = '1955313486';

const HIDDEN_PREFIXES = ['/signup', '/onboarding', '/auth', '/login'];

function pathHidesAds(pathname: string): boolean {
  if (!pathname) return true;
  return HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function orgIsPaid(org: { is_premium?: boolean | null; subscription_tier?: string | null } | null): boolean {
  if (!org) return false;
  if (org.is_premium) return true;
  const tier = String(org.subscription_tier || '').toLowerCase();
  return /premium|team|enterprise|pro/.test(tier);
}

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * Top AdSense banner for logged-in free-tier users.
 * Hidden for premium/paid orgs, incomplete onboarding, /signup /onboarding /auth,
 * and any logged-out marketing chrome.
 */
export default function AdBanner() {
  const pathname = usePathname() || '';
  const [showAd, setShowAd] = useState(false);
  const supabase = getSupabaseClient();

  useEffect(() => {
    let cancelled = false;

    if (pathHidesAds(pathname)) {
      setShowAd(false);
      return;
    }

    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled) return;
        if (!user) {
          setShowAd(false);
          return;
        }

        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id, onboarding_completed')
          .eq('id', user.id)
          .maybeSingle();
        if (cancelled) return;

        // Company-admin (and any) onboarding — never show ads until setup is done.
        if (!profile?.organization_id || profile.onboarding_completed !== true) {
          setShowAd(false);
          return;
        }

        const { data: org } = await supabase
          .from('organizations')
          .select('is_premium, subscription_tier')
          .eq('id', profile.organization_id)
          .maybeSingle();
        if (cancelled) return;

        setShowAd(!orgIsPaid(org));
      } catch {
        if (!cancelled) setShowAd(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, supabase]);

  useEffect(() => {
    if (!showAd) return;
    const t = window.setTimeout(() => {
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch {
        /* AdSense may throw if the slot was already filled */
      }
    }, 80);
    return () => window.clearTimeout(t);
  }, [showAd]);

  if (!showAd) return null;

  return (
    <div
      className="w-full shrink-0 border-b border-[var(--border)] bg-[var(--surface)] flex justify-center"
      data-tsp-ad-banner="1"
    >
      <ins
        className="adsbygoogle"
        style={{ display: 'block', width: '100%', minHeight: 50 }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={ADSENSE_SLOT}
        data-ad-format="horizontal"
        data-full-width-responsive="true"
      />
      <Script
        async
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
        crossOrigin="anonymous"
        strategy="afterInteractive"
      />
    </div>
  );
}
