'use client';

import { PublicLink, useT } from '@/lib/fa/locale';
import { CONSENT_TEMPLATE, consentPieces } from '@/lib/legal/consent';

/**
 * Required checkbox on account-creation forms.
 * The choice is enforced in the browser only. It is not written to the database.
 * A later change could store legal_consent_at and legal_consent_version on user_profiles.
 */
export function SignupConsent({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const t = useT();
  const pieces = consentPieces(t(CONSENT_TEMPLATE));
  return (
    <div className="flex items-start gap-3 text-sm text-[var(--text2)]">
      <input
        id="legal-consent"
        name="agreeToLegal"
        type="checkbox"
        required
        aria-required="true"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-[var(--gold)]"
      />
      <label htmlFor="legal-consent" className="leading-snug">
        {pieces.map((piece, index) => {
          if (piece.kind === 'terms') {
            return (
              <PublicLink key={index} href="/terms" className="text-[var(--gold)] hover:underline">
                {t('Terms of Service')}
              </PublicLink>
            );
          }
          if (piece.kind === 'privacy') {
            return (
              <PublicLink key={index} href="/privacy" className="text-[var(--gold)] hover:underline">
                {t('Privacy Policy')}
              </PublicLink>
            );
          }
          return <span key={index}>{piece.text}</span>;
        })}
      </label>
    </div>
  );
}
