import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { ensureTeamMemberProfile } from '@/lib/team-profile';

/**
 * Invited user claims their engineer_invitations row (service role).
 * Client-side claim often fails: invitee can't SELECT invitations / UPDATE own org under RLS.
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
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user?.email) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const email = user.email.toLowerCase().trim();
    const meta = user.user_metadata || {};

    const founderRoles = new Set(['company_admin', 'admin', 'owner', 'parts_supplier']);
    const { data: existingProf } = await userClient
      .from('user_profiles')
      .select('organization_id, role, onboarding_completed')
      .eq('id', user.id)
      .maybeSingle();
    const signupKind = String(meta.signup_kind || '').toLowerCase();
    const alreadyFounder =
      !meta.invited_member &&
      (founderRoles.has(String(existingProf?.role || meta.role || '').toLowerCase()) ||
        ['company', 'owner', 'supplier'].includes(signupKind));
    if (alreadyFounder && (existingProf?.organization_id || signupKind)) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        organization_id: existingProf.organization_id,
        role: existingProf.role,
        needsMemberOnboarding: false,
      });
    }

    if (existingProf?.organization_id) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        organization_id: existingProf.organization_id,
        role: existingProf.role,
        needsMemberOnboarding: existingProf.onboarding_completed !== true,
      });
    }

    if (!hasServiceRole()) {
      // Best-effort client path (same as before)
      const { data: invites } = await userClient
        .from('engineer_invitations')
        .select('*')
        .eq('email', email)
        .eq('accepted', false)
        .order('created_at', { ascending: false })
        .limit(1);

      const inv = invites?.[0];
      const orgId = inv?.organization_id ?? null;
      const role = inv?.role || 'fse';

      if (!orgId) {
        return NextResponse.json({
          ok: false,
          error: 'No pending invitation found for this email (and no service role on server).',
        }, { status: 404 });
      }

      const { error: upErr } = await userClient
        .from('user_profiles')
        .upsert(
          {
            id: user.id,
            email,
            organization_id: orgId,
            role,
            first_name: inv?.first_name || meta.first_name || null,
            last_name: inv?.last_name || meta.last_name || null,
            onboarding_completed: existingProf?.onboarding_completed === true,
          },
          { onConflict: 'id' }
        );
      if (upErr) {
        return NextResponse.json({ error: upErr.message }, { status: 400 });
      }
      if (inv?.id) {
        await userClient
          .from('engineer_invitations')
          .update({ accepted: true, accepted_at: new Date().toISOString() })
          .eq('id', inv.id);
      }
      return NextResponse.json({ ok: true, organization_id: orgId, role });
    }

    const admin = getSupabaseAdmin();

    // Prefer open invite; else most recent invite for this email
    let { data: inv } = await admin
      .from('engineer_invitations')
      .select('*')
      .eq('email', email)
      .eq('accepted', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!inv) {
      return NextResponse.json({
        ok: false,
        error: 'No pending invitation found for this email.',
      }, { status: 404 });
    }

    const orgId = inv?.organization_id ?? null;
    const role = inv?.role || 'fse';

    if (!orgId) {
      return NextResponse.json({
        ok: false,
        error: 'No invitation found for this email.',
      }, { status: 404 });
    }

    const alreadyDone = existingProf?.onboarding_completed === true;
    // Do not force onboarding_completed here — member onboarding collects name/phone
    const r = await ensureTeamMemberProfile(admin, {
      userId: user.id,
      email,
      organizationId: orgId,
      role,
      firstName: inv?.first_name || meta.first_name || null,
      lastName: inv?.last_name || meta.last_name || null,
      jobTitle: meta.job_title || null,
      onboardingCompleted: alreadyDone,
    });

    if (!r.ok) {
      return NextResponse.json({ error: r.error || 'Profile upsert failed' }, { status: 400 });
    }

    if (inv?.id) {
      await admin
        .from('engineer_invitations')
        .update({ accepted: true, accepted_at: new Date().toISOString() })
        .eq('id', inv.id);
    }

    return NextResponse.json({
      ok: true,
      organization_id: orgId,
      role,
      claimed: true,
      needsMemberOnboarding: !alreadyDone,
    });
  } catch (e: any) {
    console.error('team claim error', e);
    return NextResponse.json({ error: e?.message || 'Claim failed' }, { status: 500 });
  }
}
