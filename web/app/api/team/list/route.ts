import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { listMemberUserIdsForOrg } from '@/lib/org-membership-server';

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

    const teamSelectFull =
      'id, first_name, last_name, email, role, job_title, additional_roles, created_at, onboarding_completed, organization_id';
    const teamSelectSafe =
      'id, first_name, last_name, email, role, job_title, created_at, onboarding_completed, organization_id';

    const memberIds = await listMemberUserIdsForOrg(admin, orgId);

    let { data: members, error } = await admin
      .from('user_profiles')
      .select(teamSelectFull)
      .eq('organization_id', orgId)
      .order('first_name', { ascending: true, nullsFirst: false });

    // Older DBs may not have additional_roles yet
    if (error && /additional_roles|column/i.test(error.message || '')) {
      ({ data: members, error } = await admin
        .from('user_profiles')
        .select(teamSelectSafe)
        .eq('organization_id', orgId)
        .order('first_name', { ascending: true, nullsFirst: false }));
    }

    if (memberIds.length) {
      let extras: any[] | null = null;
      let extraErr = error;
      ({ data: extras, error: extraErr } = await admin
        .from('user_profiles')
        .select(error ? teamSelectSafe : teamSelectFull)
        .in('id', memberIds)
        .order('first_name', { ascending: true, nullsFirst: false }));
      if (extraErr && /additional_roles|column/i.test(extraErr.message || '')) {
        ({ data: extras } = await admin
          .from('user_profiles')
          .select(teamSelectSafe)
          .in('id', memberIds)
          .order('first_name', { ascending: true, nullsFirst: false }));
        extraErr = null as any;
      }
      if (!extraErr && extras) {
        const seen = new Set((members || []).map((m: any) => m.id));
        members = [...(members || [])];
        for (const row of extras) {
          if (!seen.has(row.id)) {
            seen.add(row.id);
            members.push(row);
          }
        }
      }
    }

    if (error) {
      return NextResponse.json({ error: error.message, members: [] }, { status: 400 });
    }

    const { data: orgRoles } = await admin
      .from('organization_memberships')
      .select('user_id, role, is_home')
      .eq('organization_id', orgId);
    const roleByUser = new Map(
      (orgRoles || []).map((r: any) => [r.user_id, { role: r.role, is_home: r.is_home }])
    );
    members = (members || []).map((m: any) => {
      const mem = roleByUser.get(m.id);
      if (!mem) return m;
      return { ...m, role: mem.role, is_home: mem.is_home };
    });

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

    // Pending = invite not accepted AND that email is not already on the roster
    const pendingInvites = invites.filter((inv: any) => {
      const em = (inv.email || '').toLowerCase().trim();
      if (em && memberEmails.has(em)) return false;
      return !inv.accepted;
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
