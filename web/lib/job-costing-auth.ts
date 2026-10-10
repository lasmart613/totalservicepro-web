/**
 * Server-only Job Costing gate.
 * Do not import this from client components — it uses the God allowlist.
 */

import { isGodIdentity, type GodIdentity } from './god.ts';
import { isAdmin, type RoleLike } from './roles.ts';

export type JobCostingAccess =
  | { ok: true; god: boolean; organizationId: string | number | null }
  | { ok: false; status: 401 | 403; error: string };

/**
 * God uses the Auth user (id / email), same as /api/god.
 * Shop admin is the membership role in the active org (admin or company_admin).
 * Platform admin (user_profiles.role = 'admin') stays allowed with no membership.
 * A company_admin profile role is not an org role.
 */
export function decideJobCostingAccess(input: {
  user: GodIdentity | null;
  /** Membership role in the active organization. Not user_profiles.role. */
  membershipRole?: RoleLike;
  /** user_profiles.role = 'admin'. */
  isPlatformAdmin?: boolean;
  activeOrganizationId?: string | number | null;
  env?: NodeJS.ProcessEnv;
}): JobCostingAccess {
  const userId = String(input.user?.id || '').trim();
  if (!input.user || !userId) {
    return { ok: false, status: 401, error: 'Sign in required' };
  }

  const god = isGodIdentity({ id: userId, email: input.user.email }, input.env);
  const allowed = god || input.isPlatformAdmin === true || isAdmin(input.membershipRole);
  if (!allowed) {
    return { ok: false, status: 403, error: 'Admin access required' };
  }

  const organizationId =
    input.activeOrganizationId == null || input.activeOrganizationId === ''
      ? null
      : input.activeOrganizationId;

  return { ok: true, god, organizationId };
}
