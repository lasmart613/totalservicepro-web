import type { SupabaseClient } from '@supabase/supabase-js';
import { isAdmin } from '@/lib/roles';
import { fetchMemberships } from '@/lib/org-membership-client';

export type NavProfile = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
  organization_id?: number | string | null;
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
  const { data: prof, error } = await supabase
    .from('user_profiles')
    .select('id, first_name, last_name, role, organization_id')
    .eq('id', userId)
    .maybeSingle();
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
