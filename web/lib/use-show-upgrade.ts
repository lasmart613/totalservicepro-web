'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from './supabase/client';
import { upgradeTargetForOrg, type UpgradeTarget } from './org-plan';

export type UpgradeEntry = {
  show: boolean;
  target: UpgradeTarget;
};

/**
 * Free and Premium / is_premium → show Upgrade chrome that goes to /plans.
 * Team / Enterprise → hide.
 * Hidden while loading or signed out. Never starts Stripe Checkout.
 */
export function useUpgradeEntry(): UpgradeEntry {
  const [entry, setEntry] = useState<UpgradeEntry>({ show: false, target: 'plans' });
  const supabase = getSupabaseClient();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) setEntry({ show: false, target: 'plans' });
          return;
        }

        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user.id)
          .maybeSingle();
        if (!profile?.organization_id) {
          if (!cancelled) setEntry({ show: false, target: 'plans' });
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
        const target = upgradeTargetForOrg(org);
        if (!cancelled) {
          setEntry({
            show: target != null,
            target: target || 'plans',
          });
        }
      } catch {
        if (!cancelled) setEntry({ show: false, target: 'plans' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return entry;
}

/** True only after the signed-in org is known to be free or mid-tier (Premium). */
export function useShowUpgrade(): boolean {
  return useUpgradeEntry().show;
}
