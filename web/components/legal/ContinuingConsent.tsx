'use client';

import { PublicLink, useT } from '@/lib/fa/locale';
import { CONTINUE_CONSENT_TEMPLATE, consentPieces } from '@/lib/legal/consent';

/** Agreement line next to Google and rental-fleet signup. The server records the consent. */
export function ContinuingConsent({ className = '' }: { className?: string }) {
  const t = useT();
  const pieces = consentPieces(t(CONTINUE_CONSENT_TEMPLATE));
  return (
    <p className={`text-xs leading-snug text-[var(--text3)] ${className}`}>
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
    </p>
  );
}
