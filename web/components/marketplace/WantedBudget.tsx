'use client';

import { useT } from '@/lib/fa/locale';
import { wantedBudgetView, type WantedRecord } from '@/lib/marketplace/wanted';

export function WantedBudget({ post }: { post: Pick<WantedRecord, 'budget_min' | 'budget_max' | 'currency'> }) {
  const t = useT();
  const view = wantedBudgetView(post);
  if (view.kind === 'none') return null;
  if (view.kind === 'range') {
    return (
      <span className="fa-ltr">
        {view.min} – {view.max}
      </span>
    );
  }
  const phrase = view.kind === 'min' ? t('From {amount}') : t('Up to {amount}');
  return <span className="fa-ltr">{phrase.replace('{amount}', view.amount)}</span>;
}
