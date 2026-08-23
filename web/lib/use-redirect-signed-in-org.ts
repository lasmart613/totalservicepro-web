'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { shouldPreserveSessionForExistingOrg } from '@/lib/org-plan';

/**
 * If this browser already has an organization, leave the public register
 * forms. Upgrade happens on /plans without clearing the session.
 */
export function useRedirectSignedInOrgToPlans() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();
      if (shouldPreserveSessionForExistingOrg(profile?.organization_id) && !cancelled) {
        router.replace('/plans');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);
}
