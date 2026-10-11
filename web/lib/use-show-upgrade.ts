'use client';

import { useNavIdentity } from '@/components/NavIdentityProvider';
import { upgradeTargetForOrg, type UpgradeTarget } from './org-plan';

export type UpgradeEntry = {
  show: boolean;
  target: UpgradeTarget;
};

const HIDDEN: UpgradeEntry = { show: false, target: 'plans' };

/**
 * Free and Premium / is_premium → show Upgrade chrome that goes to /plans.
 * Team / Enterprise → hide.
 * Hidden while loading or signed out. Never starts Stripe Checkout.
 * Reads the home org from NavIdentityProvider (no reads of its own).
 */
export function useUpgradeEntry(): UpgradeEntry {
  const nav = useNavIdentity();
  if (!nav.ready || !nav.user || !nav.profile?.organization_id) return HIDDEN;
  const org =
    nav.homeOrg && String(nav.homeOrg.id) === String(nav.profile.organization_id) ? nav.homeOrg : null;
  // A missing org row resolved to /plans before too.
  const target = upgradeTargetForOrg(org);
  return { show: target != null, target: target || 'plans' };
}

/** True only after the signed-in org is known to be free or mid-tier (Premium). */
export function useShowUpgrade(): boolean {
  return useUpgradeEntry().show;
}
