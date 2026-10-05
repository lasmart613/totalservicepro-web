'use client';

import Link from 'next/link';
import { useT } from '@/lib/fa/locale';

const FINANCIAL_SECTIONS = [
  'Outstanding unpaid invoices',
  'Invoices missing an amount',
  'Payment processing',
  'Outstanding aging',
  'Full metric breakdown',
  'Job Costing',
] as const;

export function ReportUpgradeLock({
  feature,
  sections = FINANCIAL_SECTIONS,
}: {
  feature?: string;
  sections?: readonly string[];
}) {
  const t = useT();
  return (
    <section className="card p-6 mt-8">
      <h2 className="text-lg font-extrabold">{t(feature || 'Detailed reports')}</h2>
      <p className="text-sm text-[var(--text2)] mt-2 max-w-2xl">
        {t(
          'Invoice lists, payment breakdowns, aging, and job costing are included with Premium, Team, and Enterprise.'
        )}
      </p>
      <ul className="mt-4 space-y-2 text-sm text-[var(--text2)]">
        {sections.map((label) => (
          <li key={label} className="flex items-center gap-2">
            <span aria-hidden className="text-[var(--text3)]">
              ▣
            </span>
            <span>{t(label)}</span>
            <span className="text-xs text-[var(--text3)]">{t('Included with Premium')}</span>
          </li>
        ))}
      </ul>
      <Link href="/plans" className="btn btn-primary mt-5 inline-flex">
        {t('Upgrade plan')}
      </Link>
    </section>
  );
}
