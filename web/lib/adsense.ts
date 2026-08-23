/** Larry's TSP-Web unit — same publisher as Android AdMob. Do not invent a new slot. */
export const ADSENSE_CLIENT = 'ca-pub-5353320292042327';
export const ADSENSE_SLOT = '8443570568';
export const ADSENSE_SCRIPT_SRC = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;

/** Public / auth routes must never load adsbygoogle.js (auto-ads injects hidden units). */
export const AD_HIDDEN_PREFIXES = ['/signup', '/onboarding', '/auth', '/login'] as const;

export function pathHidesAds(pathname: string): boolean {
  if (!pathname) return true;
  return AD_HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Exact paid plan names. "pro" is the product name, not a paid enum. */
export const PAID_SUBSCRIPTION_TIERS = ['premium', 'team', 'enterprise'] as const;

export function orgIsPaid(
  org: { is_premium?: boolean | null; subscription_tier?: string | null } | null
): boolean {
  if (!org) return false;
  if (org.is_premium === true) return true;
  const tier = String(org.subscription_tier || '')
    .toLowerCase()
    .trim();
  return (PAID_SUBSCRIPTION_TIERS as readonly string[]).includes(tier);
}

export function onboardingFlagsDone(profile: {
  onboarding_completed?: boolean | null;
  onboarding_completed_at?: string | null;
} | null): boolean {
  if (!profile) return false;
  if (profile.onboarding_completed === true) return true;
  return Boolean(profile.onboarding_completed_at);
}
