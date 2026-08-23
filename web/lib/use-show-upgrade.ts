'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from './supabase/client';
import { orgIsPaid } from './org-plan';

/**
 * True only after the signed-in org is known to be free (not paid).
 * Hidden while loading, signed out, or paid.
 */
export function useShowUpgrade(): boolean {
  const [show, setShow] = useState(false);
  const supabase = getSupabaseClient();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) setShow(false);
          return;
        }

        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user.id)
          .maybeSingle();
        if (!profile?.organization_id) {
          if (!cancelled) setShow(false);
          return;
        }

        const orgId = profile.organization_id;
        let { data: org, error } = await supabase
          .from('organizations')
          .select('is_premium, subscription_tier, plan')
          .eq('id', orgId)
          .maybeSingle();
        if (error && /subscription_tier|plan|column/i.test(error.message || '')) {
          ({ data: org, error } = await supabase
            .from('organizations')
            .select('is_premium, subscription_tier')
            .eq('id', orgId)
            .maybeSingle());
        }
        if (error && /subscription_tier|column/i.test(error.message || '')) {
          ({ data: org } = await supabase
            .from('organizations')
            .select('is_premium')
            .eq('id', orgId)
            .maybeSingle());
        }
        if (!cancelled) setShow(!orgIsPaid(org));
      } catch {
        if (!cancelled) setShow(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return show;
}
