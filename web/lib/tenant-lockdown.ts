/**
 * Authorization for tenant-defining writes.
 *
 * Clients must not UPDATE user_profiles.role, organization_id, or
 * active_organization_id. These decisions run on the server (service role)
 * and mirror public.user_profiles_sync_membership.
 */

import { normalizeLookupEmail } from '@/lib/email-match';
import { isInvitableTeamRole, teamRoleForInvite } from '@/lib/org-membership';

export const PLATFORM_ADMIN_ROLE = 'admin';

/** Roles a signed-in user must never grant themselves. */
export const ELEVATED_SELF_ROLES = [
  'admin',
  'company_admin',
  'owner',
  'parts_supplier',
  'supplier',
  'service_manager',
  'dispatcher',
  'scheduler',
  'billing_manager',
  'crm',
] as const;

const ROLE_RANK: Record<string, number> = {
  admin: 100,
  company_admin: 80,
  owner: 70,
  parts_supplier: 60,
  supplier: 60,
  service_manager: 50,
  billing_manager: 40,
  dispatcher: 40,
  scheduler: 40,
  crm: 30,
  fse: 10,
  engineer: 10,
  technician: 10,
  customer: 10,
  viewer: 5,
};

export function normalizeRole(role?: string | null): string {
  return String(role || '').toLowerCase().trim();
}

export function roleRank(role?: string | null): number {
  const key = normalizeRole(role);
  if (!key) return 0;
  return ROLE_RANK[key] ?? 10;
}

export function isElevatedSelfRole(role?: string | null): boolean {
  return (ELEVATED_SELF_ROLES as readonly string[]).includes(normalizeRole(role));
}

/** Founder role stored for an org the caller just created. Never platform admin. */
export function founderRoleForOrgType(orgType?: string | null): string {
  const t = String(orgType || '').toLowerCase().trim();
  if (t === 'parts_supplier' || t === 'supplier' || t === 'vendor') return 'parts_supplier';
  if (
    t === 'customer' ||
    t === 'laser_clinic' ||
    t === 'laser_rental' ||
    t === 'laser_reseller'
  ) {
    return 'owner';
  }
  if (t === 'service_company') return 'company_admin';
  return 'company_admin';
}

export type AuthzFailure = { ok: false; status: number; error: string };

/**
 * Link the caller to an organization as its founder.
 * created_by must be the caller. The role comes from the org type.
 */
export function decideFounderLink(input: {
  callerId?: string | null;
  orgCreatedBy?: string | null;
  orgType?: string | null;
}): { ok: true; role: string } | AuthzFailure {
  const caller = String(input.callerId || '').trim();
  const createdBy = String(input.orgCreatedBy || '').trim();
  if (!caller) {
    return { ok: false, status: 401, error: 'Not signed in' };
  }
  if (!createdBy || createdBy !== caller) {
    return {
      ok: false,
      status: 403,
      error: 'You can only link an organization you created.',
    };
  }
  return { ok: true, role: founderRoleForOrgType(input.orgType) };
}

/**
 * Self-service attach of a profile to an org. Mirrors the trigger:
 * creator, existing member, or an unaccepted invite. Anything else is refused.
 */
export function authorizeSelfOrgAttach(input: {
  createdByCaller: boolean;
  alreadyMember: boolean;
  hasUnacceptedInvite: boolean;
}): { ok: true } | AuthzFailure {
  if (input.createdByCaller || input.alreadyMember || input.hasUnacceptedInvite) {
    return { ok: true };
  }
  return {
    ok: false,
    status: 403,
    error:
      'cannot join an organization you did not create, are not a member of, and were not invited to',
  };
}

export function authorizeInviteAccept(input: {
  callerEmail?: string | null;
  inviteEmail?: string | null;
  inviteOrgId?: number | string | null;
  inviteRole?: string | null;
}): { ok: true; organizationId: number | string; role: string } | AuthzFailure {
  const caller = normalizeLookupEmail(input.callerEmail);
  const invite = normalizeLookupEmail(input.inviteEmail);
  if (!caller) {
    return { ok: false, status: 401, error: 'Not signed in' };
  }
  if (input.inviteOrgId == null || input.inviteOrgId === '' || !invite) {
    return { ok: false, status: 403, error: 'No matching invitation.' };
  }
  if (caller !== invite) {
    return {
      ok: false,
      status: 403,
      error: 'This invitation is for a different account.',
    };
  }
  const role = normalizeRole(input.inviteRole) || 'fse';
  return { ok: true, organizationId: input.inviteOrgId, role };
}

