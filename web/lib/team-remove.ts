/**
 * Org-admin removal of one team membership.
 *
 * Self-leave stays on POST /api/org/leave. This path never deletes an auth
 * user. When either profile pointer still names the removed org, both move
 * to the remaining home membership, or to the latest other membership
 * (organization_id DESC on a tie) after set_home_membership, or to NULL.
 * Profile role is left as-is. Caller authority is this org's membership
 * role, this org's created_by, or a founder flag on that membership.
 */

import { normalizeRole, sameOrg } from '@/lib/org-membership';

export const REMOVE_MEMBER_RPC = 'remove_organization_member';

export const REMOVE_MEMBER_ERRORS = {
  not_admin: 'Only a company admin of this organization can remove a team member.',
  self: 'You cannot remove yourself. Use Leave company instead.',
  not_member: 'That person is not a member of this organization.',
  owner: 'The organization owner cannot be removed.',
  founder: 'The organization founder cannot be removed.',
  db: 'Could not remove that team member.',
} as const;

export type RemoveMemberCode = keyof typeof REMOVE_MEMBER_ERRORS;

/** Membership roles that may remove people. Platform `admin` is not one of them. */
const MEMBERSHIP_REMOVE_ROLES = new Set(['company_admin', 'owner']);

/** True when a row carries an explicit founder flag. Role alone is not a flag. */
export function rowFounderFlag(row: object | null | undefined): boolean {
  if (!row || typeof row !== 'object') return false;
  const record = row as Record<string, unknown>;
  for (const key of ['is_founder', 'founder', 'isFounder']) {
    const value = record[key];
    if (value === true || value === 1) return true;
    if (typeof value === 'string') {
      const text = value.toLowerCase().trim();
      if (text === 'true' || text === 't' || text === '1' || text === 'yes') return true;
    }
  }
  return false;
}

/**
 * Caller may remove members of this org from their membership in that org:
 * company_admin or owner. A founder flag on that same membership, or
 * organizations.created_by for this org, also qualifies. Do not pass a
 * profile founder flag or a flag from another org. A profile role of admin
 * is a platform role and must not be passed here.
 */
export function callerMayRemoveTeamMembers(input: {
  role?: string | null;
  founder?: boolean | null;
  isOrgCreator?: boolean | null;
}): boolean {
  if (input.founder) return true;
  if (input.isOrgCreator) return true;
  return MEMBERSHIP_REMOVE_ROLES.has(normalizeRole(input.role));
}

/** Hide the team-list action for owner, founder, and the caller. Home staff stay visible. */
export function teamMemberRemoveBlocked(input: {
  memberId?: string | null;
  callerId?: string | null;
  role?: string | null;
  founder?: boolean | null;
  isOrgCreator?: boolean | null;
}): boolean {
  const memberId = String(input.memberId || '').trim();
  const callerId = String(input.callerId || '').trim();
  if (memberId && callerId && memberId === callerId) return true;
  if (normalizeRole(input.role) === 'owner') return true;
  if (input.founder || input.isOrgCreator) return true;
  return false;
}

export function decideAdminRemoveMember(input: {
  callerMayRemove: boolean;
  callerId?: string | null;
  targetUserId?: string | null;
  targetIsMember: boolean;
  targetRole?: string | null;
  targetProfileRole?: string | null;
  targetProfileInOrg?: boolean;
  targetFounder?: boolean | null;
  targetIsOrgCreator?: boolean | null;
}): { ok: true } | { ok: false; status: 403; code: RemoveMemberCode; error: string } {
  if (!input.callerMayRemove) {
    return { ok: false, status: 403, code: 'not_admin', error: REMOVE_MEMBER_ERRORS.not_admin };
  }
  const caller = String(input.callerId || '').trim();
  const target = String(input.targetUserId || '').trim();
  if (caller && target && caller === target) {
    return { ok: false, status: 403, code: 'self', error: REMOVE_MEMBER_ERRORS.self };
  }
  if (!input.targetIsMember) {
    return { ok: false, status: 403, code: 'not_member', error: REMOVE_MEMBER_ERRORS.not_member };
  }
  const membershipOwner = normalizeRole(input.targetRole) === 'owner';
  const profileOwner =
    input.targetProfileInOrg === true && normalizeRole(input.targetProfileRole) === 'owner';
  if (membershipOwner || profileOwner) {
    return { ok: false, status: 403, code: 'owner', error: REMOVE_MEMBER_ERRORS.owner };
  }
  if (input.targetFounder || input.targetIsOrgCreator) {
    return { ok: false, status: 403, code: 'founder', error: REMOVE_MEMBER_ERRORS.founder };
  }
  return { ok: true };
}

export function sameUser(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  return left !== '' && left === right;
}

export { sameOrg };
