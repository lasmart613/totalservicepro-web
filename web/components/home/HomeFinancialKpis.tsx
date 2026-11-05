'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  HOME_FINANCIAL_KPI_API,
  type HomepageFinancialKpi,
  type HomepageFinancialKpiPayload,
} from '@/lib/home-financial-kpis';
import { formatOrgMoney } from '@/lib/money-format';
import { useSiteLocale, useT } from '@/lib/fa/locale';
import { PUBLIC_LOCALES } from '@/lib/i18n/locales';

function isCard(value: unknown): value is HomepageFinancialKpi {
  if (!value || typeof value !== 'object') return false;
  const row = value as HomepageFinancialKpi;
  return (
    typeof row.id === 'string' &&
    typeof row.label === 'string' &&
    typeof row.amount === 'number' &&
    Number.isFinite(row.amount) &&
    typeof row.href === 'string' &&
    row.href.startsWith('/')
  );
}

function isPayload(value: unknown): value is HomepageFinancialKpiPayload {
  if (!value || typeof value !== 'object') return false;
  const body = value as HomepageFinancialKpiPayload;
  return typeof body.currencyCode === 'string' && Array.isArray(body.kpis) && body.kpis.every(isCard);
}

function fillCount(template: string, count: number): string {
  return template.replaceAll('{count}', String(count));
}

function outstandingCaption(count: number, t: (text: string) => string): string {
  if (count === 1) return t('1 outstanding invoice');
  return fillCount(t('{count} outstanding invoices'), count);
}

/**
 * Mount only when the caller may see financial reporting.
 * Cards render after the server authorizes the JWT. A 401 or 403 drops the
 * section and does not paint zeros.
 */
export function HomeFinancialKpis() {
  const t = useT();
  const siteLocale = useSiteLocale();
  const locale = PUBLIC_LOCALES.find((item) => item.id === siteLocale)?.htmlLang || 'en';
  const [phase, setPhase] = useState<'loading' | 'ready' | 'hidden' | 'error'>('loading');
  const [payload, setPayload] = useState<HomepageFinancialKpiPayload | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const supabase = getSupabaseClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        if (!cancelled) {
          setPayload(null);
          setPhase('hidden');
        }
        return;
      }

      let tz = '';
      try {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      } catch {
        tz = '';
      }
      if (tz) {
        document.cookie = `rp-tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
      }
      const url = tz
        ? `${HOME_FINANCIAL_KPI_API}?tz=${encodeURIComponent(tz)}`
        : HOME_FINANCIAL_KPI_API;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const json = await res.json().catch(() => null);
      if (cancelled) return;

      if (res.status === 401 || res.status === 403) {
        setPayload(null);
        setPhase('hidden');
        return;
      }
      if (!res.ok || !isPayload(json)) {
        setPayload(null);
        setPhase('error');
        return;
      }
      setPayload(json);
      setPhase(json.kpis.length ? 'ready' : 'hidden');
    })().catch(() => {
      if (!cancelled) {
        setPayload(null);
        setPhase('error');
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (phase === 'hidden') return null;

  if (phase === 'loading') {
    return <p className="mt-8 text-sm text-[var(--text3)]">{t('Loading financial KPIs...')}</p>;
  }

  if (phase === 'error' || !payload) {
    return <p className="mt-8 text-sm text-[var(--text3)]">{t('Financial KPIs could not be loaded.')}</p>;
  }

  const money = (amount: number) =>
    formatOrgMoney(amount, { currencyCode: payload.currencyCode, numberFormat: payload.numberFormat }, locale);

  return (
    <section className="mt-8" aria-label={t('Financial KPIs')}>
      <h2 className="font-bold text-lg mb-4">{t('Financial KPIs')}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {payload.kpis.map((kpi) => (
          <KpiCard key={kpi.id} kpi={kpi} money={money} />
        ))}
      </div>
    </section>
  );
}

function KpiCard({
  kpi,
  money,
}: {
  kpi: HomepageFinancialKpi;
  money: (amount: number) => string;
}) {
  const t = useT();
  const delta = kpi.deltaPercent;
  const deltaLabel = delta == null ? null : delta > 0 ? `+${delta}%` : delta < 0 ? `${delta}%` : '0%';
  const caption =
    kpi.id === 'accounts_receivable' && kpi.count != null
      ? outstandingCaption(kpi.count, t)
      : kpi.detailLabel
        ? t(kpi.detailLabel)
        : kpi.count != null
          ? `${kpi.count} ${kpi.count === 1 ? t('row') : t('rows')}`
          : null;

  return (
    <Link href={kpi.href} className="card p-5 text-center hover:border-[var(--gold)] flex flex-col">
      <div className="text-2xl font-extrabold text-[var(--gold)] break-words" dir="ltr">
        {money(kpi.amount)}
      </div>
      <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">{t(kpi.label)}</div>
      {caption && <div className="text-xs text-[var(--text3)] mt-1">{caption}</div>}
      {deltaLabel && (
        <div className={`text-xs font-semibold mt-1 ${delta != null && delta < 0 ? 'text-red-300' : 'text-green-300'}`}>
          {deltaLabel} {t('vs last month')}
          {kpi.compareAmount != null ? ` · ${money(kpi.compareAmount)}` : ''}
        </div>
      )}
      {kpi.note && <p className="text-xs text-[var(--text3)] mt-2">{t(kpi.note)}</p>}
    </Link>
  );
}
