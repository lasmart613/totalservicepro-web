import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { sameOrg } from '@/lib/org-membership';
import {
  REMOVE_MEMBER_ERRORS,
  REMOVE_MEMBER_RPC,
  callerMayRemoveTeamMembers,
  decideAdminRemoveMember,
  rowFounderFlag,
  sameUser,
} from '@/lib/team-remove';

type RemoveBody = {
  userId?: string;
  organizationId?: number | string;
};

type RemoveUserClient = {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string; email?: string | null } | null };
      error: { message?: string } | null;
    }>;
  };
};

type RemoveDeps = {
  createUserClient?: (url: string, anonKey: string, accessToken: string) => RemoveUserClient;
  hasServiceRole?: () => boolean;
  getAdmin?: () => ReturnType<typeof getSupabaseAdmin>;
};

function orgIdValue(value: unknown): number | string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * POST or DELETE /api/team/members/remove
 * { userId, organizationId }
 *
 * Caller must be company_admin or owner on their membership in that org,
 * the org's created_by, or a founder flag on that same membership.
 * A profile role of admin and a founder flag on another org do not qualify.
 * Service role performs one RPC so the membership delete, pointer retarget,
 * and pending-invite revoke commit together or not at all.
 */
export async function POST(req: NextRequest) {
  return runRemoveTeamMember(req);
}

export async function DELETE(req: NextRequest) {
  return runRemoveTeamMember(req);
}

export async function runRemoveTeamMember(req: NextRequest, deps: RemoveDeps = {}) {
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

    const serviceRoleReady = deps.hasServiceRole ?? hasServiceRole;
    if (!serviceRoleReady()) {
      return NextResponse.json(
        { error: 'Server cannot remove team members (missing service role).' },
        { status: 503 }
      );
    }

    const userClient = deps.createUserClient
      ? deps.createUserClient(url, anon, token)
      : (createClient(url, anon, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { autoRefreshToken: false, persistSession: false },
        }) as RemoveUserClient);

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const urlParams = new URL(req.url).searchParams;
    const body = (await req.json().catch(() => ({}))) as RemoveBody;
    const targetUserId = String(body.userId || urlParams.get('userId') || '').trim();
    const organizationId = orgIdValue(
      body.organizationId != null && body.organizationId !== ''
        ? body.organizationId
        : urlParams.get('organizationId')
    );
    if (!targetUserId || organizationId == null) {
      return NextResponse.json(
        { error: 'userId and organizationId are required.' },
        { status: 400 }
      );
    }

    const admin = (deps.getAdmin ?? getSupabaseAdmin)();

    const { data: callerMembership, error: callerMembershipError } = await admin
      .from('organization_memberships')
      .select('*')
      .eq('user_id', user.id)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (callerMembershipError) {
      console.error('remove member caller membership', callerMembershipError.message);
      return NextResponse.json({ error: REMOVE_MEMBER_ERRORS.db }, { status: 503 });
    }

    const { data: orgRow, error: orgError } = await admin
      .from('organizations')
      .select('id, created_by')
      .eq('id', organizationId)
      .maybeSingle();
    if (orgError) {
      console.error('remove member org', orgError.message);
      return NextResponse.json({ error: REMOVE_MEMBER_ERRORS.db }, { status: 503 });
    }

    const createdBy = orgRow?.created_by ? String(orgRow.created_by) : null;
    // This org only. Profile founder flags and other orgs do not grant this.
    const callerMayRemove = callerMayRemoveTeamMembers({
      role: callerMembership?.role,
      founder: rowFounderFlag(callerMembership),
      isOrgCreator: sameUser(user.id, createdBy),
    });

    const { data: targetMembership, error: targetMembershipError } = await admin
      .from('organization_memberships')
      .select('*')
      .eq('user_id', targetUserId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (targetMembershipError) {
      console.error('remove member target membership', targetMembershipError.message);
      return NextResponse.json({ error: REMOVE_MEMBER_ERRORS.db }, { status: 503 });
    }

    const { data: targetProfile, error: targetProfileError } = await admin
      .from('user_profiles')
      .select('*')
      .eq('id', targetUserId)
      .maybeSingle();
    if (targetProfileError) {
      console.error('remove member target profile', targetProfileError.message);
      return NextResponse.json({ error: REMOVE_MEMBER_ERRORS.db }, { status: 503 });
    }

    const targetProfileHere = !!(
      targetProfile && sameOrg(targetProfile.organization_id, organizationId)
    );
    const decision = decideAdminRemoveMember({
      callerMayRemove,
      callerId: user.id,
      targetUserId,
      targetIsMember: !!targetMembership,
      targetRole: targetMembership?.role,
      targetProfileRole: targetProfile?.role,
      targetProfileInOrg: targetProfileHere,
      targetFounder: rowFounderFlag(targetMembership) || rowFounderFlag(targetProfile),
      targetIsOrgCreator: sameUser(targetUserId, createdBy),
    });
    if (!decision.ok) {
      return NextResponse.json({ error: decision.error, code: decision.code }, { status: 403 });
    }

    const { data, error } = await admin.rpc(REMOVE_MEMBER_RPC, {
      p_user_id: targetUserId,
      p_organization_id: organizationId,
      p_actor_id: user.id,
    });
    if (error || !data || (data as { ok?: boolean }).ok !== true) {
      const payload = (data || {}) as { ok?: boolean; status?: number; error?: string; code?: string };
      if (payload.ok === false && (payload.status === 403 || payload.status === 400)) {
        return NextResponse.json(
          { error: payload.error || REMOVE_MEMBER_ERRORS.db, code: payload.code },
          { status: payload.status }
        );
      }
      console.error('remove member rpc', error?.message || 'empty result');
      return NextResponse.json({ error: REMOVE_MEMBER_ERRORS.db }, { status: 503 });
    }

    const result = data as {
      revoked_invite_count?: number;
      home_moved_to?: number | string | null;
      profile_cleared?: boolean;
    };
    const movedRaw = result.home_moved_to;
    const homeMovedTo =
      movedRaw == null || movedRaw === ''
        ? null
        : Number(movedRaw);
    return NextResponse.json({
      ok: true,
      removed: true,
      userId: targetUserId,
      organizationId,
      homeMovedTo: homeMovedTo != null && Number.isFinite(homeMovedTo) ? homeMovedTo : null,
      profileCleared: result.profile_cleared === true,
      revokedInviteCount: Number(result.revoked_invite_count || 0),
      accountKept: true,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Remove failed';
    console.error('remove member', message);
    return NextResponse.json({ error: REMOVE_MEMBER_ERRORS.db }, { status: 503 });
  }
}
