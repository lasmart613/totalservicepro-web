'use client';

import { useT } from '@/lib/fa/locale';
import { formatOrgRatingLine, showOrgRating } from '@/lib/reviews';

/**
 * Average and count, shown from the first visible review as `4.7 ★ (3)`.
 * Used on signed-in and logged-out directory cards and the public profile.
 * A future matched-shop list should render this same component.
 */
export function OrgRatingBadge({
  count,
  average,
}: {
  count?: number | null;
  average?: number | null;
}) {
  const t = useT();
  if (!showOrgRating(count) || count == null || average == null || !Number.isFinite(average)) return null;
  const line = formatOrgRatingLine(average, count);
  return (
    <p className="text-xs font-bold text-[var(--gold)] mt-0.5" aria-label={`${t('Average rating')} ${line}`}>
      {line}
    </p>
  );
}
