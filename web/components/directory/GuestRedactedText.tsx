'use client';

import { useT } from '@/lib/fa/locale';
/**
 * Same privacy bar as GuestAwarePrice: the real string is never written
 * to the DOM for guests. Blur is applied to a placeholder only.
 */

export function GuestRedactedText({
  signedIn,
  value,
  placeholder,
  label = 'details',
  className,
}: {
  signedIn: boolean;
  value?: string | null;
  placeholder: string;
  label?: string;
  className?: string;
}) {
  const t = useT();
  if (signedIn) {
    return <span className={className}>{value || placeholder}</span>;
  }
  return (
    <span className={className} title={t('Sign up to see details')}>
      <span className="inline-block blur-[7px] select-none pointer-events-none" aria-hidden>
        {placeholder}
      </span>
      <span className="sr-only">{t('Sign up to see {label}').replace('{label}', label)}</span>
    </span>
  );
}
