'use client';

import { displayListingPrice } from '@/lib/marketplace/guest';
import { useT } from '@/lib/fa/locale';

export function GuestAwarePrice({
  signedIn,
  priceLabel,
  className = 'font-semibold text-[var(--gold)]',
}: {
  signedIn: boolean;
  priceLabel: string;
  className?: string;
}) {
  const t = useT();
  const shown = displayListingPrice(signedIn, priceLabel);
  if (signedIn) {
    return <div className={`${className} fa-ltr`}>{shown}</div>;
  }
  return (
    <div className={className} title={t('Sign up to see pricing')}>
      <span className="inline-block blur-[7px] select-none pointer-events-none fa-ltr" aria-hidden>
        {shown}
      </span>
      <span className="sr-only">{t('Sign up to see price')}</span>
    </div>
  );
}
