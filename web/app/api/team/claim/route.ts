import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { emailsMatch, exactEmailImatch, normalizeLookupEmail } from '@/lib/email-match';
import { ensureTeamMemberProfile } from '@/lib/team-profile';
import {
  decideClaim,
  inviteMustNotLeaveHome,
  isInvitableTeamRole,
  teamClaimMovesHome,
  teamRoleForInvite,
} from '@/lib/org-membership';
import { teamInviteJoinGate } from '@/lib/team-invite-guard';
import { authorizeInviteAccept } from '@/lib/tenant-lockdown';
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
 * A mistaken founder shop can be replaced only while it is empty.
 * Other members live in organization_memberships. Customers live in
 * organization_customers (service_organization_id). Tickets and jobs are
 * service_tickets; there is no separate jobs table.
 * A lookup error fails closed and keeps the current home.
 */
async function createdShopIsEmpty(
  admin: SupabaseClient,
  orgId: number | string,
  userId: string
): Promise<boolean> {
  const { data: members, error: memberError } = await admin
    .from('organization_memberships')
    .select('user_id')
    .eq('organization_id', orgId)
    .neq('user_id', userId)
    .limit(1);
  if (memberError || (members && members.length > 0)) return false;

  const { data: customers, error: customerError } = await admin
    .from('organization_customers')
    .select('id')
    .eq('service_organization_id', orgId)
    .limit(1);
  if (customerError || (customers && customers.length > 0)) return false;

  const { data: tickets, error: ticketError } = await admin
    .from('service_tickets')
    .select('id')
    .eq('organization_id', orgId)
    .limit(1);
  if (ticketError || (tickets && tickets.length > 0)) return false;

  return true;
}

/**
 * Invited user claims their engineer_invitations row (service role).
 * Founders with a home shop are not skipped: a pending invite to another
 * company becomes a second membership and keeps that home (moonlight).
 * The inviting company becomes the only home when this is the first membership,
 * or when the active org is an empty company this user created after the invite.
 * Empty means no other members, no organization_customers, and no service_tickets.
 * Optional leaveOrganizationId is a move (staff leave A after joining B).
 * Auth user is never deleted.
 */
export async function POST(req: NextRequest) {
  return runTeamClaim(req);
}

