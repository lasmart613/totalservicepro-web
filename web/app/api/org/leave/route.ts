import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import {
  deleteMembership,
  listMembershipsForUser,
  setActiveOrganization,
} from '@/lib/org-membership-server';
import { nextActiveAfterLeave } from '@/lib/org-membership';

/**
 * POST /api/org/leave  { organizationId }
 * Drops a membership. Auth user is kept. Active org falls back to home / remaining.
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { organizationId?: number | string };
    if (body.organizationId == null) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 });
    }

    if (hasServiceRole()) {
      const admin = getSupabaseAdmin();
      const { data: profile } = await admin
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();
      const memberships = await listMembershipsForUser(admin, user.id);
      const leaving = memberships.find((m) => String(m.organizationId) === String(body.organizationId));
      if (!leaving) {
        return NextResponse.json({ error: 'You are not a member of that organization' }, { status: 400 });
      }

      const removed = await deleteMembership(admin, {
        userId: user.id,
        organizationId: body.organizationId,
      });
      if (!removed.ok) {
        return NextResponse.json({ error: removed.error || 'Leave failed' }, { status: 400 });
      }

      const remaining = memberships.filter(
        (m) => String(m.organizationId) !== String(body.organizationId)
      );
      const next = nextActiveAfterLeave({
        leftOrgId: body.organizationId,
        wasActiveOrgId: profile?.organization_id,
        remaining,
      });
      if (next) {
        await setActiveOrganization(admin, {
          userId: user.id,
          organizationId: next.organizationId,
          role: next.role,
        });
      } else {
        await admin
          .from('user_profiles')
          .update({
            organization_id: null,
            active_organization_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id);
      }

      return NextResponse.json({
        ok: true,
        leftOrganizationId: body.organizationId,
        organization_id: next?.organizationId ?? null,
        role: next?.role ?? null,
        accountKept: true,
      });
    }

    const { data, error } = await userClient.rpc('leave_organization', {
      p_organization_id: Number(body.organizationId),
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, accountKept: true, ...(data || {}) });
  } catch (e: any) {
    console.error('org leave error', e);
    return NextResponse.json({ error: e?.message || 'Leave failed' }, { status: 500 });
  }
}
