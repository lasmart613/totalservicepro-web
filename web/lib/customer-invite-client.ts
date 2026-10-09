import { clearPendingSignup } from '@/lib/pending-signup';

/**
 * Browser helpers for clinic invite / claim. Talks to /api/customers/*.
 */

export type CustomerInviteSendResult = {
  ok: boolean;
  emailed?: boolean;
  skipped?: 'no_email' | 'invalid_email' | 'not_configured' | string;
  to?: string | null;
  error?: string;
};

export const CLAIM_SIGNUP_ORG_BLOCKED =
  'This clinic invite could not be claimed. A new organization was not created.';

export const CLAIM_INVITE_UNUSED =
  "This invite couldn't be used. Ask the shop that invited you to send a new invite, or sign in with the email the invite was sent to.";

/**
 * Drop a failed clinic claim so the next sign-in does not read it again.
 * Storage is cleared first. Auth metadata is a merge, so the key is set to null.
 */
export async function clearStaleClaimToken(supabase: {
  auth: {
    updateUser: (attrs: { data: { claim_token: null } }) => Promise<unknown>;
  };
}): Promise<void> {
  clearPendingSignup();
  try {
    await supabase.auth.updateUser({ data: { claim_token: null } });
  } catch {
    /* storage is already clear */
  }
}

/** Token the next email-link sign-in would try to claim. Empty means no claim error. */
export function claimTokenSeenOnSignIn(input: {
  queryClaim?: string | null;
  metadataClaim?: string | null;
  storedClaim?: string | null;
}): string {
  const query = String(input.queryClaim || '').trim();
  if (query) return query;
  const metadata = String(input.metadataClaim || '').trim();
  if (metadata) return metadata;
  return String(input.storedClaim || '').trim();
}

/**
 * Claim-link signup either finishes the claim or shows the claim error.
 * A normal signup, with no claim link, still creates the organization.
 */
export function ownerSignupAfterClaim(input: {
  fromClaimLink: boolean;
  claimed: boolean;
  error?: string | null;
}): { action: 'create-org' } | { action: 'claimed' } | { action: 'show-error'; message: string } {
  if (!input.fromClaimLink) return { action: 'create-org' };
  if (input.claimed) return { action: 'claimed' };
  const message = String(input.error || '').trim() || CLAIM_SIGNUP_ORG_BLOCKED;
  return { action: 'show-error', message };
}

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
