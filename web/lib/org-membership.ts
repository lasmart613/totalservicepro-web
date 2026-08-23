/**
 * Multi-organization memberships (moonlight + move).
 *
 * user_profiles.organization_id remains the ACTIVE org so existing RLS
 * (which reads that column) stays isolated per company. A row in
 * organization_memberships is the durable (user, org, role) link.
 *
 * Founder / owner / admin of a home shop is never overwritten by another
 * company's invite. The invite adds a second membership instead.
 */

export const DEFAULT_STAFF_ROLE = 'fse';

export const FOUNDER_LOCKED_ROLES = new Set([
  'company_admin',
  'admin',
  'owner',
  'parts_supplier',
  'supplier',
]);

export type MembershipSnapshot = {
  organizationId: number | string;
  role: string;
  isHome: boolean;
};

export function normalizeOrgId(id: number | string | null | undefined): string | null {
  if (id == null || id === '') return null;
  return String(id);
}

export function normalizeRole(role?: string | null): string {
  return String(role || '').toLowerCase().trim();
}

export function isFounderLockedRole(role?: string | null): boolean {
  return FOUNDER_LOCKED_ROLES.has(normalizeRole(role));
}

export function sameOrg(
  a: number | string | null | undefined,
  b: number | string | null | undefined
): boolean {
  const left = normalizeOrgId(a);
  const right = normalizeOrgId(b);
  return left != null && right != null && left === right;
}

export function membershipRoleForInvite(inviteRole?: string | null): string {
  return normalizeRole(inviteRole) || DEFAULT_STAFF_ROLE;
}

export type InviteDecision =
  | {
      action: 'already_on_team';
      overwriteRole: false;
      message: string;
    }
  | {
      action: 'attach_first_org';
      role: string;
      activate: true;
      isHome: boolean;
    }
  | {
      action: 'add_membership';
      role: string;
      activate: false;
      isHome: false;
      moonlight: true;
      message: string;
    }
  | {
      action: 'already_member';
      message: string;
    };

/**
 * Decide what POST /api/team/invite should do for an existing profile.
 * Never 409 just because the email already has an organization.
 */
export function decideInviteForExistingProfile(input: {
  inviteOrgId: number | string;
  inviteRole?: string | null;
  profileOrgId?: number | string | null;
  profileRole?: string | null;
  membershipOrgIds?: Array<number | string | null | undefined>;
}): InviteDecision {
  const inviteOrgId = input.inviteOrgId;
  const role = membershipRoleForInvite(input.inviteRole);
  const memberOfInviteOrg = (input.membershipOrgIds || []).some((id) => sameOrg(id, inviteOrgId));
  const onInviteOrg = memberOfInviteOrg || sameOrg(input.profileOrgId, inviteOrgId);

  if (onInviteOrg) {
    const lockedHere =
      isFounderLockedRole(input.profileRole) && sameOrg(input.profileOrgId, inviteOrgId);
    return {
      action: memberOfInviteOrg || onInviteOrg ? 'already_on_team' : 'already_member',
      overwriteRole: false,
      message: lockedHere
        ? 'Already a founder/admin of this organization. Role was not overwritten.'
        : 'Already on this organization. Role was not overwritten.',
    };
  }

  if (!input.profileOrgId && (input.membershipOrgIds || []).length === 0) {
    return {
      action: 'attach_first_org',
      role,
      activate: true,
      isHome: isFounderLockedRole(role),
    };
  }

  return {
    action: 'add_membership',
    role,
    activate: false,
    isHome: false,
    moonlight: true,
    message:
      'Existing account belongs to another organization. Invite adds a second membership; their home shop and founder role stay intact.',
  };
}

export type ClaimDecision =
  | { action: 'skip'; reason: string }
  | { action: 'none'; reason: string }
  | {
      action: 'accept';
      add: { organizationId: number | string; role: string; isHome: false };
      leaveOrganizationId: number | string | null;
      activateOrganizationId: number | string | null;
      keepHome: boolean;
    }
  | { action: 'error'; error: string };

/**
 * Claim / accept a pending invite.
 * - No existing memberships → attach and activate (first org).
 * - Existing home / founder → add membership only (moonlight). Never steal home.
 * - leaveOrganizationId set → move off that org after adding B (auth user stays).
 */
