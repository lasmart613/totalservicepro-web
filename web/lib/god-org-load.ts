/**
 * Server-side God org assembly for invite / blast sends.
 */

import { getSupabaseAdmin } from './supabase/admin.ts';
import { fetchAllPages } from './supabase/paginate.ts';
import { assembleGodOrgs, type GodMember, type GodOrgRow, type GodOrgSource } from './god-orgs.ts';

export async function loadAssembledGodOrgs(): Promise<GodOrgRow[]> {
  const admin = getSupabaseAdmin();
  const { data: orgs } = await fetchAllPages<GodOrgSource>(async (from, to) => {
    const cols = 'id, name, type, email, created_at, is_premium, subscription_tier, plan';
    let res = await admin.from('organizations').select(cols).order('id').range(from, to);
    if (res.error && /column|schema cache|does not exist/i.test(res.error.message || '')) {
      res = await admin
        .from('organizations')
        .select('id, name, type, email, created_at, is_premium')
        .order('id')
        .range(from, to);
    }
    return { data: (res.data as GodOrgSource[] | null) || [], error: res.error };
  });

  const { data: profiles } = await fetchAllPages<Record<string, unknown>>(async (from, to) => {
    const res = await admin
      .from('user_profiles')
      .select('id, email, first_name, last_name, role, organization_id')
      .order('id')
      .range(from, to);
    return { data: (res.data as Record<string, unknown>[] | null) || [], error: res.error };
  });

  const members: GodMember[] = (profiles || []).map((row) => ({
    id: String(row.id),
    email: (row.email as string | null) || null,
    firstName: (row.first_name as string | null) || null,
    lastName: (row.last_name as string | null) || null,
    role: (row.role as string | null) || null,
    organizationId: (row.organization_id as number | string | null) ?? null,
  }));

  return assembleGodOrgs({ orgs: orgs || [], members });
}
