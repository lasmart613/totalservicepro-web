/**
 * One complimentary signup trial per organization (migration 000915).
 *
 * POST /api/org/founder used to grant the 60-day complimentary_signup trial
 * whenever a creator's service_company org had is_premium, premium_until and
 * premium_grant all empty. God expiry/removal clears those three, so the trial
 * re-granted on the next /company visit. organizations.trial_granted_at now
 * records that the trial was used; expiry and removal never clear it.
 *
 * Grant only when:
 *   - the org is created in this request (createdInRequest), or
 *   - trial_granted_at is null AND the org was created within the last 24h
 *     (client-inserted orgs that call the founder route right after insert).
 * trial_granted_at is set in the same write as the grant. If the column can't
 * be read, no grant (fail closed).
 */

import { applyComplimentarySignupFields, COMPLIMENTARY_PREMIUM_GRANT_SIGNUP } from './complimentary-premium.ts';

export const SIGNUP_TRIAL_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Existing-org read for the grant. trial_granted_at and created_at are required for a grant. */
export const FOUNDER_ORG_COLUMNS =
  'id, type, created_by, created_at, is_premium, premium_until, premium_grant, trial_granted_at';
/** Pre-000915 read: still links the founder, never grants. created_at feeds the founder claim check (000916). */
export const FOUNDER_ORG_COLUMNS_LEGACY = 'id, type, created_by, created_at, is_premium, premium_until, premium_grant';

export type FounderOrgRow = {
  id: number | string;
  type?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  is_premium?: boolean | null;
  premium_until?: string | null;
  premium_grant?: string | null;
  trial_granted_at?: string | null;
};

export type SignupTrialSkip =
  | 'not_creator'
  | 'not_service_company'
  | 'prior_premium'
  | 'trial_used'
  | 'trial_unknown'
  | 'org_too_old';

export function isTrialGrantedAtMissing(message?: string | null): boolean {
  return /trial_granted_at/i.test(String(message || ''));
}

/** Existing org (not created in this request): may it get the signup trial now? */
export function existingOrgSignupTrialSkip(input: {
  org: FounderOrgRow;
  callerId: string;
  /** false when trial_granted_at could not be read. */
  trialColumnRead: boolean;
  now?: Date;
}): SignupTrialSkip | null {
  const { org, callerId } = input;
  const now = input.now ?? new Date();
  if (!callerId || String(org.created_by || '') !== callerId) return 'not_creator';
  if (String(org.type || '').toLowerCase().trim() !== 'service_company') return 'not_service_company';
  if (org.is_premium === true || !!org.premium_until || !!org.premium_grant) return 'prior_premium';
  if (!input.trialColumnRead || !('trial_granted_at' in org)) return 'trial_unknown';
  if (org.trial_granted_at) return 'trial_used';
  const created = Date.parse(String(org.created_at || ''));
  if (!Number.isFinite(created)) return 'org_too_old';
  const age = now.getTime() - created;
  if (age < 0 || age > SIGNUP_TRIAL_WINDOW_MS) return 'org_too_old';
  return null;
}

/** Grant fields plus trial_granted_at, one write. */
export function signupTrialGrantPatch(orgType: string, now: Date = new Date()): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  applyComplimentarySignupFields(patch, orgType, now);
  if (patch.premium_grant === COMPLIMENTARY_PREMIUM_GRANT_SIGNUP) {
    patch.trial_granted_at = now.toISOString();
  }
  return patch;
}

/** New org row: a grant on the insert carries trial_granted_at in the same write. */
export function markTrialOnInsert(row: Record<string, unknown>, now: Date = new Date()): Record<string, unknown> {
  if (row.premium_grant === COMPLIMENTARY_PREMIUM_GRANT_SIGNUP) row.trial_granted_at = now.toISOString();
  return row;
}

type Result = { data: any; error: { message?: string; code?: string } | null };

type AdminLike = { from: (table: string) => any };

/** Read the org for the founder link. trialColumnRead=false means "link, but never grant". */
export async function loadFounderOrg(
  admin: AdminLike,
  orgId: number | string
): Promise<{ org: FounderOrgRow | null; trialColumnRead: boolean; error: Result['error'] }> {
  const first: Result = await admin.from('organizations').select(FOUNDER_ORG_COLUMNS).eq('id', orgId).maybeSingle();
  if (!first.error) return { org: first.data ?? null, trialColumnRead: true, error: null };
  // Column not applied yet (or any read error on it): fail closed on the grant only.
  const legacy: Result = await admin
    .from('organizations')
    .select(FOUNDER_ORG_COLUMNS_LEGACY)
    .eq('id', orgId)
    .maybeSingle();
  return { org: legacy.error ? null : legacy.data ?? null, trialColumnRead: false, error: legacy.error };
}

/**
 * Grant the trial to an existing org if eligible. The update only lands while
 * trial_granted_at is still null, so two concurrent calls grant once.
 */
export async function grantSignupTrialIfEligible(
  admin: AdminLike,
  input: { org: FounderOrgRow; callerId: string; trialColumnRead: boolean; now?: Date }
): Promise<{ granted: boolean; skip: SignupTrialSkip | 'update_failed' | null }> {
  const now = input.now ?? new Date();
  const skip = existingOrgSignupTrialSkip({ ...input, now });
  if (skip) return { granted: false, skip };
  const patch = signupTrialGrantPatch(String(input.org.type || ''), now);
  if (patch.is_premium !== true || !patch.trial_granted_at) return { granted: false, skip: 'not_service_company' };
  const res: Result = await admin
    .from('organizations')
    .update(patch)
    .eq('id', input.org.id)
    .is('trial_granted_at', null)
    .is('premium_grant', null)
    .select('id');
  if (res.error || !Array.isArray(res.data) || res.data.length === 0) {
    return { granted: false, skip: 'update_failed' };
  }
  return { granted: true, skip: null };
}
