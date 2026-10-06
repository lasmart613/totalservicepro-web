import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { listMembershipsForUser } from '@/lib/org-membership-server';
import { sameOrg } from '@/lib/org-membership';
import { decideMemberRoleChange } from '@/lib/tenant-lockdown';

/**
 * POST /api/org/members/role
 * { userId, organizationId, role }
 *
 * Caller must be an admin of that same organization. They cannot grant a
 * role above their own, and they cannot grant platform admin unless they
 * already are platform admin. Service role write.
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }
    if (!hasServiceRole()) {
      return NextResponse.json(
        { error: 'Server cannot change roles (missing service role).' },
        { status: 503 }
      );
    }

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      userId?: string;
      organizationId?: number | string;
      role?: string;
    };
    const targetUserId = String(body.userId || '').trim();
    if (!targetUserId || body.organizationId == null || body.organizationId === '') {
      return NextResponse.json(
        { error: 'userId, organizationId, and role are required.' },
        { status: 400 }
      );
    }

    const admin = getSupabaseAdmin();
    const callerMemberships = await listMembershipsForUser(admin, user.id);
    const callerMembership = callerMemberships.find((row) =>
      sameOrg(row.organizationId, body.organizationId)
    );

    let callerRole = callerMembership?.role || null;
    if (!callerRole) {
      const { data: profile } = await admin
        .from('user_profiles')
        .select('organization_id, role')
        .eq('id', user.id)
        .maybeSingle();
      if (profile && sameOrg(profile.organization_id, body.organizationId)) {
        callerRole = profile.role || null;
      }
    }

    const decision = decideMemberRoleChange({
      callerRole,
      targetRole: body.role,
      sameOrganization: Boolean(callerRole),
    });
    if (!decision.ok) {
      return NextResponse.json({ error: decision.error }, { status: decision.status });
    }

    const { data: targetMembership, error: targetError } = await admin
      .from('organization_memberships')
      .select('user_id, organization_id, role, is_home')
      .eq('user_id', targetUserId)
      .eq('organization_id', body.organizationId)
      .maybeSingle();
    if (targetError) {
      return NextResponse.json({ error: targetError.message }, { status: 500 });
    }
    if (!targetMembership) {
      return NextResponse.json(
        { error: 'That person is not a member of this organization.' },
        { status: 404 }
      );
    }

    const { error: membershipError } = await admin
      .from('organization_memberships')
      .update({ role: decision.role, updated_at: new Date().toISOString() })
      .eq('user_id', targetUserId)
      .eq('organization_id', body.organizationId);
    if (membershipError) {
      return NextResponse.json({ error: membershipError.message }, { status: 500 });
    }

    const { data: targetProfile } = await admin
      .from('user_profiles')
      .select('organization_id, active_organization_id')
      .eq('id', targetUserId)
      .maybeSingle();
    const activeHere =
      sameOrg(targetProfile?.organization_id, body.organizationId) ||
      sameOrg(targetProfile?.active_organization_id, body.organizationId);
    if (activeHere) {
      const { error: profileError } = await admin
        .from('user_profiles')
        .update({ role: decision.role, updated_at: new Date().toISOString() })
        .eq('id', targetUserId);
      if (profileError) {
        return NextResponse.json({ error: profileError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, role: decision.role, organizationId: body.organizationId });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Role change failed';
    console.error('member role', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
