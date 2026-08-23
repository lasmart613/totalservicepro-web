import type { SupabaseClient } from '@supabase/supabase-js';
import {
  decideInviteForExistingProfile,
  decideSwitch,
  isFounderLockedRole,
  membershipRoleForInvite,
  normalizeOrgId,
  sameOrg,
  type MembershipSnapshot,
} from '@/lib/org-membership';

export type MembershipRow = {
  user_id: string;
  organization_id: number;
  role: string;
  is_home: boolean;
  organizations?: { id: number; name: string | null; type: string | null } | null;
};

export async function listMembershipsForUser(
  admin: SupabaseClient,
  userId: string
): Promise<MembershipSnapshot[]> {
  const { data, error } = await admin
    .from('organization_memberships')
    .select('organization_id, role, is_home')
    .eq('user_id', userId);
  if (error) {
    // Table may not exist until the migration is applied — fall back to profile pointer.
    console.warn('listMembershipsForUser', error.message);
    return [];
  }
  return (data || []).map((row) => ({
    organizationId: row.organization_id,
    role: row.role || 'fse',
    isHome: !!row.is_home,
  }));
}

export async function listMembershipsWithOrgs(
  admin: SupabaseClient,
  userId: string
): Promise<MembershipRow[]> {
  const { data, error } = await admin
    .from('organization_memberships')
    .select('user_id, organization_id, role, is_home, organizations(id, name, type)')
    .eq('user_id', userId)
    .order('is_home', { ascending: false });
  if (error) {
    console.warn('listMembershipsWithOrgs', error.message);
    return [];
  }
  return (data || []) as MembershipRow[];
}

export async function upsertMembership(
  admin: SupabaseClient,
  input: {
    userId: string;
    organizationId: number | string;
    role?: string | null;
    isHome?: boolean;
  }
): Promise<{ ok: boolean; error?: string }> {
  const role = membershipRoleForInvite(input.role);
  const { data: existing } = await admin
    .from('organization_memberships')
    .select('user_id, organization_id, role, is_home')
    .eq('user_id', input.userId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();

  if (existing) {
    if (existing.is_home || isFounderLockedRole(existing.role)) {
      return { ok: true };
    }
    const { error } = await admin
      .from('organization_memberships')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('user_id', input.userId)
      .eq('organization_id', input.organizationId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const { error } = await admin.from('organization_memberships').insert({
    user_id: input.userId,
    organization_id: input.organizationId,
    role,
    is_home: !!input.isHome,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function setActiveOrganization(
  admin: SupabaseClient,
  input: { userId: string; organizationId: number | string; role: string }
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await admin
    .from('user_profiles')
    .update({
      organization_id: input.organizationId,
      active_organization_id: input.organizationId,
      role: input.role,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteMembership(
  admin: SupabaseClient,
  input: { userId: string; organizationId: number | string }
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await admin
    .from('organization_memberships')
    .delete()
    .eq('user_id', input.userId)
    .eq('organization_id', input.organizationId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function listMemberUserIdsForOrg(
  admin: SupabaseClient,
  orgId: number | string
): Promise<string[]> {
  const { data, error } = await admin
    .from('organization_memberships')
    .select('user_id')
    .eq('organization_id', orgId);
  if (error) {
    console.warn('listMemberUserIdsForOrg', error.message);
    return [];
  }
  return (data || []).map((row) => row.user_id).filter(Boolean);
}

export async function applyInviteToExistingUser(
  admin: SupabaseClient,
  input: {
    userId: string;
    email: string;
    inviteOrgId: number | string;
    inviteRole?: string | null;
    profileOrgId?: number | string | null;
    profileRole?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    jobTitle?: string | null;
  }
): Promise<{ ok: boolean; linked?: boolean; moonlight?: boolean; message?: string; error?: string }> {
  const memberships = await listMembershipsForUser(admin, input.userId);
  const decision = decideInviteForExistingProfile({
    inviteOrgId: input.inviteOrgId,
    inviteRole: input.inviteRole,
    profileOrgId: input.profileOrgId,
    profileRole: input.profileRole,
    membershipOrgIds: memberships.map((m) => m.organizationId),
  });

  if (decision.action === 'already_on_team' || decision.action === 'already_member') {
    return { ok: true, linked: true, moonlight: false, message: decision.message };
  }

  const added = await upsertMembership(admin, {
    userId: input.userId,
    organizationId: input.inviteOrgId,
    role: decision.action === 'attach_first_org' ? decision.role : decision.role,
    isHome: decision.action === 'attach_first_org' ? decision.isHome : false,
  });
  if (!added.ok) return { ok: false, error: added.error };

  if (decision.action === 'attach_first_org') {
    const profileUpdate: Record<string, unknown> = {
      organization_id: input.inviteOrgId,
      active_organization_id: input.inviteOrgId,
      role: decision.role,
    };
    if (input.firstName) profileUpdate.first_name = input.firstName;
    if (input.lastName) profileUpdate.last_name = input.lastName;
    if (input.jobTitle) profileUpdate.job_title = input.jobTitle;
    const { error } = await admin.from('user_profiles').update(profileUpdate).eq('id', input.userId);
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      linked: true,
      moonlight: false,
      message: `${input.email} already has a profile — linked to your organization.`,
    };
  }

  return {
    ok: true,
    linked: true,
    moonlight: true,
    message: `${input.email} already has a company. Added as ${decision.role} on this shop without changing their home organization.`,
  };
}

export async function switchUserOrganization(
  admin: SupabaseClient,
  input: { userId: string; targetOrgId: number | string }
): Promise<{ ok: boolean; organizationId?: number | string; role?: string; error?: string }> {
  const memberships = await listMembershipsForUser(admin, input.userId);
  const decision = decideSwitch({ targetOrgId: input.targetOrgId, memberships });
  if (!decision.ok) return { ok: false, error: decision.error };
  const applied = await setActiveOrganization(admin, {
    userId: input.userId,
    organizationId: decision.organizationId,
    role: decision.role,
  });
  if (!applied.ok) return { ok: false, error: applied.error };
  return { ok: true, organizationId: decision.organizationId, role: decision.role };
}

export { sameOrg, normalizeOrgId };
