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
  manual_slots?: number | null;
};

/** Free default already in /manuals. Premium is 15. Team/Enterprise is unlimited. */
export const FREE_MANUAL_SLOTS = 5;
export const PREMIUM_MANUAL_SLOTS = 15;
export const UNLIMITED_MANUAL_SLOTS = 999;

/**
 * Chrome visibility + which /plans Checkout button may run.
 * Free and Premium chrome always navigate to /plans (never Checkout).
 * 'team' means the org may start Team Checkout from /plans only.
 * Top → hide Upgrade.
 */
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

/** Named plan shown on /plans. "pro" is not paid and stays Free. */
export type NamedOrgPlan = 'free' | 'premium' | 'team' | 'enterprise';

/**
 * Current org plan from is_premium + exact plan/subscription_tier.
 * Top tiers win by exact name. Other paid (including is_premium) is Premium.
 */
export function currentOrgPlan(org: OrgPlanFields | null | undefined): NamedOrgPlan {
  if (!org) return 'free';
  const tier = exactName(org.subscription_tier);
  const plan = exactName(org.plan);
  if (isExactName(tier, TOP_PAID_TIERS)) return tier as 'team' | 'enterprise';
  if (isExactName(plan, TOP_PAID_TIERS)) return plan as 'team' | 'enterprise';
  if (orgIsPaid(org)) return 'premium';
  return 'free';
}

export function currentOrgPlanLabel(org: OrgPlanFields | null | undefined): string {
  const plan = currentOrgPlan(org);
  if (plan === 'free') return 'Free';
  if (plan === 'premium') return 'Premium';
  if (plan === 'team') return 'Team';
  return 'Enterprise';
}

/**
 * Whether Upgrade chrome is shown, and which /plans button may start Checkout.
 * Null = hide (Team / Enterprise). Free → Premium or Team on /plans.
 * Paid-but-not-top → Team button on /plans only. Chrome href is always /plans.
 */
export function upgradeTargetForOrg(org: OrgPlanFields | null | undefined): UpgradeTarget | null {
  if (orgIsTopPaid(org)) return null;
  if (orgIsPaid(org)) return 'team';
  return 'plans';
}

export function orgCanUpgrade(org: OrgPlanFields | null | undefined): boolean {
  return upgradeTargetForOrg(org) != null;
}

/** Dashboard / company / admin Upgrade always opens /plans, never Checkout. */
export function upgradeChromeHrefForOrg(org: OrgPlanFields | null | undefined): '/plans' | null {
  return orgCanUpgrade(org) ? '/plans' : null;
}

/** Free may start Premium or Team. Mid-tier may start Team only. Top cannot. */
export function isUnlimitedManualSlots(limit: number): boolean {
  return Number.isFinite(limit) && limit >= UNLIMITED_MANUAL_SLOTS;
}

/**
 * Library slots from paid detection. Premium is 15 even if a stale
 * manual_slots row says 999. "pro" is not paid and stays on the free default.
 */
export function manualSlotLimit(org: OrgPlanFields | null | undefined): number {
  if (orgIsTopPaid(org)) return UNLIMITED_MANUAL_SLOTS;
  if (orgIsPaid(org)) return PREMIUM_MANUAL_SLOTS;
  const stored = org?.manual_slots;
  if (stored != null) {
    const n = parseInt(String(stored), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return FREE_MANUAL_SLOTS;
}

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
