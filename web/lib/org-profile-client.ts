/**
 * Browser helper: save the signed-in user's own organization via
 * /api/org/profile (service role). Used because claimed-owner client
 * PATCH on organizations is a silent RLS no-op.
 */

export type OrgProfileSaveResult = {
  ok: boolean;
  organizationId?: string | number;
  org?: Record<string, unknown>;
  error?: string;
};

export async function saveOwnOrganizationProfile(
  accessToken: string,
  fields: Record<string, unknown>
): Promise<OrgProfileSaveResult> {
  const res = await fetch('/api/org/profile', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(fields),
  });
  const json = (await res.json().catch(() => ({}))) as OrgProfileSaveResult;
  if (!res.ok || json.ok === false) {
    return { ok: false, error: json.error || `Save failed (${res.status})` };
  }
  return {
    ok: true,
    organizationId: json.organizationId,
    org: json.org,
  };
}
