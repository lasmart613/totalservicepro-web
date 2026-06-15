'use client';

import React, { useEffect, useState } from 'react';
import { getSupabaseClient } from '../lib/supabase/client';

export default function AdBanner() {
  const [showAd, setShowAd] = useState(false);
  const [loading, setLoading] = useState(true);
  const supabase = getSupabaseClient();

  useEffect(() => {
    const checkPremiumStatus = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setShowAd(true);
          return;
        }

        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user.id)
          .single();

        if (profile?.organization_id) {
          const { data: org } = await supabase
            .from('organizations')
            .select('is_premium')
            .eq('id', profile.organization_id)
            .single();

          setShowAd(!org?.is_premium);
        } else {
          setShowAd(true);
        }
      } catch (error) {
        console.error('Error checking premium status:', error);
        setShowAd(true);
      } finally {
        setLoading(false);
      }
    };

    checkPremiumStatus();
  }, [supabase]);

  if (loading || !showAd) {
    return null;
  }

  return (
    <div className="my-6 flex justify-center">
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client="ca-pub-5353320292042327"
        data-ad-slot="1955313486"
        data-ad-format="auto"
        data-full-width-responsive="true"
      ></ins>
      <script>
        (adsbygoogle = window.adsbygoogle || []).push({});
      </script>
    </div>
  );
}