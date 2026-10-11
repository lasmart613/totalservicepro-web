/**
 * Who may see what from GET /api/team/list (service-role roster).
 *
 * The caller must hold a membership in the org (a profile pointer alone is not
 * enough: it can be left on a shop after the membership is deleted).
 *
 * Emails (member login emails and every invite) only go to invite managers,
 * the same people the engineer_invitations SELECT policy lets read invites:
 *   membership role company_admin / owner / service_manager, or
 *   profile role admin / company_admin / owner / service_manager on that org
 *   (with an active membership).
 * Everyone else (techs, dispatchers, ...) gets names and roles only.
 */

const MEMBERSHIP_MANAGER_ROLES = ['company_admin', 'owner', 'service_manager'];
const PROFILE_MANAGER_ROLES = ['admin', 'company_admin', 'owner', 'service_manager'];

function lower(v: unknown): string {
  return String(v ?? '').toLowerCase();
}

export function isTeamInviteManager(input: {
  member: boolean;
  membershipRole?: string | null;
  profileRole?: string | null;
}): boolean {
  if (!input.member) return false;
  return (
    MEMBERSHIP_MANAGER_ROLES.includes(lower(input.membershipRole)) ||
    PROFILE_MANAGER_ROLES.includes(lower(input.profileRole))
  );
}

/** Fields a non-manager sees per member. No email, auth_email, or account dates. */
export const ROSTER_PUBLIC_FIELDS = [
  'id',
  'first_name',
  'last_name',
  'role',
  'additional_roles',
  'job_title',
  'is_home',
  'is_founder',
  'organization_id',
] as const;

type Member = Record<string, unknown>;

export function rosterForCaller<T extends Member>(
  members: T[],
  opts: { manager: boolean; callerId: string }
): Member[] {
  if (opts.manager) return members;
  return members.map((m) => {
    const out: Member = {};
    for (const k of ROSTER_PUBLIC_FIELDS) if (k in m) out[k] = m[k];
    // Your own row may keep your own email.
    if (String(m.id ?? '') === opts.callerId && m.email != null) out.email = m.email;
    return out;
  });
}
