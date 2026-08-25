import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { listMembershipsWithOrgs, upsertMembership } from '@/lib/org-membership-server';

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
      const email = (profile?.email || user.email || '').toLowerCase().trim();
      if (email) {
        const { data: invRows } = await admin
          .from('engineer_invitations')
          .select('id, organization_id, role, accepted, email')
          .ilike('email', email)
          .order('created_at', { ascending: false })
          .limit(50);
        for (const inv of invRows || []) {
          if (!inv.organization_id || !inv.accepted) continue;
          await upsertMembership(admin, {
            userId: user.id,
            organizationId: inv.organization_id,
            role: inv.role || 'fse',
            isHome: false,
          });
        }
      }

      const { data: ownShops } = await admin
        .from('organizations')
        .select('id, type')
        .eq('created_by', user.id)
        .in('type', ['service_company', 'parts_supplier', 'supplier', 'vendor']);
      for (const shop of ownShops || []) {
        const shopType = String(shop.type || '').toLowerCase();
        const shopRole =
          shopType === 'parts_supplier' || shopType === 'supplier' || shopType === 'vendor'
            ? 'parts_supplier'
            : 'company_admin';
        await upsertMembership(admin, {
          userId: user.id,
          organizationId: shop.id,
          role: shopRole,
          isHome: true,
        });
      }

      const rows = await listMembershipsWithOrgs(admin, user.id);
      memberships = rows.map((row) => ({
        organizationId: row.organization_id,
        name: row.organizations?.name || `Company ${row.organization_id}`,
        type: row.organizations?.type || null,
        role: row.role,
        isHome: !!row.is_home,
        isActive: String(row.organization_id) === String(activeId),
      }));

      if (email) {
        const { data: invites } = await admin
          .from('engineer_invitations')
          .select('id, organization_id, role, first_name, last_name, created_at, accepted')
          .ilike('email', email)
          .eq('accepted', false)
          .order('created_at', { ascending: false })
          .limit(20);
        const memberOrgIds = new Set(memberships.map((m) => String(m.organizationId)));
        const pendingRaw = (invites || []).filter(
          (inv: any) => inv.organization_id && !memberOrgIds.has(String(inv.organization_id))
        );
        const orgIds = Array.from(
          new Set(pendingRaw.map((inv: any) => inv.organization_id).filter(Boolean))
        );
        const names = new Map<string, string>();
        if (orgIds.length) {
          const { data: orgs } = await admin
            .from('organizations')
            .select('id, name')
            .in('id', orgIds);
          (orgs || []).forEach((o: any) => names.set(String(o.id), o.name || `Company ${o.id}`));
        }
        pendingInvites = pendingRaw.map((inv: any) => ({
          id: inv.id,
          organizationId: inv.organization_id,
          name: names.get(String(inv.organization_id)) || `Company ${inv.organization_id}`,
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
