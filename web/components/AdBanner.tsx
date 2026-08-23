'use client';

import React, { useEffect, useState } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { getSupabaseClient } from '../lib/supabase/client';
import {
  ADSENSE_CLIENT,
  ADSENSE_SCRIPT_SRC,
  ADSENSE_SLOT,
  onboardingFlagsDone,
  orgIsPaid,
  pathHidesAds,
} from '../lib/adsense';

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
 * Hidden for premium/paid orgs, incomplete onboarding, /signup /onboarding /auth /login,
 * and any logged-out marketing chrome.
 *
 * adsbygoogle.js must live here — not the root layout. A global script lets
 * Google auto-ads inject hidden 0x0 units on public pages even when this
 * banner returns null.
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

        let { data: profile, error: profileErr } = await supabase
          .from('user_profiles')
          .select('organization_id, onboarding_completed, onboarding_completed_at')
          .eq('id', user.id)
          .maybeSingle();
        if (profileErr && /onboarding_completed_at|column/i.test(profileErr.message || '')) {
          ({ data: profile, error: profileErr } = await supabase
            .from('user_profiles')
            .select('organization_id, onboarding_completed')
            .eq('id', user.id)
            .maybeSingle());
        }
        if (cancelled) return;

        // Company-admin (and any) onboarding — never show ads until setup is done.
        if (!profile?.organization_id || !onboardingFlagsDone(profile)) {
          setShowAd(false);
          return;
        }

        let { data: org, error: orgErr } = await supabase
          .from('organizations')
          .select('is_premium, subscription_tier')
          .eq('id', profile.organization_id)
          .maybeSingle();
        if (orgErr && /subscription_tier|column/i.test(orgErr.message || '')) {
          ({ data: org } = await supabase
            .from('organizations')
            .select('is_premium')
            .eq('id', profile.organization_id)
            .maybeSingle());
        }
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
        src={ADSENSE_SCRIPT_SRC}
        crossOrigin="anonymous"
        strategy="afterInteractive"
        onLoad={pushAdSlot}
      />
    </div>
  );
}
