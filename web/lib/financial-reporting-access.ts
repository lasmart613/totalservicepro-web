/**
 * Who may open Financial Reporting.
 * Admin level is the existing isAdmin check (admin ≡ company_admin).
 * Above admin is the existing God identity (isGodIdentity), passed in as `god`
 * so this file does not read secrets or invent a role.
 */

import { isAdmin, normalizeRole, type RoleLike } from './roles.ts';

export const FINANCIAL_REPORTING_PATH = '/business/financial-reporting';
export const FINANCIAL_REPORTING_API = '/api/business/financial-reporting';

/** HttpOnly cookie set only after the server authorizes this page. */
export const FINANCIAL_REPORT_COOKIE = 'tsp-fr-access';

export function canAccessFinancialReporting(input: {
  role?: RoleLike;
  god?: boolean;
}): boolean {
  if (input.god) return true;
  return isAdmin(input.role);
}

/**
 * Homepage KPI totals. Membership role in the active org.
 * admin and company_admin match Financial Reporting.
 * owner is the clinic / facility roster role. billing_manager is the shop roster role.
 * Stored strings: organization_memberships.role (admin on a membership is company_admin).
 */
export const HOMEPAGE_FINANCIAL_KPI_ROLES = ['admin', 'company_admin', 'owner', 'billing_manager'] as const;

export function canAccessHomepageFinancialKpis(input: { role?: RoleLike; god?: boolean }): boolean {
  if (input.god) return true;
  return (HOMEPAGE_FINANCIAL_KPI_ROLES as readonly string[]).includes(normalizeRole(input.role));
}

export function financialReportingNavLink(input: {
  role?: RoleLike;
  god?: boolean;
}): { href: string; label: string } | null {
  if (!canAccessFinancialReporting(input)) return null;
  return { href: FINANCIAL_REPORTING_PATH, label: 'Financial Reporting' };
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
