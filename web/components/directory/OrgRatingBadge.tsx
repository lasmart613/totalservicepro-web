'use client';

import { useT } from '@/lib/fa/locale';
import { formatOrgRating, showOrgRating } from '@/lib/reviews';

/** Average and count. Hidden until there is at least one visible review. */
export function OrgRatingBadge({
  count,
  average,
}: {
  count?: number | null;
  average?: number | null;
}) {
  const t = useT();
  if (!showOrgRating(count) || average == null || !Number.isFinite(average)) return null;
  const label =
    count === 1 ? t('1 review') : t('{count} reviews').replace('{count}', String(count));
  return (
    <p className="text-xs font-bold text-[var(--gold)] mt-0.5" aria-label={t('Average rating')}>
      <span aria-hidden="true">★ </span>
      {formatOrgRating(average)} · {label}
    </p>
  );
}
