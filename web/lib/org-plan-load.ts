/**
 * Load is_premium / plan / subscription_tier with column fallbacks.
 * A nested embed that asks for missing columns fails the whole read and
 * makes /plans look Free even when is_premium is true.
 */

import type { OrgPlanFields } from './org-plan.ts';

export const ORG_PLAN_SELECTS = [
  'name, is_premium, subscription_tier, plan, manual_slots',
  'name, is_premium, subscription_tier, plan',
  'name, is_premium, subscription_tier',
  'name, is_premium',
  'is_premium',
] as const;

type MaybeSingleResult = Promise<{
  data: Record<string, unknown> | null;
  error: { message?: string } | null;
}>;

type ClientLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string | number
      ) => {
        maybeSingle: () => MaybeSingleResult;
      };
    };
  };
};

export type OrgPlanRow = OrgPlanFields & { name?: string | null; id?: string | number | null };

function missingPlanColumn(message?: string): boolean {
  return /subscription_tier|manual_slots|\bplan\b|column/i.test(message || '');
}

export async function loadOrgPlanRow(
  client: ClientLike,
  orgId: string | number
): Promise<OrgPlanRow | null> {
  let lastError: { message?: string } | null = null;
  for (const columns of ORG_PLAN_SELECTS) {
    const { data, error } = await client
      .from('organizations')
      .select(columns)
      .eq('id', orgId)
      .maybeSingle();
    if (!error) return (data as OrgPlanRow | null) || null;
    lastError = error;
    if (!missingPlanColumn(error.message)) break;
  }
  if (lastError) {
    console.warn('[org-plan-load] organizations plan columns unavailable', lastError.message);
  }
  return null;
}
