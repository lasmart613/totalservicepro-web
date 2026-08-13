import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { ensureTeamMemberProfile, findAuthUserByEmail } from '@/lib/team-profile';

const ADMIN_ROLES = new Set([
  'admin',
  'company_admin',
  'service_manager',
  'owner',
]);

/**
 * Admin: create/link user_profiles for every invitation email that has an Auth user.
 * Fixes invitees who only exist in Authentication with no profile row.
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

    const { data: profile } = await userClient
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .maybeSingle();

    const role = (profile?.role || '').toLowerCase();
    if (!profile?.organization_id || !ADMIN_ROLES.has(role)) {
      return NextResponse.json({ error: 'Only org admins can sync team' }, { status: 403 });
    }

    const orgId = profile.organization_id;
    const admin = getSupabaseAdmin();

    const { data: invites, error: invErr } = await admin
      .from('engineer_invitations')
      .select('id, email, role, first_name, last_name, accepted')
      .eq('organization_id', orgId);

    if (invErr) {
      return NextResponse.json({ error: invErr.message }, { status: 400 });
    }

    let linked = 0;
    let created = 0;
    const details: string[] = [];

    for (const inv of invites || []) {
      const email = (inv.email || '').toLowerCase().trim();
      if (!email) continue;

      let { data: member } = await admin
        .from('user_profiles')
        .select('id, organization_id, email, role')
        .ilike('email', email)
        .maybeSingle();

      if (!member) {
        const authUser = await findAuthUserByEmail(admin, email);
        if (!authUser) {
          details.push(`${email}: no Auth account yet (still pending invite)`);
          continue;
        }

        const r = await ensureTeamMemberProfile(admin, {
          userId: authUser.id,
          email,
          organizationId: orgId,
          role: inv.role || authUser.user_metadata?.role || 'fse',
          firstName: inv.first_name || authUser.user_metadata?.first_name || null,
          lastName: inv.last_name || authUser.user_metadata?.last_name || null,
          // Keep light onboarding open if they never finished
          onboardingCompleted: false,
        });

        if (!r.ok) {
          details.push(`${email}: profile create failed — ${r.error}`);
          continue;
        }

        created++;
        linked++;
        details.push(`${email}: created user_profiles + linked to org`);
        await admin
          .from('engineer_invitations')
          .update({ accepted: true, accepted_at: new Date().toISOString() })
          .eq('id', inv.id);
        continue;
      }

      if (String(member.organization_id) === String(orgId)) {
        if (!inv.accepted) {
          await admin
            .from('engineer_invitations')
            .update({ accepted: true, accepted_at: new Date().toISOString() })
            .eq('id', inv.id);
        }
        details.push(`${email}: already on team`);
        continue;
      }

      const { error: upErr } = await admin
        .from('user_profiles')
        .update({
          organization_id: orgId,
          role: inv.role || member.role || 'fse',
          ...(inv.first_name ? { first_name: inv.first_name } : {}),
          ...(inv.last_name ? { last_name: inv.last_name } : {}),
        })
        .eq('id', member.id);

      if (upErr) {
        details.push(`${email}: ${upErr.message}`);
        continue;
      }

      await admin
        .from('engineer_invitations')
        .update({ accepted: true, accepted_at: new Date().toISOString() })
        .eq('id', inv.id);

      linked++;
      details.push(`${email}: linked existing profile to org`);
    }

    let { data: members, error: memErr } = await admin
      .from('user_profiles')
      .select('id, first_name, last_name, email, role, job_title, additional_roles, created_at, onboarding_completed')
      .eq('organization_id', orgId)
      .order('role', { ascending: true });
    if (memErr && /additional_roles|column/i.test(memErr.message || '')) {
      ({ data: members } = await admin
        .from('user_profiles')
        .select('id, first_name, last_name, email, role, job_title, created_at, onboarding_completed')
        .eq('organization_id', orgId)
        .order('role', { ascending: true }));
    }

    return NextResponse.json({
      ok: true,
      linked,
      created,
      details,
      members: members || [],
      message:
        linked > 0 || created > 0
          ? `Synced team: ${created} profile(s) created, ${linked} linked.`
          : 'No new members to link. If they never accepted the invite email, resend it.',
    });
  } catch (e: any) {
    console.error('team sync error', e);
    return NextResponse.json({ error: e?.message || 'Sync failed' }, { status: 500 });
  }
}
