/** English source for the required signup checkbox. Locales translate this exact key. */
export const CONSENT_TEMPLATE = 'I agree to the {terms} and the {privacy}.';

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
