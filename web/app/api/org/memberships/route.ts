import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { listMembershipsWithOrgs } from '@/lib/org-membership-server';

/**
 * GET /api/org/memberships
 * Active org + every shop this login belongs to + pending invites.
 */
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return NextResponse.json({ error: 'Not signed in', memberships: [] }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json({ error: 'Server misconfigured', memberships: [] }, { status: 500 });
    }

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Invalid session', memberships: [] }, { status: 401 });
    }

    const { data: profile } = await userClient
      .from('user_profiles')
      .select('organization_id, active_organization_id, role, email')
      .eq('id', user.id)
      .maybeSingle();

    const activeId = profile?.active_organization_id ?? profile?.organization_id ?? null;
    let memberships: any[] = [];
    let pendingInvites: any[] = [];

    if (hasServiceRole()) {
      const admin = getSupabaseAdmin();
      const rows = await listMembershipsWithOrgs(admin, user.id);
      memberships = rows.map((row) => ({
        organizationId: row.organization_id,
        name: row.organizations?.name || `Company ${row.organization_id}`,
        type: row.organizations?.type || null,
        role: row.role,
        isHome: !!row.is_home,
        isActive: String(row.organization_id) === String(activeId),
      }));

      const email = (profile?.email || user.email || '').toLowerCase().trim();
      if (email) {
        const { data: invites } = await admin
          .from('engineer_invitations')
          .select('id, organization_id, role, first_name, last_name, created_at, accepted, organizations(name)')
          .eq('email', email)
          .eq('accepted', false)
          .order('created_at', { ascending: false })
          .limit(20);
        const memberOrgIds = new Set(memberships.map((m) => String(m.organizationId)));
        pendingInvites = (invites || [])
          .filter((inv: any) => !memberOrgIds.has(String(inv.organization_id)))
          .map((inv: any) => ({
            id: inv.id,
            organizationId: inv.organization_id,
            name: inv.organizations?.name || `Company ${inv.organization_id}`,
            role: inv.role || 'fse',
            createdAt: inv.created_at,
          }));
      }
    } else {
      const { data: rows } = await userClient
        .from('organization_memberships')
        .select('organization_id, role, is_home, organizations(name, type)')
        .eq('user_id', user.id);
      memberships = (rows || []).map((row: any) => ({
        organizationId: row.organization_id,
        name: row.organizations?.name || `Company ${row.organization_id}`,
        type: row.organizations?.type || null,
        role: row.role,
        isHome: !!row.is_home,
        isActive: String(row.organization_id) === String(activeId),
      }));
    }

    if (!memberships.length && profile?.organization_id) {
      memberships = [
        {
          organizationId: profile.organization_id,
          name: 'Current company',
          type: null,
          role: profile.role || 'fse',
          isHome: true,
          isActive: true,
        },
      ];
    }

    return NextResponse.json({
      ok: true,
      activeOrganizationId: activeId,
      role: profile?.role || null,
      memberships,
      pendingInvites,
    });
  } catch (e: any) {
    console.error('org memberships error', e);
    return NextResponse.json(
      { error: e?.message || 'Failed', memberships: [] },
      { status: 500 }
    );
  }
}
