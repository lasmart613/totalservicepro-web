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
 * Admin uses user_profiles.role or the active organization's membership role.
 */
export function decideJobCostingAccess(input: {
  user: GodIdentity | null;
  profileRole?: RoleLike;
  activeOrganizationId?: string | number | null;
  membershipRole?: RoleLike;
  env?: NodeJS.ProcessEnv;
}): JobCostingAccess {
  const userId = String(input.user?.id || '').trim();
  if (!input.user || !userId) {
    return { ok: false, status: 401, error: 'Sign in required' };
  }

  const god = isGodIdentity({ id: userId, email: input.user.email }, input.env);
  const allowed = god || isAdmin(input.profileRole) || isAdmin(input.membershipRole);
  if (!allowed) {
    return { ok: false, status: 403, error: 'Admin access required' };
  }

  const organizationId =
    input.activeOrganizationId == null || input.activeOrganizationId === ''
      ? null
      : input.activeOrganizationId;

  return { ok: true, god, organizationId };
}
