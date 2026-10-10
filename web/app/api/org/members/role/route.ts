import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { isInvitableTeamRole, sameOrg, teamRoleForInvite } from '@/lib/org-membership';
import { rowFounderFlag, sameUser } from '@/lib/team-remove';
import {
  PLATFORM_ADMIN_ROLE,
  callerMayChangeMemberRole,
  decideMemberRoleChange,
  memberRoleSelfRaiseRefused,
  memberRoleTargetIsLocked,
  normalizeRole,
  refusedAssignableTeamRole,
} from '@/lib/tenant-lockdown';

type RoleBody = {
  userId?: string;
  organizationId?: number | string;
  role?: string;
};

type RoleUserClient = {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string; email?: string | null } | null };
      error: { message?: string } | null;
    }>;
  };
};

type RoleDeps = {
  createUserClient?: (url: string, anonKey: string, accessToken: string) => RoleUserClient;
  hasServiceRole?: () => boolean;
  getAdmin?: () => ReturnType<typeof getSupabaseAdmin>;
};

/**
 * POST /api/org/members/role
 * { userId, organizationId, role }
 *
 * Caller must be company_admin or owner on their membership in that org,
 * or the founder of that org (organizations.created_by, or a founder flag
 * on that same membership). user_profiles.role is not authority.
 * The new role is trimmed and lowercased and must be an invitable team role.
 * Owner, platform admin, and every other role are refused with no writes.
 * The org owner and founder cannot have their role changed.
 * A caller cannot raise their own role.
 * When user_profiles.organization_id is this org, user_profiles.role is set
 * to the same membership role and is never platform admin. The other org
 * pointer does not trigger that copy.
 */
export async function POST(req: NextRequest) {
  return runChangeMemberRole(req);
}

export async function runChangeMemberRole(req: NextRequest, deps: RoleDeps = {}) {
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
        { error: 'Server cannot change roles (missing service role).' },
        { status: 503 }
      );
    }

    const userClient = deps.createUserClient
      ? deps.createUserClient(url, anon, token)
      : (createClient(url, anon, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { autoRefreshToken: false, persistSession: false },
        }) as RoleUserClient);
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as RoleBody;
    const targetUserId = String(body.userId || '').trim();
    if (!targetUserId || body.organizationId == null || body.organizationId === '') {
      return NextResponse.json(
        { error: 'userId, organizationId, and role are required.' },
        { status: 400 }
      );
    }

    const admin = (deps.getAdmin ?? getSupabaseAdmin)();
    const { data: callerMembership, error: callerError } = await admin
      .from('organization_memberships')
      .select('*')
      .eq('user_id', user.id)
      .eq('organization_id', body.organizationId)
      .maybeSingle();
    if (callerError) {
      return NextResponse.json({ error: callerError.message }, { status: 500 });
    }

    const { data: orgRow, error: orgError } = await admin
      .from('organizations')
      .select('id, created_by')
      .eq('id', body.organizationId)
      .maybeSingle();
    if (orgError) {
      return NextResponse.json({ error: orgError.message }, { status: 500 });
    }

    const createdBy = orgRow?.created_by ? String(orgRow.created_by) : null;
    const callerFounder = rowFounderFlag(callerMembership);
    if (
      !callerMayChangeMemberRole({
        membershipRole: callerMembership?.role,
        founder: callerFounder,
        isOrgCreator: sameUser(user.id, createdBy),
      })
    ) {
      return NextResponse.json(
        { error: 'Only an admin of this organization can change roles.' },
        { status: 403 }
      );
    }

    const nextRole = teamRoleForInvite(body.role);
    if (
      memberRoleSelfRaiseRefused({
        callerId: user.id,
        targetUserId,
        membershipRole: callerMembership?.role,
        nextRole,
      })
    ) {
      return NextResponse.json(
        { error: 'Cannot assign a role above your own.' },
        { status: 403 }
      );
    }

    const roleRefusal = refusedAssignableTeamRole(body.role);
    if (roleRefusal || !isInvitableTeamRole(nextRole) || nextRole === PLATFORM_ADMIN_ROLE) {
      return NextResponse.json(
        { error: roleRefusal || 'That role cannot be assigned.' },
        { status: 403 }
      );
    }

    const membershipRole = normalizeRole(callerMembership?.role);
    const callerRoleForRank =
      membershipRole === 'company_admin' || membershipRole === 'owner' ? membershipRole : 'company_admin';
    const decision = decideMemberRoleChange({
      callerRole: callerRoleForRank,
      targetRole: nextRole,
      sameOrganization: true,
    });
    if (!decision.ok) {
      return NextResponse.json({ error: decision.error }, { status: decision.status });
    }
    const storedRole = decision.role;
    if (storedRole === PLATFORM_ADMIN_ROLE || !isInvitableTeamRole(storedRole)) {
      return NextResponse.json(
        { error: 'Organization memberships cannot use the platform admin role.' },
        { status: 403 }
      );
    }

    const { data: targetMembership, error: targetError } = await admin
      .from('organization_memberships')
      .select('*')
      .eq('user_id', targetUserId)
      .eq('organization_id', body.organizationId)
      .maybeSingle();
    if (targetError) {
      return NextResponse.json({ error: targetError.message }, { status: 500 });
    }
    if (!targetMembership) {
      return NextResponse.json(
        { error: 'That person is not a member of this organization.' },
        { status: 404 }
      );
    }

    const targetIsOwner = normalizeRole(targetMembership.role) === 'owner';
    if (
      memberRoleTargetIsLocked({
        membershipRole: targetMembership.role,
        founder: rowFounderFlag(targetMembership),
        isOrgCreator: sameUser(targetUserId, createdBy),
      })
    ) {
      return NextResponse.json(
        {
          error: targetIsOwner
            ? 'The organization owner cannot have their role changed.'
            : 'The organization founder cannot have their role changed.',
        },
        { status: 403 }
      );
    }

    const { data: targetProfile, error: profileReadError } = await admin
      .from('user_profiles')
      .select('organization_id')
      .eq('id', targetUserId)
      .maybeSingle();
    if (profileReadError) {
      return NextResponse.json({ error: profileReadError.message }, { status: 500 });
    }

    const { error: membershipError } = await admin
      .from('organization_memberships')
      .update({ role: storedRole, updated_at: new Date().toISOString() })
      .eq('user_id', targetUserId)
      .eq('organization_id', body.organizationId);
    if (membershipError) {
      return NextResponse.json({ error: membershipError.message }, { status: 500 });
    }

    const profileHomeHere = sameOrg(targetProfile?.organization_id, body.organizationId);
    if (profileHomeHere) {
      const { error: profileError } = await admin
        .from('user_profiles')
        .update({ role: storedRole, updated_at: new Date().toISOString() })
        .eq('id', targetUserId);
      if (profileError) {
        return NextResponse.json({ error: profileError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, role: storedRole, organizationId: body.organizationId });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Role change failed';
    console.error('member role', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
