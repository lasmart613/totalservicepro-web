/**
 * Fixed codes for a refused clinic claim. The login URL carries a code only.
 * The banner maps that code to a known English string, then t() translates it.
 * Anything else in the query is ignored.
 */

export const CLAIM_ERROR_CODES = [
  'claim_refused',
  'email_mismatch',
  'token_expired',
  'token_invalid',
  'owner_exists',
  'server_error',
] as const;

export type ClaimErrorCode = (typeof CLAIM_ERROR_CODES)[number];

export const CLAIM_REFUSED_MESSAGE =
  'This clinic invite could not be claimed. A new organization was not created.';

const CLAIM_ERROR_MESSAGES: Record<ClaimErrorCode, string> = {
  claim_refused: CLAIM_REFUSED_MESSAGE,
  email_mismatch: 'Sign in with the email this invite was sent to.',
  token_expired: 'This clinic invite has expired. Ask the shop that invited you to send a new one.',
  token_invalid: 'This clinic invite is not valid. Ask the shop that invited you to send a new one.',
  owner_exists: 'This company profile already has an owner account.',
  server_error: 'This clinic invite could not be claimed right now. Please try again.',
};

const CODE_SET = new Set<string>(CLAIM_ERROR_CODES);

export function isClaimErrorCode(value: string): value is ClaimErrorCode {
  return CODE_SET.has(value);
}

/** English source for a known code. Unknown, empty, or raw query text returns null. */
export function claimErrorMessage(code: string | null | undefined): string | null {
  const key = String(code ?? '').trim();
  if (!isClaimErrorCode(key)) return null;
  return CLAIM_ERROR_MESSAGES[key];
}

const CODE_BY_MESSAGE: Record<string, ClaimErrorCode> = {
  [CLAIM_REFUSED_MESSAGE]: 'claim_refused',
  'Sign in required': 'claim_refused',
  'Sign in required to claim this clinic profile.': 'claim_refused',
  'Invalid session': 'claim_refused',
  'Company profile was not found.': 'claim_refused',
  'This invite is not for a clinic profile.': 'claim_refused',
  'This account is already linked to another organization.': 'claim_refused',
  'Sign in with the email this invite was sent to.': 'email_mismatch',
  'This invite was issued for an email that is no longer on this clinic.': 'email_mismatch',
  'Invite is invalid or expired.': 'token_invalid',
  'This clinic invite has expired. Ask the shop that invited you to send a new one.': 'token_expired',
  'This clinic invite is not valid. Ask the shop that invited you to send a new one.': 'token_invalid',
  'This company profile already has an owner account.': 'owner_exists',
  'Server misconfigured': 'server_error',
  'Server error': 'server_error',
  'Server cannot link this clinic profile (missing service role).': 'server_error',
  'Could not set this clinic as your home organization.': 'server_error',
  'Could not update the clinic owner role.': 'server_error',
  'Clinic owner role was not saved.': 'server_error',
  'Could not check who owns this clinic. Nothing was changed.': 'server_error',
  'Could not link profile.': 'server_error',
  'Profile did not link to the company.': 'server_error',
};

/**
 * Code for the login URL. A known API code wins. A known API sentence maps to
 * its code. Any other text, including HTML, becomes server_error and is not copied.
 * A blank failure is claim_refused.
 */
export function claimErrorCode(input: { code?: string | null; error?: string | null }): ClaimErrorCode {
  const explicit = String(input.code ?? '').trim();
  if (isClaimErrorCode(explicit)) return explicit;
  const message = String(input.error ?? '').trim();
  if (CODE_BY_MESSAGE[message]) return CODE_BY_MESSAGE[message];
  if (!message) return 'claim_refused';
  return 'server_error';
}

/** Login URL after a refusal. Only a known code is written. No claim token. */
export function refusedClaimLoginHref(code: string): string {
  if (!claimErrorMessage(code)) return '/login';
  return `/login?claimError=${encodeURIComponent(code)}`;
}
