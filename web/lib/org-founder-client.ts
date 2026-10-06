/**
 * Browser calls for founder org setup and admin role changes.
 * The server uses the service role; the client never writes
 * user_profiles.role / organization_id / active_organization_id.
 */

export type FounderProfileInput = {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  bio?: string | null;
  onboardingCompleted?: boolean;
  additionalRoles?: string[] | null;
};

export type FounderRequest = {
  organizationId?: number | string | null;
  pending?: Record<string, unknown> | null;
  profile?: FounderProfileInput | null;
};

export type FounderResult = {
  ok: boolean;
  organizationId?: number | string | null;
  role?: string | null;
  error?: string;
  status?: number;
};

export async function postFounderOrganization(
  accessToken: string,
  body: FounderRequest
): Promise<FounderResult> {
  const res = await fetch('/api/org/founder', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as FounderResult;
  if (!res.ok || json.ok === false) {
    return {
      ok: false,
      status: res.status,
      error: json.error || 'Could not finish organization setup.',
    };
  }
  return {
    ok: true,
    status: res.status,
    organizationId: json.organizationId ?? null,
    role: json.role ?? null,
  };
}

export async function postMemberRole(
  accessToken: string,
  body: { userId: string; organizationId: number | string; role: string }
): Promise<{ ok: boolean; role?: string; error?: string; status?: number }> {
  const res = await fetch('/api/org/members/role', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; role?: string; error?: string };
  if (!res.ok || json.ok === false) {
    return { ok: false, status: res.status, error: json.error || 'Could not change that role.' };
  }
  return { ok: true, status: res.status, role: json.role };
}
