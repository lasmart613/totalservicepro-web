import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { normalizeLookupEmail } from '@/lib/email-match';
import { listMemberUserIdsForOrg } from '@/lib/org-membership-server';
import { teamSyncInviteStatus } from '@/lib/team-invite-guard';
import { getOrgRole, ORG_ROLE_LOOKUP_ERROR, orgRoleAllows, TEAM_LEAD_ROLES } from '@/lib/org-role';

/**
 * POST /api/team/sync
 * Read-only report for the Team page: pending, expired, accepted, on team.
 * Does not insert or update memberships, profiles, roles, or invites.
 * Joining happens only via POST /api/team/claim or accept_team_invite.
 */
export async function POST(req: NextRequest) {
  try {
    if (!hasServiceRole()) {
      return NextResponse.json(
        { error: 'Server missing SUPABASE_SERVICE_ROLE_KEY' },
        { status: 500 }
      );
    }

    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
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
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const { data: profile, error: profileError } = await userClient
      .from('user_profiles')
      .select('organization_id')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) {
      return NextResponse.json({ error: ORG_ROLE_LOOKUP_ERROR }, { status: 503 });
    }

    if (!profile?.organization_id) {
      return NextResponse.json({ error: 'Only org admins can sync team' }, { status: 403 });
    }

    const orgRole = await getOrgRole(userClient, user.id, profile.organization_id as string | number);
    if (!orgRole.ok) {
      return NextResponse.json({ error: orgRole.error }, { status: orgRole.status });
    }
    if (!orgRoleAllows(orgRole, TEAM_LEAD_ROLES, { founderCounts: true })) {
      return NextResponse.json({ error: 'Only org admins can sync team' }, { status: 403 });
    }

    const orgId = profile.organization_id;
    const admin = getSupabaseAdmin();

    const { data: invites, error: invErr } = await admin
      .from('engineer_invitations')
      .select('id, email, role, first_name, last_name, created_at, expires_at, accepted, accepted_at')
      .eq('organization_id', orgId);

    if (invErr) {
      return NextResponse.json({ error: invErr.message }, { status: 400 });
    }

    const rosterIds = await listMemberUserIdsForOrg(admin, orgId);
    let members: any[] | null = null;
    let memErr: { message?: string } | null = null;
    {
      const first = await admin
        .from('user_profiles')
        .select('id, first_name, last_name, email, role, job_title, additional_roles, created_at, onboarding_completed')
        .eq('organization_id', orgId)
        .order('role', { ascending: true });
      members = first.data;
      memErr = first.error;
    }
    if (memErr && /additional_roles|column/i.test(memErr.message || '')) {
      const second = await admin
        .from('user_profiles')
        .select('id, first_name, last_name, email, role, job_title, created_at, onboarding_completed')
        .eq('organization_id', orgId)
        .order('role', { ascending: true });
      members = second.data;
    }
    if (rosterIds.length) {
      const { data: extras } = await admin
        .from('user_profiles')
        .select('id, first_name, last_name, email, role, job_title, created_at, onboarding_completed')
        .in('id', rosterIds);
      const seen = new Set((members || []).map((m: { id: string }) => m.id));
      members = [...(members || [])];
      for (const row of extras || []) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          members.push(row);
        }
      }
    }

    const onTeamEmails = new Set(
      (members || [])
        .map((m: { email?: string | null }) => normalizeLookupEmail(m.email))
        .filter(Boolean)
    );

    const report = (invites || []).map((inv) => {
      const email = normalizeLookupEmail(inv.email);
      const status = teamSyncInviteStatus({
        accepted: inv.accepted,
        expires_at: inv.expires_at,
        created_at: inv.created_at,
        onTeam: !!email && onTeamEmails.has(email),
      });
      return { ...inv, email: inv.email, status };
    });

    return NextResponse.json({
      ok: true,
      readOnly: true,
      linked: 0,
      created: 0,
      invites: report,
      members: members || [],
      message: 'Team status only. People join when they accept an open invite.',
    });
  } catch (e: any) {
    console.error('team sync error', e);
    return NextResponse.json({ error: e?.message || 'Sync failed' }, { status: 500 });
  }
}
