/**
 * Browser helpers for clinic invite / claim. Talks to /api/customers/*.
 */

export type CustomerInviteSendResult = {
  ok: boolean;
  emailed?: boolean;
  skipped?: 'no_email' | 'invalid_email' | 'not_configured' | string;
  to?: string | null;
  error?: string;
  signupUrl?: string | null;
};

export type CustomerInvitePreview = {
  valid: boolean;
  companyName?: string;
  email?: string;
  expired?: boolean;
  error?: string;
};

export type CustomerClaimResult = {
  ok: boolean;
  claimed?: boolean;
  organizationId?: string | number | null;
  error?: string;
};

export async function sendCustomerInviteEmail(
  accessToken: string,
  customerOrganizationId: string | number
): Promise<CustomerInviteSendResult> {
  const res = await fetch('/api/customers/invite', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ customer_organization_id: customerOrganizationId }),
  });
  const json = (await res.json().catch(() => ({}))) as CustomerInviteSendResult;
  return {
    ok: res.ok && json.ok !== false,
    emailed: !!json.emailed,
    skipped: json.skipped,
    to: json.to ?? null,
    error: json.error,
    signupUrl: json.signupUrl ?? null,
  };
}

export async function previewCustomerInvite(token: string): Promise<CustomerInvitePreview> {
  const res = await fetch(`/api/customers/invite?token=${encodeURIComponent(token)}`);
  const json = (await res.json().catch(() => ({}))) as CustomerInvitePreview;
  return {
    valid: !!json.valid,
    companyName: json.companyName,
    email: json.email,
    expired: json.expired,
    error: json.error,
  };
}

export async function claimCustomerInvite(
  accessToken: string,
  token: string
): Promise<CustomerClaimResult> {
  const res = await fetch('/api/customers/claim', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ token }),
  });
  const json = (await res.json().catch(() => ({}))) as CustomerClaimResult;
  return {
    ok: res.ok && json.ok !== false,
    claimed: !!json.claimed,
    organizationId: json.organizationId ?? null,
    error: json.error,
  };
}
