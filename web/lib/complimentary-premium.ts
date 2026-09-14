/**
 * Time-boxed complimentary Premium for service_company orgs.
 * Soft beta / shop-invite: "Two months of Premium on us."
 *
 * Never set is_premium=true without a real premium_until.
 * Never expire orgs that lack premium_until (legacy / live paid).
 * Never expire orgs with an active paid Stripe subscription row.
 */

import {
  complimentaryPremiumExpired,
  orgHasNamedPaidPlan,
  type OrgPlanFields,
} from './org-plan.ts';
import { isServiceOrgType } from './org-types.ts';

export const COMPLIMENTARY_PREMIUM_DAYS = 60;
export const COMPLIMENTARY_PREMIUM_GRANT_SIGNUP = 'complimentary_signup';
export const COMPLIMENTARY_PREMIUM_GRANT_GOD = 'complimentary_god';

export type ComplimentaryPremiumSource = 'signup' | 'god';

export type ComplimentaryGrantSkip = 'not_service_company' | 'paid_stripe' | 'legacy_paid' | 'missing_org';

export type PaidStripeSubRow = {
  organization_id?: string | number | null;
  stripe_subscription_id?: string | null;
  status?: string | null;
};

export function isComplimentaryGrant(value: unknown): boolean {
  const v = String(value || '')
    .toLowerCase()
    .trim();
  return v === COMPLIMENTARY_PREMIUM_GRANT_SIGNUP || v === COMPLIMENTARY_PREMIUM_GRANT_GOD;
}

export function clampComplimentaryDays(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return COMPLIMENTARY_PREMIUM_DAYS;
  return Math.min(90, Math.max(1, Math.floor(n)));
}

export function complimentaryPremiumUntil(
  now: Date = new Date(),
  days: number = COMPLIMENTARY_PREMIUM_DAYS
): string {
  const ms = clampComplimentaryDays(days) * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() + ms).toISOString();
}

export function complimentaryPremiumGrantFields(input: {
  source: ComplimentaryPremiumSource;
  now?: Date;
  days?: number;
}): {
  is_premium: true;
  premium_until: string;
  premium_grant: string;
} {
  return {
    is_premium: true,
    premium_until: complimentaryPremiumUntil(input.now, input.days),
    premium_grant:
      input.source === 'god' ? COMPLIMENTARY_PREMIUM_GRANT_GOD : COMPLIMENTARY_PREMIUM_GRANT_SIGNUP,
  };
}

export function complimentaryPremiumExpiryFields(): {
  is_premium: false;
  premium_until: null;
  premium_grant: null;
} {
  return {
    is_premium: false,
    premium_until: null,
    premium_grant: null,
  };
}

/** New service_company rows get 60 days. Everyone else stays Free. */
export function applyComplimentarySignupFields(
  row: Record<string, unknown>,
  orgType: string | null | undefined,
  now?: Date
): Record<string, unknown> {
  if (isServiceOrgType(orgType)) {
    Object.assign(row, complimentaryPremiumGrantFields({ source: 'signup', now }));
  } else {
    row.is_premium = false;
    delete row.premium_until;
    delete row.premium_grant;
  }
  return row;
}

/**
 * If premium_until cannot be stored, do not leave a permanent is_premium flip.
 */
export function stripUnbackedComplimentaryPremium(row: Record<string, unknown>): Record<string, unknown> {
  delete row.premium_until;
  delete row.premium_grant;
  if (row.is_premium === true) row.is_premium = false;
  return row;
}

export function missingComplimentaryColumn(message?: string | null): boolean {
  return /premium_until|premium_grant/i.test(String(message || ''));
}

export function isActivePaidStripeSubscription(row: PaidStripeSubRow | null | undefined): boolean {
  if (!row) return false;
  const id = String(row.stripe_subscription_id || '').trim();
  if (!id.startsWith('sub_')) return false;
  const status = String(row.status || '')
    .toLowerCase()
    .trim();
  return status === 'active' || status === 'trialing' || status === 'past_due';
}

export function paidStripeOrganizationIds(rows: PaidStripeSubRow[] | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const row of rows || []) {
    if (!isActivePaidStripeSubscription(row)) continue;
    if (row.organization_id == null || row.organization_id === '') continue;
    out.add(String(row.organization_id));
  }
  return out;
}

/**
 * God grant: only service_company. Skip live paid Stripe and
 * is_premium=true rows that have no expiry (Larry / legacy paid).
 */
export function complimentaryGrantSkipReason(
  org: (OrgPlanFields & { type?: string | null }) | null | undefined,
  opts: { paidStripe?: boolean } = {}
): ComplimentaryGrantSkip | null {
  if (!org) return 'missing_org';
  if (!isServiceOrgType(org.type)) return 'not_service_company';
  if (opts.paidStripe) return 'paid_stripe';
  if (org.is_premium === true && !org.premium_until) return 'legacy_paid';
  return null;
}

/**
 * Drop complimentary Premium only when premium_until is in the past.
 * Paid Stripe and named paid plans without a complimentary grant stay put.
 */
export function shouldExpireComplimentaryPremium(
  org: OrgPlanFields | null | undefined,
  opts: { paidStripe?: boolean; now?: Date } = {}
): boolean {
  if (!org) return false;
  if (opts.paidStripe) return false;
  if (!complimentaryPremiumExpired(org, opts.now)) return false;
  if (orgHasNamedPaidPlan(org) && !isComplimentaryGrant(org.premium_grant)) return false;
  return true;
}

export function complimentaryGrantSkipMessage(reason: ComplimentaryGrantSkip): string {
  if (reason === 'not_service_company') return 'Only repair companies can receive complimentary Premium.';
  if (reason === 'paid_stripe') return 'Org has an active paid Stripe subscription.';
  if (reason === 'legacy_paid') {
    return 'Org is already Premium without an expiry (paid or legacy). Not converting to complimentary.';
  }
  return 'Organization not found.';
}
