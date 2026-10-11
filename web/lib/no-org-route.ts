/**
 * Where a signed-in user goes when they have no organization.
 *
 * Login used to land on /, the home dashboard then replaced that with
 * /onboarding, and /onboarding sent some of those users back to /. Each of
 * those pages also POSTed /api/team/claim. A user with no organization_id
 * and no active org now goes to /onboarding once and stays there unless a
 * claim actually attaches an org.
 */

import { destAfterInviteClaim, inviteInPlay, routeAfterTeamClaim, shouldSendToMemberOnboarding, type InviteClaimResult } from './invite-claim.ts';
import { isOwnerish, isSupplier } from './roles.ts';
import { safeRedirectPath } from './safe-redirect.ts';

export type OrgRouteProfile = {
  organization_id?: number | string | null;
  active_organization_id?: number | string | null;
  onboarding_completed?: boolean | null;
  role?: string | null;
} | null | undefined;

export function profileOrgId(profile: OrgRouteProfile): number | string | null {
  const id = profile?.organization_id ?? profile?.active_organization_id ?? null;
  if (id == null || String(id).trim() === '') return null;
  return id;
}

/**
 * Claim response for a signed-in user who has no org and no invite in play.
 * `{ ok:true, claimed:false, pendingInvite:false }` with no organization_id.
 * A failed claim (ok false) does not prove there is no org.
 */
export function claimSaysNoOrganization(claim: InviteClaimResult | null | undefined): boolean {
  if (!claim || claim.ok === false) return false;
  if (inviteInPlay(claim)) return false;
  if (claim.organization_id != null && String(claim.organization_id).trim() !== '') return false;
  if (claim.claimed) return false;
  return true;
}

function claimAttachedOrganization(claim: InviteClaimResult | null | undefined): boolean {
  if (!claim || claim.ok === false) return false;
  if (claim.organization_id == null || String(claim.organization_id).trim() === '') return false;
  return !!(inviteInPlay(claim) || claim.claimed || shouldSendToMemberOnboarding(claim));
}

/** Password sign-in. No-org claim result skips / and opens /onboarding. */
export function loginDest(
  claim: InviteClaimResult | null | undefined,
  requestedDest: string,
  origin: string
): string {
  const requested = safeRedirectPath(requestedDest, origin, '/');
  if (claimSaysNoOrganization(claim)) return '/onboarding';
  return safeRedirectPath(routeAfterTeamClaim(claim, requested), origin, '/onboarding');
}

/** Auth callback after the session exists. `next` must already be safeRedirectPath'd. */
export function callbackDest(input: {
  profile?: OrgRouteProfile;
  claim?: InviteClaimResult | null;
  next?: string | null;
  isFounder?: boolean;
}): string {
  const claim = input.claim;
  if (claimAttachedOrganization(claim)) {
    return destAfterInviteClaim(claim, '/onboarding/member');
  }
  if (!profileOrgId(input.profile)) return '/onboarding';
  if (input.isFounder && !input.profile?.onboarding_completed) return '/onboarding';
  const next = input.next || '';
  if (next && next !== '/auth/set-password' && !next.startsWith('/auth/set-password')) return next;
  return '/';
}

/**
 * Shop roles that founder onboarding traps while onboarding_completed is false.
 * Invited field roles, owners, customers, and suppliers are not in this set.
 */
const ORG_SETUP_ROUTING_ROLES = new Set([
  'admin',
  'company_admin',
  'service_manager',
  'billing_manager',
]);

export function isOrgSetupRoutingRole(role?: string | null): boolean {
  return ORG_SETUP_ROUTING_ROLES.has(String(role || '').toLowerCase());
}

/**
 * An unfinished admin whose org is already running is complete for routing only.
 * `orgSetUp` must be the explicit result of the set-up lookup. false, null,
 * and undefined keep today's path (including a lookup error). This does not
 * read or write user_profiles.onboarding_completed.
 */
export function adminOrgCountsAsOnboarded(
  profile: OrgRouteProfile,
  orgSetUp: boolean | null | undefined
): boolean {
  if (orgSetUp !== true) return false;
  if (!profile || profile.onboarding_completed !== false) return false;
  if (!profileOrgId(profile)) return false;
  return isOrgSetupRoutingRole(profile.role);
}

