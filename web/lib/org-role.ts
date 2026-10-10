/**
 * Organization authority for the caller in one target org.
 *
 * The role is organization_memberships.role for this user and this org.
 * A stored membership role of admin is company_admin (same mapping as
 * profile_role_from_membership). It is not platform admin.
 * isFounder is organizations.created_by for that org, or a founder flag
 * on that same membership row.
 * isPlatformAdmin is user_profiles.role = 'admin' (what is_admin() reads).
 * A missing membership is no org role. Platform admin is unchanged.
 * A lookup error fails closed.
 */

import { normalizeRole, roleRank } from './tenant-lockdown.ts';
import { rowFounderFlag, sameUser } from './team-remove.ts';

export const ORG_ROLE_LOOKUP_ERROR = 'Could not verify organization role.';

/** Invite and team sync. Same set the profile-role check used. */
export const TEAM_LEAD_ROLES = ['admin', 'company_admin', 'service_manager', 'owner'] as const;

/** Invoice void. isAdmin (admin / company_admin) or owner. */
export const VOID_INVOICE_ROLES = ['admin', 'company_admin', 'owner'] as const;

/** Financial reporting and job costing. isAdmin only; God is separate. */
export const SHOP_ADMIN_ROLES = ['admin', 'company_admin'] as const;

export type OrgRole = {
  role: string | null;
  isFounder: boolean;
  isPlatformAdmin: boolean;
};

export type OrgRoleResult = ({ ok: true } & OrgRole) | { ok: false; status: 503; error: string };

type OrgRoleClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => any;
    };
  };
};

export function normalizeOrgRole(role?: string | null): string {
  return normalizeRole(role);
}

export function orgRoleRank(role?: string | null): number {
  return roleRank(role);
}

/** True when the left role outranks the right on the org ladder. */
export function orgRoleOutranks(left?: string | null, right?: string | null): boolean {
  return orgRoleRank(left) > orgRoleRank(right);
}

/**
 * Membership role used for org powers.
 * admin on a membership is company_admin, never platform admin.
 */
export function membershipRoleForOrgPowers(role?: string | null): string | null {
  const normalized = normalizeOrgRole(role);
  if (!normalized) return null;
  if (normalized === 'admin') return 'company_admin';
  return normalized;
}

function lookupFailed(error: unknown): boolean {
  return error != null;
}

/**
 * Role string a check can compare to its existing allow-list.
 * Platform admin stays admin when that bypass is in the set.
 * Founder satisfies a lead check only when founderCounts is set and a
 * membership role exists. A missing membership does not become an org role.
 */
export function authorityRole(
  org: OrgRole,
  allowed: readonly string[],
  options?: { founderCounts?: boolean }
): string {
  const allowedSet = new Set(allowed.map((role) => normalizeOrgRole(role)));
  if (org.isPlatformAdmin && allowedSet.has('admin')) return 'admin';
  const role = normalizeOrgRole(org.role);
  if (role && allowedSet.has(role)) return role;
  if (
    options?.founderCounts === true &&
    org.isFounder &&
    role &&
    (allowedSet.has('company_admin') || allowedSet.has('owner'))
  ) {
    return allowedSet.has('company_admin') ? 'company_admin' : 'owner';
  }
  return role;
}

export function orgRoleAllows(
  org: OrgRole,
  allowed: readonly string[],
  options?: { founderCounts?: boolean }
): boolean {
  const role = authorityRole(org, allowed, options);
  if (!role) return false;
  return allowed.some((item) => normalizeOrgRole(item) === role);
}

export function teamLeadRole(org: OrgRole): string {
  return authorityRole(org, TEAM_LEAD_ROLES, { founderCounts: true });
}

export function voidInvoiceRole(org: OrgRole): string {
  return authorityRole(org, VOID_INVOICE_ROLES, { founderCounts: true });
}

export function shopAdminRole(org: OrgRole): string {
  return authorityRole(org, SHOP_ADMIN_ROLES);
}

/** Active org, then the profile org. Same order the report loaders use. */
export function reportingOrganizationId(profile: {
  organization_id?: string | number | null;
  active_organization_id?: string | number | null;
} | null | undefined): string | number | null {
  const active = profile?.active_organization_id;
  if (active != null && String(active).trim() !== '') return active;
  const org = profile?.organization_id;
  if (org != null && String(org).trim() !== '') return org;
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

/**
 * Membership role, founder, and platform admin for one user in one org.
 * orgId null still resolves platform admin and returns no org role.
 */
export async function getOrgRole(
  supabase: OrgRoleClient,
  userId: string,
  orgId: string | number | null | undefined
): Promise<OrgRoleResult> {
  const id = String(userId || '').trim();
  if (!id) {
    return { ok: true, role: null, isFounder: false, isPlatformAdmin: false };
  }

  const hasOrg = orgId != null && String(orgId).trim() !== '';

  try {
    const profileQuery = supabase.from('user_profiles').select('role').eq('id', id).maybeSingle();
    const membershipQuery = hasOrg
      ? supabase
          .from('organization_memberships')
          .select('role, user_id, organization_id')
          .eq('user_id', id)
          .eq('organization_id', orgId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null });
    const orgQuery = hasOrg
      ? supabase.from('organizations').select('id, created_by').eq('id', orgId).maybeSingle()
      : Promise.resolve({ data: null, error: null });

    const [profile, membership, org] = await Promise.all([profileQuery, membershipQuery, orgQuery]);
    if (lookupFailed(profile.error) || lookupFailed(membership.error) || lookupFailed(org.error)) {
      return { ok: false, status: 503, error: ORG_ROLE_LOOKUP_ERROR };
    }

    const profileRow = asRecord(profile.data);
    const membershipRow = asRecord(membership.data);
    const orgRow = asRecord(org.data);
    const createdBy = orgRow?.created_by == null ? null : String(orgRow.created_by);

    return {
      ok: true,
      role: membershipRow ? membershipRoleForOrgPowers(membershipRow.role == null ? null : String(membershipRow.role)) : null,
      isFounder: sameUser(id, createdBy) || (membershipRow ? rowFounderFlag(membershipRow) : false),
      isPlatformAdmin: normalizeOrgRole(profileRow?.role == null ? null : String(profileRow.role)) === 'admin',
    };
  } catch {
    return { ok: false, status: 503, error: ORG_ROLE_LOOKUP_ERROR };
  }
}