export function decideClaim(input: {
  inviteOrgId?: number | string | null;
  inviteRole?: string | null;
  memberships: MembershipSnapshot[];
  leaveOrganizationId?: number | string | null;
}): ClaimDecision {
  const inviteOrgId = normalizeOrgId(input.inviteOrgId);
  if (!inviteOrgId) {
    return { action: 'none', reason: 'No pending invitation.' };
  }

  const role = membershipRoleForInvite(input.inviteRole);
  const already = input.memberships.find((m) => sameOrg(m.organizationId, inviteOrgId));
  if (already) {
    return { action: 'skip', reason: 'Already a member of the invited organization.' };
  }

  const leaveId = normalizeOrgId(input.leaveOrganizationId);
  if (leaveId && sameOrg(leaveId, inviteOrgId)) {
    return { action: 'error', error: 'Cannot leave the organization you are joining.' };
  }

  if (leaveId) {
    const leaving = input.memberships.find((m) => sameOrg(m.organizationId, leaveId));
    if (!leaving) {
      return { action: 'error', error: 'You are not a member of the organization you asked to leave.' };
    }
    const leaveCheck = canLeaveMembership({
      leaving,
      remainingAfterLeave: input.memberships.filter((m) => !sameOrg(m.organizationId, leaveId)),
    });
    if (!leaveCheck.ok) {
      return { action: 'error', error: leaveCheck.error };
    }
  }

  const hasAny = input.memberships.length > 0;
  const hasHome = input.memberships.some((m) => m.isHome || isFounderLockedRole(m.role));

  return {
    action: 'accept',
    add: { organizationId: inviteOrgId, role, isHome: false },
    leaveOrganizationId: leaveId,
    activateOrganizationId: hasAny ? null : inviteOrgId,
    keepHome: hasHome,
  };
}

export function canLeaveMembership(input: {
  leaving: MembershipSnapshot;
  remainingAfterLeave: MembershipSnapshot[];
}): { ok: true } | { ok: false; error: string } {
  // Founder/home shop cannot be stripped by a peer invite; the owner may still
  // leave their own shop if they have somewhere else to work, or if they stay
  // with zero orgs (account remains). We only block leaving home when it would
  // be implied by "steal" — callers must pass an explicit leave of home.
  if (input.leaving.isHome && isFounderLockedRole(input.leaving.role)) {
    // Explicit leave of a home shop is allowed (user-initiated move / close).
    // Invite/claim must never pass the home org as leaveOrganizationId.
    return { ok: true };
  }
  return { ok: true };
}

/**
 * Invite/claim must never pass a founder-locked home org as the org to leave.
 */
export function inviteMustNotLeaveHome(input: {
  leaveOrganizationId?: number | string | null;
  memberships: MembershipSnapshot[];
}): { ok: true } | { ok: false; error: string } {
  const leaveId = normalizeOrgId(input.leaveOrganizationId);
  if (!leaveId) return { ok: true };
  const leaving = input.memberships.find((m) => sameOrg(m.organizationId, leaveId));
  if (leaving && (leaving.isHome || isFounderLockedRole(leaving.role))) {
    return {
      ok: false,
      error:
        'Founder/owner of their home shop cannot be removed by another company invite. They can leave that shop themselves later.',
    };
  }
  return { ok: true };
}

export function decideSwitch(input: {
  targetOrgId: number | string;
  memberships: MembershipSnapshot[];
}):
  | { ok: true; organizationId: number | string; role: string }
  | { ok: false; error: string } {
  const target = normalizeOrgId(input.targetOrgId);
  if (!target) return { ok: false, error: 'Organization is required.' };
  const hit = input.memberships.find((m) => sameOrg(m.organizationId, target));
  if (!hit) {
    return { ok: false, error: 'You are not a member of that organization.' };
  }
  return { ok: true, organizationId: hit.organizationId, role: hit.role || DEFAULT_STAFF_ROLE };
}

export function nextActiveAfterLeave(input: {
  leftOrgId: number | string;
  wasActiveOrgId?: number | string | null;
  remaining: MembershipSnapshot[];
}): { organizationId: number | string; role: string } | null {
  if (input.remaining.length === 0) return null;
  if (!sameOrg(input.wasActiveOrgId, input.leftOrgId) && input.wasActiveOrgId) {
    const still = input.remaining.find((m) => sameOrg(m.organizationId, input.wasActiveOrgId));
    if (still) return { organizationId: still.organizationId, role: still.role };
  }
  const home = input.remaining.find((m) => m.isHome) || input.remaining[0];
  return { organizationId: home.organizationId, role: home.role || DEFAULT_STAFF_ROLE };
}

export type TeamRosterSource = {
  userId: string;
  email?: string | null;
  profileOrgId?: number | string | null;
  membershipOrgIds?: Array<number | string | null | undefined>;
};

/** A user belongs on an org roster via membership OR (legacy) profile pointer. */
export function isOnOrgRoster(
  source: TeamRosterSource,
  orgId: number | string
): boolean {
  if (sameOrg(source.profileOrgId, orgId)) return true;
  return (source.membershipOrgIds || []).some((id) => sameOrg(id, orgId));
}
