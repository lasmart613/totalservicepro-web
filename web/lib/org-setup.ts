/**
 * Whether an organization is already running, for onboarding routing only.
 *
 * Set up means the org has a non-blank name and at least one
 * organization_customers row (service_organization_id), service_tickets row,
 * or service_reports row. One Postgres function does that lookup. A missing
 * function, a permission error, or any other failure returns null so callers
 * keep the current onboarding path. This module does not write.
 */

import { isOrgSetupRoutingRole, profileOrgId, type OrgRouteProfile } from './no-org-route.ts';

export const ORG_SET_UP_RPC = 'organization_is_set_up_for_routing';

export type OrgSetUpClient = {
  rpc: (
    fn: string,
    args: { p_organization_id: number }
  ) => Promise<{ data: boolean | null; error: { message?: string } | null }>;
};

/** True when home or /onboarding should ask whether this unfinished admin's org is running. */
export function adminRoutingNeedsOrgSetupLookup(profile: OrgRouteProfile): boolean {
  if (!profile || profile.onboarding_completed !== false) return false;
  if (!profileOrgId(profile)) return false;
  return isOrgSetupRoutingRole(profile.role);
}

/**
 * One round trip. true = named org with a customer, ticket, or service report.
 * false = looked up and not set up. null = do not change routing.
 */
export async function lookupOrgSetUp(
  client: OrgSetUpClient,
  orgId: number | string | null | undefined
): Promise<boolean | null> {
  if (orgId == null || String(orgId).trim() === '') return null;
  const id = typeof orgId === 'number' ? orgId : Number(orgId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  try {
    const { data, error } = await client.rpc(ORG_SET_UP_RPC, { p_organization_id: id });
    if (error) return null;
    if (data === true) return true;
    if (data === false) return false;
    return null;
  } catch {
    return null;
  }
}
