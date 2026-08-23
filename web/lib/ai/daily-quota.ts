/**
 * Per-user daily AI caps. Limits follow the caller's current org plan.
 * Usage is counted per user (each team member), not as a shared org bucket.
 * The day boundary is UTC midnight — same "resets at midnight" window the
 * existing grok-assistant 429 copy already uses.
 */

import {
  orgIsPaid,
  orgIsTopPaid,
  type OrgPlanFields,
} from '../org-plan.ts';

export type AiRequestKind = 'text' | 'voice';

export type AiDailyLimits = {
  text: number;
  voice: number;
  tier: 'free' | 'premium' | 'team';
};

export const FREE_AI_DAILY = { text: 5, voice: 5 } as const;
export const PREMIUM_AI_DAILY = { text: 50, voice: 50 } as const;
export const TEAM_AI_DAILY = { text: 250, voice: 250 } as const;

export function aiDailyLimitsForOrg(org: OrgPlanFields | null | undefined): AiDailyLimits {
  if (orgIsTopPaid(org)) return { ...TEAM_AI_DAILY, tier: 'team' };
  if (orgIsPaid(org)) return { ...PREMIUM_AI_DAILY, tier: 'premium' };
  return { ...FREE_AI_DAILY, tier: 'free' };
}

export function utcDayStartIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export function isDailyLimitReached(used: number, limit: number): boolean {
  return Number(used) >= Number(limit);
}

export function dailyLimitMessage(kind: AiRequestKind, used: number, limit: number): string {
  return `Daily ${kind} limit reached (${used}/${limit}). Resets at midnight.`;
}
