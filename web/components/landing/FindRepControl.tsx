'use client';

import Link from 'next/link';

type Variant = 'hero' | 'nav' | 'column';

/** Scrolls to the inline home form. /find-a-rep still works as a dedicated page. */
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
    <Link href="/#find-a-rep" className={triggerClass}>
      {buttonLabel}
    </Link>
  );
}
