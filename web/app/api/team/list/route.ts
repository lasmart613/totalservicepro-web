import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';

/**
 * GET /api/team/list
 * Returns all user_profiles for the caller's organization (service role).
 * Client RLS often only allows reading your own profile row — this is the reliable roster.
 */
export async function GET(req: NextRequest) {
  try {
    if (!hasServiceRole()) {
      return NextResponse.json(
        { error: 'Server missing SUPABASE_SERVICE_ROLE_KEY', members: [] },
        { status: 500 }
      );
    }

    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return NextResponse.json({ error: 'Not signed in', members: [] }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Invalid session', members: [] }, { status: 401 });
    }

    const { data: profile } = await userClient
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile?.organization_id) {
      return NextResponse.json({ error: 'No organization', members: [] }, { status: 403 });
    }

    const orgId = profile.organization_id;
    const admin = getSupabaseAdmin();

    // Run invite→profile sync lightly (same org)
    try {
      const { data: invites } = await admin
        .from('engineer_invitations')
        .select('id, email, role, first_name, last_name, accepted')
        .eq('organization_id', orgId);

      for (const inv of invites || []) {
        const email = (inv.email || '').toLowerCase().trim();
        if (!email) continue;
        const { data: mem } = await admin
          .from('user_profiles')
          .select('id, organization_id')
          .ilike('email', email)
          .maybeSingle();
        if (mem && String(mem.organization_id) !== String(orgId)) {
          await admin
            .from('user_profiles')
            .update({
              organization_id: orgId,
              role: inv.role || 'fse',
            })
            .eq('id', mem.id);
        }
      }
    } catch (e) {
      console.warn('list sync light fail', e);
    }

    const { data: members, error } = await admin
      .from('user_profiles')
      .select(
        'id, first_name, last_name, email, role, job_title, additional_roles, created_at, onboarding_completed, organization_id'
      )
      .eq('organization_id', orgId)
      .order('first_name', { ascending: true, nullsFirst: false });

    if (error) {
      return NextResponse.json({ error: error.message, members: [] }, { status: 400 });
    }

    // All invites for this org (history + pending) — client RLS often hides these
    const { data: allInvites } = await admin
      .from('engineer_invitations')
      .select('id, email, role, first_name, last_name, created_at, accepted, accepted_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(50);

    const invites = allInvites || [];
    const memberEmails = new Set(
      (members || []).map((m: any) => (m.email || '').toLowerCase().trim()).filter(Boolean)
    );

    // Pending = not accepted OR accepted but still no profile on the roster
    const pendingInvites = invites.filter((inv: any) => {
      const em = (inv.email || '').toLowerCase().trim();
      if (!inv.accepted) return true;
      // accepted but missing from roster → still show as needs attention
      return em && !memberEmails.has(em);
    });

    return NextResponse.json({
      ok: true,
      organization_id: orgId,
      members: members || [],
      pendingInvites,
      invites,
      count: (members || []).length,
      pendingCount: pendingInvites.length,
    });
  } catch (e: any) {
    console.error('team list error', e);
    return NextResponse.json(
      { error: e?.message || 'List failed', members: [] },
      { status: 500 }
    );
  }
}
