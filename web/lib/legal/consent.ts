/**
 * Version stored in user_profiles.legal_consent_version.
 * Bump this one constant when the Terms or Privacy Policy change.
 * A later PR will add a one-time "We've updated our Terms. Agree to continue"
 * prompt for users whose stamp is null or older than LEGAL_VERSION.
 */
export const LEGAL_VERSION = '2026-10-draft';

/**
 * Google callback stamps consent only for auth.users created at or after this time.
 * Set this to the deploy time. Accounts created earlier never get a silent stamp.
 */
export const LEGAL_CONSENT_STAMP_FROM = '2026-10-07T00:00:00Z';

/** English source for the required signup checkbox. Locales translate this exact key. */
export const CONSENT_TEMPLATE = 'I agree to the {terms} and the {privacy}.';

/** Shown beside Google and rental-fleet signup. Locales translate this exact key. */
export const CONTINUE_CONSENT_TEMPLATE =
  'By continuing you agree to the {terms} and {privacy}.';

/** Shown when submit runs without the checkbox. Locales translate this exact key. */
export const CONSENT_REQUIRED = 'Please agree to the Terms of Service and Privacy Policy.';

export const LEGAL_PLACEHOLDERS = [
  '[Effective date]',
  '[Company legal name]',
  '[Contact email]',
  '[Governing law state]',
] as const;

export type ConsentPiece =
  | { kind: 'text'; text: string }
  | { kind: 'terms' }
  | { kind: 'privacy' };

/** True only when the client sent an explicit yes for the current LEGAL_VERSION. */
export function consentAccepted(input: { consent?: unknown; legalVersion?: unknown }): boolean {
  return input.consent === true && input.legalVersion === LEGAL_VERSION;
}

/** Split a translated consent line, keeping {terms} and {privacy} in whatever order the locale used. */
export function consentPieces(template: string): ConsentPiece[] {
  return template
    .split(/(\{terms\}|\{privacy\})/)
    .filter((part) => part !== '')
    .map((part) => {
      if (part === '{terms}') return { kind: 'terms' };
      if (part === '{privacy}') return { kind: 'privacy' };
      return { kind: 'text', text: part };
    });
}
