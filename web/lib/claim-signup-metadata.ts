/**
 * Clinic-claim signup metadata.
 *
 * A failed /api/customers/claim used to null only claim_token. signup_kind,
 * role, organization_type, and the clinic name stayed on the auth user, and
 * the next sign-in rebuilt them into a new organization.
 *
 * Normal /signup/owner stores claim_token as "". That empty string is not a
 * claim. A failed claim sets the key to null, which drops it. Company and
 * supplier founders never go through this shape.
 */

export const CLAIM_SIGNUP_METADATA_KEYS = [
  'claim_token',
  'signup_kind',
  'signup_type',
  'role',
  'organization_type',
  'company',
  'facility',
  'address',
  'city',
  'state',
  'phone',
  'website',
  'facility_type',
  'preferred_services',
  'services_offered',
  'num_laser_systems',
  'num_lasers',
  'job_title',
] as const;

const OWNER_ORG_TYPES = new Set(['customer', 'laser_clinic', 'laser_rental', 'laser_reseller']);
const FOUNDER_KINDS = new Set(['company', 'supplier']);
const FOUNDER_ROLES = new Set(['company_admin', 'admin', 'parts_supplier', 'supplier']);
const FOUNDER_ORG_TYPES = new Set(['service_company', 'parts_supplier']);

export type ClaimSignupMeta = Record<string, unknown>;

export function asClaimSignupMeta(value: unknown): ClaimSignupMeta | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as ClaimSignupMeta;
}

export function readClaimToken(value: unknown): string {
  return String(value ?? '').trim();
}

function signupType(meta: ClaimSignupMeta): string {
  return String(meta.signup_type || '').toLowerCase().trim();
}

function isExplicitClaimType(meta: ClaimSignupMeta): boolean {
  const kind = signupType(meta);
  return kind === 'claim' || kind === 'owner-claim';
}

/** Owner/clinic claim signup fields. Company and supplier founders are not this. */
export function isOwnerClaimSignupMetadata(meta: ClaimSignupMeta | null | undefined): boolean {
  const m = meta || {};
  const signupKind = String(m.signup_kind || '').toLowerCase().trim();
  const role = String(m.role || '').toLowerCase().trim();
  const orgType = String(m.organization_type || '').toLowerCase().trim();
  if (isExplicitClaimType(m)) return true;
  if (FOUNDER_KINDS.has(signupKind)) return false;
  if (FOUNDER_ORG_TYPES.has(orgType) && signupKind !== 'owner' && role !== 'owner' && role !== 'customer') {
    return false;
  }
  if (FOUNDER_ROLES.has(role) && signupKind !== 'owner' && !OWNER_ORG_TYPES.has(orgType)) return false;
  if (signupKind === 'owner') return true;
  if (role === 'owner' || role === 'customer') return true;
  if (OWNER_ORG_TYPES.has(orgType)) return true;
  return !!readClaimToken(m.claim_token);
}

/**
 * Claim signup whose token is gone.
 * "" is a normal owner signup. null or a missing key is a cleared claim.
 */
export function isClaimSignupWithoutToken(meta: ClaimSignupMeta | null | undefined): boolean {
  if (!isOwnerClaimSignupMetadata(meta)) return false;
  const m = meta || {};
  if (readClaimToken(m.claim_token)) return false;
  if (isExplicitClaimType(m)) return true;
  if (Object.prototype.hasOwnProperty.call(m, 'claim_token') && m.claim_token != null) return false;
  return true;
}

export type ClaimRebuildPending = {
  kind?: string | null;
  extra?: { claimToken?: unknown } | null;
} | null | undefined;

/**
 * Refuse to insert an organization from a clinic claim.
 * A live token belongs to /api/customers/claim. Leftover owner metadata
 * with no token must not be rebuilt. Company and supplier founders still create.
 */
export function refuseClaimOrgAutoCreate(
  pending: ClaimRebuildPending,
  meta: ClaimSignupMeta | null | undefined
): boolean {
  if (isClaimSignupWithoutToken(meta)) return true;
  const metaToken = readClaimToken(meta?.claim_token);
  const pendingToken = readClaimToken(pending?.extra?.claimToken);
  if (!metaToken && !pendingToken) return false;
  const kind = String(pending?.kind || '').toLowerCase();
  if (!pending || kind === 'owner' || kind === '') return true;
  return isOwnerClaimSignupMetadata(meta);
}

/** Nulls merged by auth.admin.updateUserById. Null removes the key. */
export function claimSignupMetadataClearPatch(
  meta: ClaimSignupMeta | null | undefined
): Record<string, null> | null {
  if (!isOwnerClaimSignupMetadata(meta)) return null;
  const patch: Record<string, null> = {};
  for (const key of CLAIM_SIGNUP_METADATA_KEYS) patch[key] = null;
  return patch;
}
