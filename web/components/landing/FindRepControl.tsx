'use client';

import { PublicLink, useT } from '@/lib/fa/locale';

type Variant = 'hero' | 'nav' | 'column';

/** Scrolls to the inline home form. /find-a-rep still works as a dedicated page. */
export function FindRepControl({
  variant = 'hero',
  label,
}: {
  variant?: Variant;
  label?: string;
}) {
  const t = useT();
  const buttonLabel =
    label ||
    (variant === 'nav' ? 'Find a rep' : 'Find a service rep near me');
  const triggerClass =
    variant === 'nav' ? 'lp-btn lp-btn-primary lp-find-nav' : 'lp-btn lp-btn-primary';

  return (
    <PublicLink href="/#find-a-rep" className={triggerClass}>
      {t(buttonLabel)}
    </PublicLink>
  );
}
