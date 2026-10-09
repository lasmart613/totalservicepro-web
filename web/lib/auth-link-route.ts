/**
 * Where an emailed Supabase auth link goes after it establishes a session.
 *
 * /auth/set-password is only for brand-new invite links (type=invite) and
 * password recovery (type=recovery). Magic links and email OTP sign existing
 * users in: pending team invite or clinic claim token, otherwise home.
 */

const SET_PASSWORD = '/auth/set-password';
const RESET_PASSWORD = '/reset-password';

export const TEAM_INVITE_PASSWORD_HEADING = 'Team invite — set your password';
export const RESET_PASSWORD_HEADING = 'Choose a new password';
export const CUSTOMER_CLAIM_DEST = '/company?justSetup=1';
export const DEFAULT_SIGN_IN_HOME = '/hub';

export type AuthLinkDecision =
  | { kind: 'set-password'; flow: 'invite' | 'reset' }
  | { kind: 'continue'; next: string };

export function isPasswordSetupPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const base = path.split(/[?#]/)[0];
  return (
    base === SET_PASSWORD ||
    base.startsWith(`${SET_PASSWORD}/`) ||
    base === RESET_PASSWORD ||
    base.startsWith(`${RESET_PASSWORD}/`)
  );
}

/**
 * The only local gate for next/redirect paths added here.
 * Replace this body with safeRedirectPath from web/lib/safe-redirect.ts
 * once that helper is on main. Do not add a second checker.
 */
function safeInternal(raw: string | null | undefined): string {
  if (!raw) return '';
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//')) return '';
  return value;
}

/**
 * type=magiclink and type=email (OTP for an existing user) are sign-in.
 * A stale next=/auth/set-password does not turn them into password setup.
 * PKCE drops type; invite and recovery redirects still carry next and flow.
 */
export function decideAuthCallback(input: {
  type?: string | null;
  next?: string | null;
  flow?: string | null;
}): AuthLinkDecision {
  const type = String(input.type || '').trim().toLowerCase();
  const flow = String(input.flow || '').trim().toLowerCase();
  const next = safeInternal(input.next);

  if (type === 'signup') {
    return { kind: 'continue', next: isPasswordSetupPath(next) ? '/onboarding' : next };
  }

  if (type === 'magiclink' || type === 'email') {
    return { kind: 'continue', next: isPasswordSetupPath(next) ? '' : next };
  }

  if (type === 'invite') return { kind: 'set-password', flow: 'invite' };
  if (type === 'recovery') return { kind: 'set-password', flow: 'reset' };

  if (!type && (flow === 'invite' || flow === 'reset' || flow === 'recovery' || isPasswordSetupPath(next))) {
    return { kind: 'set-password', flow: flow === 'invite' ? 'invite' : 'reset' };
  }

  return { kind: 'continue', next: isPasswordSetupPath(next) ? '' : next };
}

export function setPasswordHref(flow: 'invite' | 'reset'): string {
  return flow === 'invite' ? '/auth/set-password?flow=invite' : '/auth/set-password?flow=reset';
}

/** Recovery wins over an invite flow flag so a reset link never looks like a team invite. */
export function resolveSetPasswordFlow(input: {
  flow?: string | null;
  type?: string | null;
}): 'invite' | 'reset' {
  const type = String(input.type || '').trim().toLowerCase();
  const flow = String(input.flow || '').trim().toLowerCase();
  if (type === 'recovery' || type === 'reset' || flow === 'reset' || flow === 'recovery') return 'reset';
  if (type === 'invite' || flow === 'invite') return 'invite';
  return 'reset';
}

export function setPasswordSubtitle(flow: string | null | undefined): string {
  return String(flow || '').trim().toLowerCase() === 'invite'
    ? TEAM_INVITE_PASSWORD_HEADING
    : RESET_PASSWORD_HEADING;
}

/**
 * Link type → page. Sign-in goes to the claim flow when a team invite or
 * clinic claim token is pending, otherwise the usual home/dashboard.
 */
export function destinationAfterAuthLink(input: {
  type?: string | null;
  next?: string | null;
  flow?: string | null;
  pendingTeamInvite?: boolean;
  teamClaimDest?: string | null;
  claimToken?: string | null;
  homeDest?: string | null;
}): string {
  const decision = decideAuthCallback(input);
  if (decision.kind === 'set-password') return setPasswordHref(decision.flow);
  if (String(input.claimToken || '').trim()) return CUSTOMER_CLAIM_DEST;
  if (input.pendingTeamInvite) {
    const dest = safeInternal(input.teamClaimDest || '');
    return dest || '/onboarding/member';
  }
  if (decision.next) return decision.next;
  return safeInternal(input.homeDest || '') || DEFAULT_SIGN_IN_HOME;
}

function originOf(origin: string): string {
  return String(origin || '').trim().replace(/\/$/, '');
}

/** encodeURIComponent, not URLSearchParams (spaces must stay %20, not +). */
function callbackUrl(origin: string, pairs: Array<[string, string]>): string {
  const qs = pairs
    .filter(([, value]) => value != null && String(value) !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return `${originOf(origin)}/auth/callback?${qs}`;
}

/** generateLink redirect. type invite → flow=invite. Any other setup type → flow=reset. */
export function setupLinkRedirect(origin: string, linkType: string): string {
  const invite = String(linkType || '').trim().toLowerCase() === 'invite';
  return callbackUrl(origin, [
    ['next', SET_PASSWORD],
    ['flow', invite ? 'invite' : 'reset'],
  ]);
}

export function recoveryRedirect(origin: string): string {
  return setupLinkRedirect(origin, 'reset');
}

/** signInWithOtp / login magic link. Never /auth/set-password. */
export function loginMagicLinkRedirect(
  origin: string,
  nextPath?: string | null,
  claimToken?: string | null
): string {
  let next = safeInternal(nextPath || '');
  if (!next || isPasswordSetupPath(next)) next = DEFAULT_SIGN_IN_HOME;
  const pairs: Array<[string, string]> = [['next', next]];
  const claim = String(claimToken || '').trim();
  if (claim) pairs.push(['claim', claim]);
  return callbackUrl(origin, pairs);
}
