/**
 * Team-invite claim routing.
 *
 * Invited users who click the email and then use Forgot Password often land
 * in founder onboarding. Completing that wizard used to create a new shop
 * and leave engineer_invitations.accepted = false. These helpers decide
 * when an invite is in play so signup, password reset, and onboarding
 * join the invited org and mark the invite accepted instead.
 */

export type InviteClaimResult = {
  ok: boolean;
  claimed?: boolean;
  skipped?: boolean;
  pendingInvite?: boolean;
  inviteAccepted?: boolean;
  organization_id?: string | number | null;
  role?: string | null;
  needsMemberOnboarding?: boolean;
  moonlight?: boolean;
  error?: string;
  status?: number;
};

/** True when this session should join an invited org rather than create a new one. */
export function inviteInPlay(result: InviteClaimResult | null | undefined): boolean {
  if (!result) return false;
  if (result.pendingInvite) return true;
  if (result.claimed) return true;
  return false;
}

const FOUNDER_ROLES = new Set(['company_admin', 'admin', 'owner', 'parts_supplier', 'supplier']);

/**
 * Team-member setup, not company onboarding.
 * A new service-company admin has an org and onboarding_completed=false, and the
 * claim API reports needsMemberOnboarding for that too. That flag alone must not
 * send them to /onboarding/member. Invited members still do.
 */
export function shouldSendToMemberOnboarding(
  result: InviteClaimResult | null | undefined
): boolean {
  if (!result || result.ok === false) return false;
  const role = String(result.role || '').toLowerCase();
  if (FOUNDER_ROLES.has(role) && !inviteInPlay(result)) return false;
  if (inviteInPlay(result)) return true;
  if (
    result.inviteAccepted &&
    result.organization_id &&
    result.needsMemberOnboarding !== false &&
    !FOUNDER_ROLES.has(role)
  ) {
    return true;
  }
  return false;
}

/**
 * Where to send someone after signup, password reset, or onboarding
 * when a team invite may be in play.
 *
 * Invitees never go to founder `/onboarding` — that path creates a new company.
 */
export function destAfterInviteClaim(
  result: InviteClaimResult | null | undefined,
  fallback: string = '/onboarding'
): string {
  if (inviteInPlay(result)) {
    if (result?.needsMemberOnboarding === false && result.organization_id) return '/hub';
    return '/onboarding/member';
  }
  if (result?.organization_id) {
    const role = String(result.role || '').toLowerCase();
    // A new company admin already has an org and onboarding_completed=false.
    // That is company setup, not team-member setup.
    if (FOUNDER_ROLES.has(role)) {
      return result.needsMemberOnboarding === false ? '/hub' : fallback;
    }
    return result.needsMemberOnboarding === false ? '/hub' : '/onboarding/member';
  }
  return fallback;
}

/**
 * Where login/signup goes after an email-based team claim.
 * No invite token is required. `{ ok:true, claimed:false, pendingInvite:false }`
 * stays on the requested page (founder `/onboarding`). A claimed invite goes to
 * member setup.
 */
export function routeAfterTeamClaim(
  claim: InviteClaimResult | null | undefined,
  requestedDest: string
): string {
  if (!inviteInPlay(claim)) return requestedDest;
  const fallback = requestedDest.startsWith('/onboarding') ? '/onboarding/member' : requestedDest;
  return destAfterInviteClaim(claim, fallback);
}

export async function postTeamClaim(
  accessToken: string,
  body?: Record<string, unknown>
): Promise<InviteClaimResult> {
  const res = await fetch('/api/team/claim', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
  const json = (await res.json().catch(() => ({}))) as InviteClaimResult;
  return {
    ...json,
    ok: res.ok && json.ok !== false,
    status: res.status,
  };
}
