import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { ensureTeamMemberProfile } from '@/lib/team-profile';
import {
  decideClaim,
  inviteMustNotLeaveHome,
} from '@/lib/org-membership';
import {
  deleteMembership,
  listMembershipsForUser,
  setActiveOrganization,
  upsertMembership,
} from '@/lib/org-membership-server';

type ClaimBody = {
  inviteId?: number;
  leaveOrganizationId?: number | string | null;
};

/**
 * Invited user claims their engineer_invitations row (service role).
 * Founders with a home shop are not skipped: a pending invite to another
 * company becomes a second membership (moonlight). Optional leaveOrganizationId
 * is a move (staff leave A after joining B). Auth user is never deleted.
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
    let body: ClaimBody = {};
    try {
      body = (await req.json()) as ClaimBody;
    } catch {
      body = {};
    }

    const { data: existingProf } = await userClient
      .from('user_profiles')
      .select('organization_id, role, onboarding_completed')
      .eq('id', user.id)
      .maybeSingle();

    if (!hasServiceRole()) {
      return NextResponse.json({
        ok: false,
        error: 'Server cannot accept team invites (missing service role).',
      }, { status: 503 });
    }

    const admin = getSupabaseAdmin();
    const memberships = await listMembershipsForUser(admin, user.id);

    let inv: any = null;
    if (body.inviteId) {
      const { data: byId } = await admin
        .from('engineer_invitations')
        .select('*')
        .eq('id', body.inviteId)
        .maybeSingle();
      const invEmail = String(byId?.email || '').toLowerCase().trim();
      if (byId && (!invEmail || invEmail === email)) inv = byId;
    }
    if (!inv) {
      const { data: openInv } = await admin
        .from('engineer_invitations')
        .select('*')
        .ilike('email', email)
        .eq('accepted', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      inv = openInv;
    }
    if (!inv && !body.inviteId) {
      const { data: anyInv } = await admin
        .from('engineer_invitations')
        .select('*')
        .ilike('email', email)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      inv = anyInv;
    }

    if (!inv?.organization_id) {
      if (existingProf?.organization_id) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          organization_id: existingProf.organization_id,
          role: existingProf.role,
          needsMemberOnboarding: existingProf.onboarding_completed !== true,
        });
      }
      return NextResponse.json({
        ok: false,
        error: 'No pending invitation found for this email.',
      }, { status: 404 });
    }

    const leaveGuard = inviteMustNotLeaveHome({
      leaveOrganizationId: body.leaveOrganizationId,
      memberships,
    });
    if (!leaveGuard.ok) {
      return NextResponse.json({ error: leaveGuard.error }, { status: 403 });
    }

    const decision = decideClaim({
      inviteOrgId: inv.organization_id,
      inviteRole: inv.role || 'fse',
      memberships,
      leaveOrganizationId: body.leaveOrganizationId,
    });

    if (decision.action === 'error') {
      return NextResponse.json({ error: decision.error }, { status: 400 });
    }

    const hadPending = inv.accepted !== true;

    if (decision.action === 'skip' || decision.action === 'none') {
      if (inv.id && hadPending) {
        await admin
          .from('engineer_invitations')
          .update({ accepted: true, accepted_at: new Date().toISOString() })
          .eq('id', inv.id);
      }
      return NextResponse.json({
        ok: true,
        skipped: true,
        claimed: true,
        pendingInvite: hadPending,
        inviteAccepted: true,
        organization_id: existingProf?.organization_id ?? inv.organization_id,
        role: existingProf?.role || inv.role || 'fse',
        needsMemberOnboarding: existingProf?.onboarding_completed !== true,
      });
    }

    const added = await upsertMembership(admin, {
      userId: user.id,
      organizationId: decision.add.organizationId,
      role: decision.add.role,
      isHome: false,
    });
    if (!added.ok) {
      console.warn('claim membership upsert failed, attaching profile anyway', added.error);
    }

    if (decision.leaveOrganizationId) {
      await deleteMembership(admin, {
        userId: user.id,
        organizationId: decision.leaveOrganizationId,
      });
    }

    let activateId = decision.activateOrganizationId;
    // Forgot-password invitees often complete founder onboarding by mistake and
    // create a new company. If that org was created after this invite, join the
    // inviting company as the active org instead of moonlight-only.
    if (!activateId && inv.organization_id && existingProf?.organization_id) {
      const { data: curOrg } = await admin
        .from('organizations')
        .select('id, created_at, created_by')
        .eq('id', existingProf.organization_id)
        .maybeSingle();
      const inviteAt = inv.created_at ? new Date(inv.created_at).getTime() : 0;
      const orgAt = curOrg?.created_at ? new Date(curOrg.created_at).getTime() : 0;
      if (curOrg && String(curOrg.created_by) === user.id && orgAt >= inviteAt) {
        activateId = inv.organization_id;
      }
    }

    if (activateId) {
      const alreadyDone = existingProf?.onboarding_completed === true;
      const r = await ensureTeamMemberProfile(admin, {
        userId: user.id,
        email,
        organizationId: activateId,
        role: decision.add.role,
        firstName: inv.first_name || meta.first_name || null,
        lastName: inv.last_name || meta.last_name || null,
        jobTitle: meta.job_title || null,
        onboardingCompleted: alreadyDone,
      });
      if (!r.ok) {
        return NextResponse.json({ error: r.error || 'Profile upsert failed' }, { status: 400 });
      }
    } else if (decision.leaveOrganizationId && sameActive(existingProf?.organization_id, decision.leaveOrganizationId)) {
      await setActiveOrganization(admin, {
        userId: user.id,
        organizationId: decision.add.organizationId,
        role: decision.add.role,
      });
    }

    if (inv.id) {
      await admin
        .from('engineer_invitations')
        .update({ accepted: true, accepted_at: new Date().toISOString() })
        .eq('id', inv.id);
    }

    const { data: after } = await admin
      .from('user_profiles')
      .select('organization_id, role, onboarding_completed')
      .eq('id', user.id)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      organization_id: after?.organization_id ?? existingProf?.organization_id ?? inv.organization_id,
      role: after?.role ?? existingProf?.role,
      claimed: true,
      pendingInvite: hadPending,
      inviteAccepted: true,
      moonlight: decision.keepHome,
      leftOrganizationId: decision.leaveOrganizationId,
      needsMemberOnboarding: after?.onboarding_completed !== true,
    });
  } catch (e: any) {
    console.error('team claim error', e);
    return NextResponse.json({ error: e?.message || 'Claim failed' }, { status: 500 });
  }
}

function sameActive(a: number | string | null | undefined, b: number | string | null | undefined) {
  return a != null && b != null && String(a) === String(b);
}