/** Home dashboard. null means stay on /. */
export function homeDest(input: {
  profile?: OrgRouteProfile;
  claim?: InviteClaimResult | null;
  metaRole?: string | null;
  /** Explicit set-up lookup. Only `true` can keep an unfinished admin on /. */
  orgSetUp?: boolean | null;
}): string | null {
  if (claimAttachedOrganization(input.claim)) {
    return destAfterInviteClaim(input.claim, '/onboarding/member');
  }
  if (!profileOrgId(input.profile)) return '/onboarding';
  if (input.profile?.onboarding_completed === false) {
    const role = String(input.profile?.role || '').toLowerCase();
    const metaRole = String(input.metaRole || '').toLowerCase();
    const invited = ['fse', 'engineer', 'dispatcher', 'scheduler', 'technician'].includes(role);
    const ownerOrSupplier =
      role === 'owner' ||
      role === 'customer' ||
      role === 'parts_supplier' ||
      role === 'supplier' ||
      metaRole === 'owner' ||
      metaRole === 'parts_supplier';
    if (invited && !ownerOrSupplier) return '/onboarding/member';
    if (!ownerOrSupplier) {
      if (adminOrgCountsAsOnboarded(input.profile, input.orgSetUp)) return null;
      return '/onboarding';
    }
  }
  return null;
}

/** Tech hub. null means the hub can render. */
export function hubDest(profile: OrgRouteProfile): string | null {
  if (!profileOrgId(profile)) return '/onboarding';
  return null;
}

/**
 * /onboarding guard. null means render the wizard.
 * No organization and a claim that did not attach one never returns /.
 * A claim that attached an org uses the member or hub destination once.
 */
export function onboardingLeaveTarget(input: {
  profile?: OrgRouteProfile;
  orgType?: string | null;
  claim?: InviteClaimResult | null;
  /** Explicit set-up lookup. Only `true` lets an unfinished admin leave the wizard. */
  orgSetUp?: boolean | null;
}): string | null {
  if (claimAttachedOrganization(input.claim)) {
    const dest = destAfterInviteClaim(input.claim, '/onboarding/member');
    if (!dest || dest === '/onboarding' || dest.startsWith('/onboarding?')) return null;
    return dest;
  }
  if (!profileOrgId(input.profile)) return null;

  const role = input.profile?.role;
  if (isOwnerish(role, input.orgType)) return '/my-lasers';
  if (isSupplier(role, input.orgType)) return '/';
  const finished =
    !!input.profile?.onboarding_completed || adminOrgCountsAsOnboarded(input.profile, input.orgSetUp);
  if (finished) {
    const normalized = String(role || '').toLowerCase();
    if (['fse', 'engineer', 'dispatcher', 'scheduler'].includes(normalized)) return '/hub';
    return '/company';
  }
  return null;
}

/**
 * Follow redirects until a page stays. Used to prove a no-org sign-in
 * does not bounce / ↔ /onboarding.
 */
export function signInRedirects(input: {
  start: string;
  profile?: OrgRouteProfile;
  claim?: InviteClaimResult | null;
  orgType?: string | null;
  next?: string | null;
  origin?: string;
  isFounder?: boolean;
  metaRole?: string | null;
  orgSetUp?: boolean | null;
}): string[] {
  const hops: string[] = [];
  let path = (input.start || '/').split('?')[0] || '/';
  for (let i = 0; i < 8; i++) {
    const next = hopFrom(path, input);
    if (!next) break;
    const normalized = next.split('?')[0] || '/';
    if (normalized === path) break;
    hops.push(normalized);
    path = normalized;
  }
  return hops;
}

function hopFrom(
  path: string,
  input: {
    profile?: OrgRouteProfile;
    claim?: InviteClaimResult | null;
    orgType?: string | null;
    next?: string | null;
    origin?: string;
    isFounder?: boolean;
    metaRole?: string | null;
    orgSetUp?: boolean | null;
  }
): string | null {
  if (path === '/onboarding') return onboardingLeaveTarget(input);
  if (path === '/onboarding/member') {
    if (profileOrgId(input.profile) && input.profile?.onboarding_completed) return '/hub';
    return null;
  }
  if (path === '/hub') return hubDest(input.profile);
  if (path === '/login') {
    return loginDest(input.claim, input.next ?? '/', input.origin || 'https://totalservicepro.com');
  }
  if (path === '/auth/callback') {
    const dest = callbackDest({
      profile: input.profile,
      claim: input.claim,
      next: input.next ? safeRedirectPath(input.next, input.origin || 'https://totalservicepro.com', '') : '',
      isFounder: input.isFounder,
    });
    return dest === '/auth/callback' ? null : dest;
  }
  if (path === '/') return homeDest(input);
  return null;
}
