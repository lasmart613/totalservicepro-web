export type OrgMembership = {
  organizationId: number | string;
  name: string;
  type?: string | null;
  role: string;
  isHome: boolean;
  isActive: boolean;
};

export type PendingOrgInvite = {
  id: number;
  organizationId: number | string;
  name: string;
  role: string;
  createdAt?: string | null;
};

export type MembershipPayload = {
  ok?: boolean;
  activeOrganizationId?: number | string | null;
  role?: string | null;
  memberships: OrgMembership[];
  pendingInvites: PendingOrgInvite[];
  error?: string;
};

async function authHeader(): Promise<Record<string, string>> {
  const { getSupabaseClient } = await import('@/lib/supabase/client');
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function fetchMemberships(): Promise<MembershipPayload> {
  const headers = await authHeader();
  const res = await fetch('/api/org/memberships', { headers });
  const json = (await res.json().catch(() => ({}))) as MembershipPayload;
  if (!res.ok) {
    throw new Error(json.error || 'Could not load companies');
  }
  return {
    ...json,
    memberships: json.memberships || [],
    pendingInvites: json.pendingInvites || [],
  };
}

export async function switchOrganization(organizationId: number | string): Promise<void> {
  const headers = await authHeader();
  const res = await fetch('/api/org/switch', {
    method: 'POST',
    headers,
    body: JSON.stringify({ organizationId }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Could not switch company');
}

export async function leaveOrganization(organizationId: number | string): Promise<void> {
  const headers = await authHeader();
  const res = await fetch('/api/org/leave', {
    method: 'POST',
    headers,
    body: JSON.stringify({ organizationId }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Could not leave company');
}

export async function acceptTeamInvite(
  inviteId: number,
  leaveOrganizationId?: number | string | null
): Promise<void> {
  const headers = await authHeader();
  const res = await fetch('/api/team/claim', {
    method: 'POST',
    headers,
    body: JSON.stringify({ inviteId, leaveOrganizationId: leaveOrganizationId || undefined }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Could not accept invite');
}
