import type { SupabaseClient } from '@supabase/supabase-js';
import { shopAdminRole, type OrgRoleResult } from '@/lib/org-role';
import { isAdmin, normalizeRole } from '@/lib/roles';
import { fetchMemberships } from '@/lib/org-membership-client';

export type NavLookup = 'pending' | 'error' | 'ready';

/**
 * Org powers for the header, home dashboard, and hub.
 * Pending until getOrgRole for the current org finishes.
 * An error stays closed: nothing in here is taken from user_profiles.role.
 */
export type OrgNavState = {
  lookup: NavLookup;
  /** user_profiles.role === 'admin', from getOrgRole. Not company_admin. */
  platformAdmin: boolean;
  /** shopAdminRole() for the current org. Empty unless the lookup succeeded. */
  orgPowerRole: string;
};

export const ORG_NAV_PENDING: OrgNavState = {
  lookup: 'pending',
  platformAdmin: false,
  orgPowerRole: '',
};

/**
 * CRM links in Business Management besides shop admin.
 * Customers, estimates, invoices, purchase orders, and company already
 * offered these roles. Financial reporting and job costing do not: those
 * links stay on isAdmin(shopAdminRole).
 */
const BUSINESS_CRM_ROLES = new Set([
  'service_manager',
  'dispatcher',
  'scheduler',
  'billing_manager',
]);

export function orgNavFromLookup(result: OrgRoleResult): OrgNavState {
  if (!result.ok) {
    return { lookup: 'error', platformAdmin: false, orgPowerRole: '' };
  }
  return {
    lookup: 'ready',
    platformAdmin: result.isPlatformAdmin,
    orgPowerRole: shopAdminRole(result),
  };
}

/**
 * Admin Portal nav. Platform admin only (user_profiles.role === 'admin').
 * company_admin does not see it. Hidden while the lookup is pending or failed.
 */
export function adminPortalNavVisible(nav: OrgNavState): boolean {
  return nav.lookup === 'ready' && nav.platformAdmin;
}

/**
 * Business Management for the current org.
 * orgPowerRole is shopAdminRole(): membership role, or admin for platform
 * admin. isAdmin matches the financial reporting and job costing gate
 * (membership admin/company_admin, or platform admin). The CRM links also
 * allow the lead roles above, from that same membership role.
 * Hidden while the lookup is pending or failed.
 */
export function businessManagementNavVisible(nav: OrgNavState): boolean {
  if (nav.lookup !== 'ready') return false;
  if (isAdmin(nav.orgPowerRole)) return true;
  return BUSINESS_CRM_ROLES.has(normalizeRole(nav.orgPowerRole));
}

export type NavProfile = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
  organization_id?: number | string | null;
  active_organization_id?: number | string | null;
  organizations?: {
    name?: string | null;
    type?: string | null;
    facility_type?: string | null;
  } | null;
};

/**
 * Own profile for Header / Admin. Never embed organizations from
 * user_profiles — a second org FK makes PostgREST reject the whole row,
 * which hides Admin Portal even when role is admin.
 */
export async function loadOwnNavProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<NavProfile | null> {
  let { data: prof, error } = await supabase
    .from('user_profiles')
    .select('id, first_name, last_name, role, organization_id, active_organization_id')
    .eq('id', userId)
    .maybeSingle();
  if (error && /active_organization_id|column/i.test(error.message || '')) {
    const retry = await supabase
      .from('user_profiles')
      .select('id, first_name, last_name, role, organization_id')
      .eq('id', userId)
      .maybeSingle();
    prof = retry.data;
    error = retry.error;
  }
  if (error) console.warn('loadOwnNavProfile', error.message);
  if (!prof) return null;

  let organizations: NavProfile['organizations'] = null;
  if (prof.organization_id != null) {
    const { data: org } = await supabase
      .from('organizations')
      .select('name, type, facility_type')
      .eq('id', prof.organization_id)
      .maybeSingle();
    organizations = org;
  }
  return { ...prof, organizations };
}

/**
 * Page gate for /admin. Organization admins (admin and company_admin) still
 * open the portal. The nav link is narrower: adminPortalNavVisible.
 */
export async function roleAllowsAdminPortal(role?: string | null): Promise<boolean> {
  if (isAdmin(role)) return true;
  try {
    const payload = await fetchMemberships();
    const active =
      payload.memberships.find((m) => m.isActive) || payload.memberships[0];
    return isAdmin(active?.role) || isAdmin(payload.role);
  } catch {
    return false;
  }
}
