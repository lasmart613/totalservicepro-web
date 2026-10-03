/**
 * Who may open Job Costing.
 * Same gate as Financial Reporting: isAdmin (admin ≡ company_admin), or God
 * passed in as a boolean from the existing God check. This file does not
 * import the God allowlist and does not depend on the financial reporting branch.
 */

import { isAdmin, type RoleLike } from './roles.ts';

export const JOB_COSTING_PATH = '/business/job-costing';
export const JOB_COSTING_API = '/api/business/job-costing';

/** HttpOnly cookie set only after the server authorizes this page. */
export const JOB_COSTING_COOKIE = 'tsp-jc-access';

export function canAccessJobCosting(input: { role?: RoleLike; god?: boolean }): boolean {
  if (input.god) return true;
  return isAdmin(input.role);
}

export function jobCostingNavLink(input: {
  role?: RoleLike;
  god?: boolean;
}): { href: string; label: string } | null {
  if (!canAccessJobCosting(input)) return null;
  return { href: JOB_COSTING_PATH, label: 'Job Costing' };
}

export function membershipRoleForActiveOrg(
  memberships: Array<{ role?: RoleLike; organization_id?: string | number | null }>,
  activeOrganizationId: string | number | null | undefined
): string | null {
  if (activeOrganizationId == null || activeOrganizationId === '') return null;
  const key = String(activeOrganizationId);
  const hit = memberships.find((row) => String(row.organization_id ?? '') === key);
  return hit?.role ?? null;
}
