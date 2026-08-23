import type { SupabaseClient, User } from '@supabase/supabase-js';
import { isFounderLockedRole } from '@/lib/org-membership';
import { upsertMembership } from '@/lib/org-membership-server';

/**
 * Find auth user by email (service-role admin client).
 * listUsers is paginated; also try direct admin users filter when available.
 */
export async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string
): Promise<User | null> {
  const clean = email.toLowerCase().trim();
  if (!clean) return null;

  // Paginate listUsers (up to 10 pages / 2000 users)
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      console.warn('listUsers', error.message);
      break;
    }
    const hit = data?.users?.find((u) => (u.email || '').toLowerCase() === clean);
    if (hit) return hit;
    if (!data?.users?.length || data.users.length < 200) break;
  }
  return null;
}

export type EnsureProfileInput = {
  userId: string;
  email: string;
  organizationId: number | string;
  role?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  /** false = show light member onboarding; true = skip */
  onboardingCompleted?: boolean;
};

/**
 * Create or update user_profiles for an invited team member (service role).
 * If they already have another org, add a membership instead of overwriting.
 */
export async function ensureTeamMemberProfile(
  admin: SupabaseClient,
  input: EnsureProfileInput
): Promise<{ ok: boolean; error?: string; moonlight?: boolean }> {
  const { data: existing } = await admin
    .from('user_profiles')
    .select('id, organization_id, role')
    .eq('id', input.userId)
    .maybeSingle();

  const inviteRole = (input.role || 'fse').toLowerCase();
  const otherOrg =
    existing?.organization_id != null &&
    String(existing.organization_id) !== String(input.organizationId);

  const mem = await upsertMembership(admin, {
    userId: input.userId,
    organizationId: input.organizationId,
    role: inviteRole,
    isHome: false,
  });
  if (!mem.ok) return { ok: false, error: mem.error };

  if (otherOrg) {
    // Moonlight: keep home org + founder role on the profile pointer.
    return { ok: true, moonlight: true };
  }

  if (existing?.organization_id && isFounderLockedRole(existing.role)) {
    return { ok: true, moonlight: false };
  }

  const row: Record<string, unknown> = {
    id: input.userId,
    email: input.email.toLowerCase().trim(),
    organization_id: input.organizationId,
    active_organization_id: input.organizationId,
    role: inviteRole,
    onboarding_completed: input.onboardingCompleted ?? false,
  };
  if (input.firstName) row.first_name = input.firstName;
  if (input.lastName) row.last_name = input.lastName;
  if (input.jobTitle) row.job_title = input.jobTitle;

  const { error } = await admin.from('user_profiles').upsert(row, { onConflict: 'id' });
  if (error) {
    console.error('ensureTeamMemberProfile', error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
