import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { requireGodCaller } from '@/lib/god-auth';
import { assembleGodOrgs, filterGodOrgs, type GodMember, type GodOrgSource } from '@/lib/god-orgs';
import { fetchAllPages } from '@/lib/supabase/paginate';

export const dynamic = 'force-dynamic';

const ORG_SELECTS = [
  'id, name, type, email, created_at, created_by, is_premium, subscription_tier, plan',
  'id, name, type, email, created_at, created_by, is_premium, subscription_tier',
  'id, name, type, email, created_at, created_by, is_premium',
  'id, name, type, email, created_at, is_premium',
  'id, name, type, email, created_at',
] as const;

const MEMBER_SELECTS = [
  'id, email, first_name, last_name, role, organization_id',
  'id, email, first_name, last_name, role, organization_id',
] as const;

/**
 * GET /api/god/orgs
 * Read-only list of every organization and its users. God only.
 */
export async function GET(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;

  if (!hasServiceRole()) {
    return NextResponse.json({ error: 'Server missing SUPABASE_SERVICE_ROLE_KEY', orgs: [] }, { status: 500 });
  }

  const admin = getSupabaseAdmin();
  let orgs: GodOrgSource[] = [];
  let orgError: { message?: string } | null = null;

  for (const cols of ORG_SELECTS) {
    const { data, error } = await fetchAllPages<GodOrgSource>(async (from, to) => {
      const res = await admin.from('organizations').select(cols).order('id').range(from, to);
      return { data: (res.data as GodOrgSource[] | null) || [], error: res.error };
    });
    orgError = error;
    if (!error) {
      orgs = data;
      break;
    }
    if (error && !/column|schema cache|does not exist/i.test(error.message || '')) break;
  }

  if (orgError && !orgs.length) {
    return NextResponse.json({ error: orgError.message, orgs: [] }, { status: 500 });
  }

  let members: GodMember[] = [];
  for (const cols of MEMBER_SELECTS) {
    const { data, error } = await fetchAllPages<Record<string, unknown>>(async (from, to) => {
      const res = await admin.from('user_profiles').select(cols).order('id').range(from, to);
      return { data: (res.data as Record<string, unknown>[] | null) || [], error: res.error };
    });
    if (!error) {
      members = data.map((row) => ({
        id: String(row.id),
        email: (row.email as string | null) || null,
        firstName: (row.first_name as string | null) || null,
        lastName: (row.last_name as string | null) || null,
        role: (row.role as string | null) || null,
        organizationId: (row.organization_id as number | string | null) ?? null,
      }));
      break;
    }
    if (error && !/column|schema cache|does not exist/i.test(error.message || '')) break;
  }

  try {
    const { data: memberships } = await fetchAllPages<{
      user_id: string;
      organization_id: number;
      role: string | null;
    }>(async (from, to) => {
      const res = await admin
        .from('organization_memberships')
        .select('user_id, organization_id, role')
        .range(from, to);
      return { data: res.data || [], error: res.error };
    });
    const byId = new Map(members.map((m) => [m.id, m]));
    for (const row of memberships) {
      const existing = byId.get(row.user_id);
      if (!existing) continue;
      if (existing.organizationId == null) {
        existing.organizationId = row.organization_id;
        existing.role = row.role || existing.role;
      } else if (String(existing.organizationId) !== String(row.organization_id)) {
        members.push({
          ...existing,
          organizationId: row.organization_id,
          role: row.role || existing.role,
        });
      }
    }
  } catch {
    /* memberships table may be missing */
  }

  const assembled = assembleGodOrgs({ orgs, members });
  const url = req.nextUrl;
  const filtered = filterGodOrgs(assembled, {
    type: url.searchParams.get('type'),
    plan: url.searchParams.get('plan'),
    q: url.searchParams.get('q'),
  });

  return NextResponse.json({
    ok: true,
    god: true,
    orgs: filtered,
    total: assembled.length,
    shown: filtered.length,
  });
}