/**
 * Who may call POST /api/org/members/role.
 * Membership role in that org, or founder of that org. Never user_profiles.role.
 * Platform admin is not a membership authority.
 */
export function callerMayChangeMemberRole(input: {
  membershipRole?: string | null;
  founder?: boolean | null;
  isOrgCreator?: boolean | null;
}): boolean {
  if (input.founder === true || input.isOrgCreator === true) return true;
  const role = normalizeRole(input.membershipRole);
  return role === 'company_admin' || role === 'owner';
}

/** The org owner and the org founder cannot have their role changed. */
export function memberRoleTargetIsLocked(input: {
  membershipRole?: string | null;
  founder?: boolean | null;
  isOrgCreator?: boolean | null;
}): boolean {
  if (normalizeRole(input.membershipRole) === 'owner') return true;
  if (input.founder === true || input.isOrgCreator === true) return true;
  return false;
}

/**
 * A caller cannot raise their own role.
 * Owner and platform admin are never a self-assignment, even when rank
 * treats owner as below company_admin.
 */
export function memberRoleSelfRaiseRefused(input: {
  callerId?: string | null;
  targetUserId?: string | null;
  membershipRole?: string | null;
  nextRole?: string | null;
}): boolean {
  const caller = String(input.callerId || '').trim();
  const target = String(input.targetUserId || '').trim();
  if (!caller || caller !== target) return false;
  const next = normalizeRole(input.nextRole);
  if (!next) return false;
  if (next === 'owner' || next === PLATFORM_ADMIN_ROLE) return true;
  return roleRank(next) > roleRank(input.membershipRole);
}

/**
 * Role stored by a team-member change. Empty becomes fse.
 * Anything outside INVITABLE_TEAM_ROLES, including owner and platform admin, is refused.
 */
export function refusedAssignableTeamRole(role?: string | null): string | null {
  const next = teamRoleForInvite(role);
  if (next === PLATFORM_ADMIN_ROLE || normalizeRole(role) === PLATFORM_ADMIN_ROLE) {
    return 'Organization memberships cannot use the platform admin role.';
  }
  if (isInvitableTeamRole(next)) return null;
  if (next === 'owner' || normalizeRole(role) === 'owner') {
    return 'Owner cannot be assigned this way.';
  }
  return 'That role cannot be assigned.';
}

export function decideMemberRoleChange(input: {
  callerRole?: string | null;
  targetRole?: string | null;
  sameOrganization: boolean;
  /** Team invites: a service manager may grant roles at or below their own. */
  allowServiceManager?: boolean;
}): { ok: true; role: string } | AuthzFailure {
  if (!input.sameOrganization) {
    return {
      ok: false,
      status: 403,
      error: 'You can only change roles in your own organization.',
    };
  }
  const caller = normalizeRole(input.callerRole);
  const target = teamRoleForInvite(input.targetRole);
  const lead =
    caller === 'admin' ||
    caller === 'company_admin' ||
    caller === 'owner' ||
    (input.allowServiceManager === true && caller === 'service_manager');
  if (!caller || !lead) {
    return {
      ok: false,
      status: 403,
      error: 'Only an admin of this organization can change roles.',
    };
  }
  const refused = refusedAssignableTeamRole(target);
  if (refused) {
    return { ok: false, status: 403, error: refused };
  }
  if (roleRank(target) > roleRank(caller)) {
    return { ok: false, status: 403, error: 'Cannot assign a role above your own.' };
  }
  return { ok: true, role: target };
}

const SIGNUP_FORBIDDEN_KEYS = [
  'organization_id',
  'organizationId',
  'active_organization_id',
  'activeOrganizationId',
  'role',
  'orgId',
] as const;

/** Email signup must not accept an org or a role. */
export function signupAssignsTenant(body: Record<string, unknown> | null | undefined): boolean {
  if (!body) return false;
  return SIGNUP_FORBIDDEN_KEYS.some((key) => {
    const value = body[key];
    return value != null && String(value).trim() !== '';
  });
}
