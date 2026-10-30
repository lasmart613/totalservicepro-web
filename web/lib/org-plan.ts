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
  premium_until?: string | null;
  premium_grant?: string | null;
};

/** Free is 10. Premium is 15. Team is 50. Enterprise stays unlimited (999). */
export const FREE_MANUAL_SLOTS = 10;
export const PREMIUM_MANUAL_SLOTS = 15;
export const TEAM_MANUAL_SLOTS = 50;
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

export function orgHasNamedPaidPlan(org: OrgPlanFields | null | undefined): boolean {
  if (!org) return false;
  return isExactPaidName(org.subscription_tier) || isExactPaidName(org.plan);
}

/** True when complimentary premium_until is present and in the past. */
export function complimentaryPremiumExpired(
  org: OrgPlanFields | null | undefined,
  now: Date = new Date()
): boolean {
  if (!org?.premium_until) return false;
  const until = Date.parse(String(org.premium_until));
  if (!Number.isFinite(until)) return false;
  return until <= now.getTime();
}

/**
 * Paid detection from PR #22: is_premium === true OR plan/tier exactly
 * premium | team | enterprise. Do not treat "pro" as paid.
 * Expired complimentary (premium_until in the past) is Free unless a named
 * paid plan remains — that protects Stripe / legacy paid orgs.
 */
export function orgIsPaid(org: OrgPlanFields | null | undefined, now: Date = new Date()): boolean {
  if (!org) return false;
  if (complimentaryPremiumExpired(org, now)) return orgHasNamedPaidPlan(org);
  if (org.is_premium === true) return true;
  return orgHasNamedPaidPlan(org);
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
  // Team is capped at 50; orgs already over keep every manual (only new adds block).
  if (orgIsTopPaid(org)) {
    return currentOrgPlan(org) === 'team' ? TEAM_MANUAL_SLOTS : UNLIMITED_MANUAL_SLOTS;
  }
  if (orgIsPaid(org)) return PREMIUM_MANUAL_SLOTS;
  // Free orgs get at least FREE_MANUAL_SLOTS. A stored manual_slots row that
  // is higher (a grant, e.g. 7) is kept; a stale lower one (old default 5)
  // is raised. Nothing is ever revoked: the cap only blocks new adds.
  const stored = org?.manual_slots;
  if (stored != null) {
    const n = parseInt(String(stored), 10);
    if (Number.isFinite(n) && n > FREE_MANUAL_SLOTS) return n;
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

/** Where library-full and seat-limit nudges send people. */
export const MANUAL_UPGRADE_PATH = '/plans';

/**
 * True when a NEW library add must be refused. Over-cap libraries (e.g. 12 of
 * 10 after a downgrade) keep every saved manual and can still open them; the
 * cap only blocks the next add.
 */
export function libraryAddBlocked(used: number, cap: number): boolean {
  if (isUnlimitedManualSlots(cap)) return false;
  return Math.max(0, Number(used) || 0) >= cap;
}

/** "You're using 12 of 10 free slots — upgrade to add more." (English only for now.) */
export function libraryFullMessage(used: number, cap: number, freePlan: boolean): string {
  const n = Math.max(0, Number(used) || 0);
  return `You're using ${n} of ${cap} ${freePlan ? 'free ' : ''}slots — upgrade to add more.`;
}

/** Seats: Free and Premium are single-user; Team (and Enterprise) get 10. */
export const SOLO_SEAT_LIMIT = 1;
export const TEAM_SEAT_LIMIT = 10;

export function orgSeatLimit(org: OrgPlanFields | null | undefined, now: Date = new Date()): number {
  // An expired complimentary window drops to 1 even if the tier name says team.
  return orgIsPaid(org, now) && orgIsTopPaid(org) && !complimentaryPremiumExpired(org, now)
    ? TEAM_SEAT_LIMIT
    : SOLO_SEAT_LIMIT;
}

/** New members are refused at or over the cap. Existing members are never removed. */
export function seatAddBlocked(used: number, limit: number): boolean {
  return Math.max(0, Number(used) || 0) >= limit;
}

export function seatLimitMessage(used: number, limit: number): string {
  const n = Math.max(0, Number(used) || 0);
  const word = limit === 1 ? 'seat' : 'seats';
  return limit >= TEAM_SEAT_LIMIT
    ? `You're using ${n} of ${limit} ${word} — contact us for more.`
    : `You're using ${n} of ${limit} ${word} — upgrade to Team to add more people.`;
}
