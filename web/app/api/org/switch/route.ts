import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { switchUserOrganization } from '@/lib/org-membership-server';

/**
 * POST /api/org/switch  { organizationId }
 * Sets the caller's active org (and role for that membership). RLS follows.
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
      const result = await switchUserOrganization(admin, {
        userId: user.id,
        targetOrgId: body.organizationId,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error || 'Switch failed' }, { status: 400 });
      }
      return NextResponse.json({
        ok: true,
        organization_id: result.organizationId,
        role: result.role,
      });
    }

    const { data, error } = await userClient.rpc('switch_active_organization', {
      p_organization_id: Number(body.organizationId),
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...(data || {}) });
  } catch (e: any) {
    console.error('org switch error', e);
    return NextResponse.json({ error: e?.message || 'Switch failed' }, { status: 500 });
  }
}
