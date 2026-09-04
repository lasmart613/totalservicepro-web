/** Larry's TSP-Web unit — same publisher as Android AdMob. Do not invent a new slot. */
export const ADSENSE_CLIENT = 'ca-pub-5353320292042327';
export const ADSENSE_SLOT = '8443570568';

export { adsenseAllowedOnHost } from './adsense-host';

export { PAID_SUBSCRIPTION_TIERS, orgIsPaid } from './org-plan';

export function onboardingFlagsDone(profile: {
  onboarding_completed?: boolean | null;
  onboarding_completed_at?: string | null;
} | null): boolean {
  if (!profile) return false;
  if (profile.onboarding_completed === true) return true;
  return Boolean(profile.onboarding_completed_at);
}
