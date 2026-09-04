'use client';

import Link from 'next/link';

type Variant = 'hero' | 'nav' | 'column';

/** Primary clinic onramp. A real route so the form works even if JS is slow. */
export function FindRepControl({
  variant = 'hero',
  label,
}: {
  variant?: Variant;
  label?: string;
}) {
  const buttonLabel =
    label ||
    (variant === 'nav' ? 'Find a rep' : 'Find a service rep near me');
  const triggerClass =
    variant === 'nav' ? 'lp-btn lp-btn-primary lp-find-nav' : 'lp-btn lp-btn-primary';

  return (
    <Link href="/find-a-rep" className={triggerClass}>
      {buttonLabel}
    </Link>
  );
}
