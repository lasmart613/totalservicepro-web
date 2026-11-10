/**
 * Where an emailed Supabase auth link goes after it establishes a session.
 *
 * /auth/set-password is only for brand-new invite links (type=invite) and
 * password recovery (type=recovery). Magic links and email OTP sign existing
 * users in: pending team invite or clinic claim token, otherwise home.
 *
 * Every next or redirect path goes through safeRedirectPath. An empty result
 * lets onboarding win, matching the callback and set-password pages.
 */

import { safeRedirectPath } from './safe-redirect.ts';
import { PRODUCTION_SITE_ORIGIN } from './site-origin.ts';

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
  const next = safeRedirectPath(input.next, PRODUCTION_SITE_ORIGIN, '');

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
    const dest = safeRedirectPath(input.teamClaimDest, PRODUCTION_SITE_ORIGIN, '');
    return dest || '/onboarding/member';
  }
  if (decision.next) return decision.next;
  return safeRedirectPath(input.homeDest, PRODUCTION_SITE_ORIGIN, '') || DEFAULT_SIGN_IN_HOME;
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

/**
 * Password-reset redirect. Path only, no query.
 *
 * resetPasswordForEmail puts this in the email as redirect_to. The live
 * message used redirect_to=https://repairplanet.net (the Site URL). This
 * helper was sending /auth/callback with a next and flow query. Auth keeps
 * redirect_to only when it matches the Site URL or an Additional Redirect
 * URL, and otherwise substitutes the Site URL. The implicit-flow client
 * then signed the user in on the home page and the recovery token was spent.
 *
 * Invite links still use the callback (flow=invite). PKCE drops type, and
 * the callback needs that flag. Recovery defaults to the reset form.
 */
export function recoveryRedirect(origin: string): string {
  return `${originOf(origin)}/auth/set-password`;
}

/** generateLink redirect. type invite → callback with flow=invite. Any other setup type → recovery page. */
export function setupLinkRedirect(origin: string, linkType: string): string {
  const invite = String(linkType || '').trim().toLowerCase() === 'invite';
  if (!invite) return recoveryRedirect(origin);
  return callbackUrl(origin, [
    ['next', safeRedirectPath(SET_PASSWORD, origin, '')],
    ['flow', 'invite'],
  ]);
}

function normalizePath(pathname: string): string {
  let path = String(pathname || '/').split(/[?#]/)[0] || '/';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path || '/';
}

export function isSetPasswordPath(pathname: string | null | undefined): boolean {
  const path = normalizePath(pathname || '');
  return path === SET_PASSWORD || path.startsWith(`${SET_PASSWORD}/`);
}

function paramTypeIsRecovery(raw: string): boolean {
  const q = String(raw || '').replace(/^[?#]/, '');
  if (!q) return false;
  return new URLSearchParams(q).get('type')?.trim().toLowerCase() === 'recovery';
}

/** True when the hash or query carries Supabase type=recovery. */
export function urlHasRecoveryType(search: string, hash: string): boolean {
  return paramTypeIsRecovery(search) || paramTypeIsRecovery(hash);
}

/**
 * Where a recovery link should open. Null when this load is already the
 * set-password page, or the URL is not a recovery callback.
 * Keeps the hash and query so implicit tokens and a PKCE code survive.
 */
export function recoveryLandingHref(loc: {
  pathname?: string;
  search?: string;
  hash?: string;
}): string | null {
  if (isSetPasswordPath(loc.pathname)) return null;
  if (!urlHasRecoveryType(loc.search || '', loc.hash || '')) return null;
  return `${SET_PASSWORD}${loc.search || ''}${loc.hash || ''}`;
}

/**
 * PASSWORD_RECOVERY fires after the client has stored the session and, on
 * the implicit flow, removed type=recovery from the URL. Send them to the
 * form even though a session already exists. Null on the form itself.
 */
export function passwordRecoveryEventHref(event: string, pathname: string): string | null {
  if (event !== 'PASSWORD_RECOVERY') return null;
  if (isSetPasswordPath(pathname)) return null;
  return `${SET_PASSWORD}?flow=reset`;
}

/**
 * Runs from the root document head, before the Supabase client can consume
 * the hash and before the home page treats the new session as a normal sign-in.
 * Must stay in lockstep with recoveryLandingHref.
 */
export const RECOVERY_BOOT_SCRIPT =
  '(function(){try{' +
  'var p=location.pathname||"/";' +
  'if(p.length>1&&p.charAt(p.length-1)==="/")p=p.slice(0,-1);' +
  'if(p==="/auth/set-password"||p.indexOf("/auth/set-password/")===0)return;' +
  'function recovery(raw){var q=String(raw||"").replace(/^[?#]/,"");if(!q)return false;' +
  'return String(new URLSearchParams(q).get("type")||"").trim().toLowerCase()==="recovery";}' +
  'if(!recovery(location.search)&&!recovery(location.hash))return;' +
  'location.replace("/auth/set-password"+(location.search||"")+(location.hash||""));' +
  '}catch(e){}})();';

/** signInWithOtp / login magic link. Never /auth/set-password. */
export function loginMagicLinkRedirect(
  origin: string,
  nextPath?: string | null,
  claimToken?: string | null
): string {
  let next = safeRedirectPath(nextPath, origin, '');
  if (!next || isPasswordSetupPath(next)) next = DEFAULT_SIGN_IN_HOME;
  const pairs: Array<[string, string]> = [['next', next]];
  const claim = String(claimToken || '').trim();
  if (claim) pairs.push(['claim', claim]);
  return callbackUrl(origin, pairs);
}
