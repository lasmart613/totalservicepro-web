'use client';

import { PublicLink, useT } from '@/lib/fa/locale';

/** Terms and Privacy. Labels follow the site language. The href stays on the public locale. */
export function LegalLinks({ className = '' }: { className?: string }) {
  const t = useT();
  return (
    <p className={`text-xs text-[var(--text3)] ${className}`.trim()}>
      <PublicLink href="/terms" className="text-[var(--gold)] hover:underline">
        {t('Terms of Service')}
      </PublicLink>
      <span aria-hidden="true"> · </span>
      <PublicLink href="/privacy" className="text-[var(--gold)] hover:underline">
        {t('Privacy Policy')}
      </PublicLink>
    </p>
  );
}