export async function runTeamClaim(
  req: NextRequest,
  deps: {
    createUserClient?: (
      url: string,
      anonKey: string,
      accessToken: string
    ) => {
      auth: {
        getUser: () => Promise<{
          data: { user: { id: string; email?: string | null; email_confirmed_at?: string | null; user_metadata?: Record<string, unknown> } | null };
          error: { message?: string } | null;
        }>;
      };
      from: (table: string) => unknown;
    };
    hasServiceRole?: () => boolean;
    getAdmin?: () => ReturnType<typeof getSupabaseAdmin>;
  } = {}
) {
  const serviceRoleReady = deps.hasServiceRole ?? hasServiceRole;
  const adminFor = deps.getAdmin ?? getSupabaseAdmin;
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

    const userClient = deps.createUserClient
      ? deps.createUserClient(url, anon, token)
      : createClient(url, anon, {
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

    const email = normalizeLookupEmail(user.email);
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

    if (!serviceRoleReady()) {
      return NextResponse.json({
        ok: false,
        error: 'Server cannot accept team invites (missing service role).',
      }, { status: 503 });
    }

    const admin = adminFor();
    const memberships = await listMembershipsForUser(admin, user.id);

    const emailConfirmedAt = user.email_confirmed_at ?? null;
    let inv: any = null;
    if (body.inviteId) {
      const { data: byId, error: byIdError } = await admin
        .from('engineer_invitations')
        .select('*')
        .eq('id', body.inviteId)
        .maybeSingle();
      if (byIdError) {
        return NextResponse.json({ ok: false, error: 'Could not look up the team invite.' }, { status: 500 });
      }
      inv = byId;
    }
    if (!inv) {
      const { data: openInv, error: openError } = await admin
        .from('engineer_invitations')
        .select('*')
        .filter('email', 'imatch', exactEmailImatch(email))
        .eq('accepted', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (openError) {
        return NextResponse.json({ ok: false, error: 'Could not look up the team invite.' }, { status: 500 });
      }
      if (emailsMatch(openInv?.email, email)) inv = openInv;
    }
    if (!inv && !body.inviteId) {
      const { data: anyInv, error: anyError } = await admin
        .from('engineer_invitations')
        .select('*')
        .filter('email', 'imatch', exactEmailImatch(email))
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (anyError) {
        return NextResponse.json({ ok: false, error: 'Could not look up the team invite.' }, { status: 500 });
      }
      // Accepted or expired history must not reattach someone who already left.
      if (anyInv && emailsMatch(anyInv.email, email)) {
        const historical = teamInviteJoinGate({
          accepted: anyInv.accepted,
          expires_at: anyInv.expires_at,
          created_at: anyInv.created_at,
          inviteEmail: anyInv.email,
          callerEmail: email,
          emailConfirmedAt,
        });
        if (historical.ok) inv = anyInv;
      }
    }

    if (inv) {
      const claimRole = teamRoleForInvite(inv.role);
      if (!isInvitableTeamRole(claimRole)) {
        const error =
          claimRole === 'owner'
            ? 'An owner role cannot be accepted from a team invite.'
            : claimRole === 'admin'
              ? 'A platform admin role cannot be accepted from a team invite.'
              : 'This invite role cannot be accepted.';
        return NextResponse.json({ ok: false, claimed: false, error }, { status: 403 });
      }
    }

    if (inv?.organization_id) {
      const gate = teamInviteJoinGate({
        accepted: inv.accepted,
        expires_at: inv.expires_at,
        created_at: inv.created_at,
        inviteEmail: inv.email,
        callerEmail: email,
        emailConfirmedAt,
      });
      if (!gate.ok) {
        if (body.inviteId || gate.code === 'unconfirmed') {
          return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
        }
        inv = null;
      }
    }

    if (!inv?.organization_id) {
      if (existingProf?.organization_id) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          claimed: false,
          pendingInvite: false,
          organization_id: existingProf.organization_id,
          role: existingProf.role,
          needsMemberOnboarding: existingProf.onboarding_completed !== true,
        });
      }
      // No invite is a normal signup, not an error. 404 shows up as console noise.
      return NextResponse.json({
        ok: true,
        claimed: false,
        pendingInvite: false,
      });
    }

    const accept = authorizeInviteAccept({
      callerEmail: email,
      inviteEmail: inv.email,
      inviteOrgId: inv.organization_id,
      inviteRole: inv.role,
    });
    if (!accept.ok) {
      return NextResponse.json({ ok: false, error: accept.error }, { status: accept.status });
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
        claimed: hadPending,
        pendingInvite: hadPending,
        inviteAccepted: true,
        organization_id: existingProf?.organization_id ?? inv.organization_id,
        role: existingProf?.role || inv.role || 'fse',
        needsMemberOnboarding: existingProf?.onboarding_completed !== true,
      });
    }

    let activeOrgCreatedByCaller = false;
    let activeOrgCreatedAt: string | null = null;
    if (decision.keepHome && existingProf?.organization_id) {
      const { data: curOrg } = await admin
        .from('organizations')
        .select('id, created_at, created_by')
        .eq('id', existingProf.organization_id)
        .maybeSingle();
      if (curOrg && String(curOrg.created_by) === user.id) {
        activeOrgCreatedByCaller = true;
        activeOrgCreatedAt = curOrg.created_at ?? null;
      }
    }

    // First membership becomes home. An empty company this user created at or
    // after the invite (founder onboarding by mistake) also loses home to the
    // inviting company. A shop with another member, a customer, or a ticket
    // stays moonlight: home, profile org, and profile role do not change.
    const timingMovesHome = teamClaimMovesHome({
      hasMembership: memberships.length > 0,
      activeOrgCreatedByCaller,
      activeOrgCreatedAt,
      inviteCreatedAt: inv.created_at ?? null,
      activeOrgIsEmpty: true,
    });
    let activeOrgIsEmpty = false;
    if (timingMovesHome && memberships.length > 0 && existingProf?.organization_id) {
      activeOrgIsEmpty = await createdShopIsEmpty(admin, existingProf.organization_id, user.id);
    }
    const moveHome = teamClaimMovesHome({
      hasMembership: memberships.length > 0,
      activeOrgCreatedByCaller,
      activeOrgCreatedAt,
      inviteCreatedAt: inv.created_at ?? null,
      activeOrgIsEmpty,
    });

    const added = await upsertMembership(admin, {
      userId: user.id,
      organizationId: decision.add.organizationId,
      role: decision.add.role,
      isHome: moveHome,
      syncProfile: moveHome,
    });
    if (!added.ok) {
      if (moveHome) {
        return NextResponse.json(
          { ok: false, error: added.error || 'Could not move your home organization.' },
          { status: 503 }
        );
      }
      console.warn('claim membership upsert failed, attaching profile anyway', added.error);
    }

    if (decision.leaveOrganizationId) {
      await deleteMembership(admin, {
        userId: user.id,
        organizationId: decision.leaveOrganizationId,
      });
    }

    let activateId = decision.activateOrganizationId;
    if (moveHome && !activateId) activateId = decision.add.organizationId;

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
      moonlight: decision.keepHome && !moveHome,
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
