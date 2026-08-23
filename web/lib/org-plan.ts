/** Exact paid plan names. "pro" is the product name, not a paid enum. */
export const PAID_SUBSCRIPTION_TIERS = ['premium', 'team', 'enterprise'] as const;
/** Mid tier can still Upgrade to Team. */
export const MID_PAID_TIERS = ['premium'] as const;
/** Top paid tiers hide Upgrade. */
export const TOP_PAID_TIERS = ['team', 'enterprise'] as const;

export type OrgPlanFields = {
  is_premium?: boolean | null;
  subscription_tier?: string | null;
  plan?: string | null;
};

/** Free → /plans. Mid (Premium) → Team checkout. Top → hide Upgrade. */
export type UpgradeTarget = 'plans' | 'team';

function exactName(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .trim();
}

function isExactName(value: unknown, allowed: readonly string[]): boolean {
  return allowed.includes(exactName(value));
}

function isExactPaidName(value: unknown): boolean {
  return isExactName(value, PAID_SUBSCRIPTION_TIERS);
}

/**
 * Paid detection from PR #22: is_premium === true OR plan/tier exactly
 * premium | team | enterprise. Do not treat "pro" as paid.
 */
export function orgIsPaid(org: OrgPlanFields | null | undefined): boolean {
  if (!org) return false;
  if (org.is_premium === true) return true;
  return isExactPaidName(org.subscription_tier) || isExactPaidName(org.plan);
}

/** Team or Enterprise by exact plan/tier name only. "pro" is not top-tier. */
export function orgIsTopPaid(org: OrgPlanFields | null | undefined): boolean {
  if (!org) return false;
  return isExactName(org.subscription_tier, TOP_PAID_TIERS) || isExactName(org.plan, TOP_PAID_TIERS);
}

/**
 * Where signed-in Upgrade should go. Null = hide (Team / Enterprise).
 * Free → /plans. Paid-but-not-top (Premium or is_premium) → Team checkout.
 */
export function upgradeTargetForOrg(org: OrgPlanFields | null | undefined): UpgradeTarget | null {
  if (orgIsTopPaid(org)) return null;
  if (orgIsPaid(org)) return 'team';
  return 'plans';
}

export function orgCanUpgrade(org: OrgPlanFields | null | undefined): boolean {
  return upgradeTargetForOrg(org) != null;
}

/** Free may start Premium or Team. Mid-tier may start Team only. Top cannot. */
export function orgMayStartPaidPlan(
  org: OrgPlanFields | null | undefined,
  plan: string
): boolean {
  const name = exactName(plan);
  if (name !== 'premium' && name !== 'team') return false;
  const target = upgradeTargetForOrg(org);
  if (target === null) return false;
  if (target === 'team') return name === 'team';
  return true;
}

/**
 * True when this browser already has an organization to upgrade.
 * Viewing /plans or starting checkout must never clear that session.
 */
export function shouldPreserveSessionForExistingOrg(
  organizationId: string | number | null | undefined
): boolean {
  if (organizationId == null) return false;
  return String(organizationId).trim() !== '';
}
