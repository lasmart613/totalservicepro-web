'use client';

import Link from 'next/link';
import type { FinancialReport, FinancialSummary, MoneyKpi, MonthlyRevenuePoint } from '@/lib/financial-reporting';
import { formatOrgMoney } from '@/lib/money-format';
import { useSiteLocale, useT } from '@/lib/fa/locale';
import { PUBLIC_LOCALES } from '@/lib/i18n/locales';
import { ReportUpgradeLock } from '@/components/ReportUpgradeLock';

function statusLabel(status: string | null | undefined): string {
  const raw = String(status || '').trim();
  if (!raw) return '—';
  return raw
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function useMoney(report: { currencyCode?: string; numberFormat?: string }) {
  const siteLocale = useSiteLocale();
  const locale = PUBLIC_LOCALES.find((item) => item.id === siteLocale)?.htmlLang || 'en';
  return (amount: number) =>
    formatOrgMoney(amount, { currencyCode: report.currencyCode, numberFormat: report.numberFormat }, locale);
}

function KpiTile({ kpi, money }: { kpi: MoneyKpi; money: (amount: number) => string }) {
  const t = useT();
  const unavailable = kpi.availability !== 'available';
  const delta = kpi.deltaPercent;
  const deltaLabel =
    delta == null ? null : delta > 0 ? `+${delta}%` : delta < 0 ? `${delta}%` : '0%';
  return (
    <article className="card p-4 flex flex-col gap-1 min-h-[8.5rem]">
      <h2 className="text-sm font-semibold text-[var(--text2)]">{t(kpi.label)}</h2>
      <div className={`text-2xl font-extrabold ${unavailable ? 'text-[var(--text3)]' : ''}`} dir="ltr">
        {unavailable ? t('Unavailable') : money(kpi.amount || 0)}
      </div>
      {!unavailable && kpi.count != null && (
        <div className="text-xs text-[var(--text3)]">
          {kpi.count} {kpi.count === 1 ? t('row') : t('rows')}
        </div>
      )}
      {!unavailable && deltaLabel && (
        <div className={`text-xs font-semibold ${delta != null && delta < 0 ? 'text-red-300' : 'text-green-300'}`}>
          {deltaLabel} {t('vs last month')}
          {kpi.compareAmount != null ? ` · ${money(kpi.compareAmount)}` : ''}
        </div>
      )}
      <p className="text-xs text-[var(--text3)] mt-auto">{unavailable ? kpi.reason : kpi.note}</p>
    </article>
  );
}

function MonthlyChart({
  points,
  money,
}: {
  points: MonthlyRevenuePoint[];
  money: (amount: number) => string;
}) {
  const t = useT();
  const max = Math.max(...points.map((point) => point.amount), 0);
  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold text-[var(--text2)]">{t('Monthly revenue')}</h2>
      <div className="mt-4 flex items-end gap-2 h-44">
        {points.map((point) => {
          const height = max <= 0 ? 4 : Math.max(4, Math.round((point.amount / max) * 100));
          return (
            <div key={point.month} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full">
              <div className="text-[10px] text-[var(--text3)] mb-1 truncate w-full text-center" dir="ltr">
                {money(point.amount)}
              </div>
              <div
                className="w-full rounded-t bg-[var(--gold)]"
                style={{ height: `${height}%` }}
                title={`${point.month} ${money(point.amount)}`}
              />
              <div className="text-[10px] mt-1 text-[var(--text3)]" dir="ltr">
                {point.month.slice(5)}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CompareChart({ summary, money }: { summary: FinancialSummary; money: (amount: number) => string }) {
  const t = useT();
  const collected = summary.collectedThisMonth;
  const outstanding = summary.outstandingAmount;
  if (collected == null && outstanding == null) return null;
  const bars = [
    { id: 'collected', label: t('Collected this month'), amount: collected || 0 },
    { id: 'outstanding', label: t('Outstanding invoices'), amount: outstanding || 0 },
  ];
  const max = Math.max(...bars.map((bar) => bar.amount), 0);
  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold text-[var(--text2)]">{t('Collected vs outstanding')}</h2>
      <div className="mt-4 space-y-3">
        {bars.map((bar) => {
          const width = max <= 0 ? 0 : Math.round((bar.amount / max) * 100);
          return (
            <div key={bar.id}>
              <div className="flex justify-between gap-3 text-xs text-[var(--text3)] mb-1">
                <span>{bar.label}</span>
                <span dir="ltr">{money(bar.amount)}</span>
              </div>
              <div className="h-3 rounded bg-[var(--surface3)] overflow-hidden">
                <div className="h-full bg-[var(--gold)]" style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DetailedSections({
  report,
  money,
}: {
  report: FinancialReport;
  money: (amount: number) => string;
}) {
  const t = useT();
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
        {report.metrics.map((metric) => {
          const unavailable = metric.availability !== 'available';
          return (
            <article key={metric.id} className="card p-4 flex flex-col gap-2 min-h-[9.5rem]">
              <h2 className="text-sm font-semibold text-[var(--text2)]">{t(metric.label)}</h2>
              <div className={`text-2xl font-extrabold ${unavailable ? 'text-[var(--text3)]' : ''}`} dir="ltr">
                {unavailable ? t('Unavailable') : money(metric.amount || 0)}
              </div>
              {metric.count != null && !unavailable && (
                <div className="text-xs text-[var(--text3)]">
                  {metric.count} {metric.count === 1 ? t('row') : t('rows')}
                </div>
              )}
              <p className="text-xs text-[var(--text3)] mt-auto">{unavailable ? metric.reason : metric.note || metric.source}</p>
              {!unavailable && metric.note && <p className="text-[11px] text-[var(--text3)]">Source: {metric.source}</p>}
            </article>
          );
        })}
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-extrabold mb-1">{t('Outstanding unpaid invoices')}</h2>
        <p className="text-xs text-[var(--text3)] mb-3">
          Issued invoices with a total minus the recorded payment still above zero. Drafts, voided, and
          cancelled invoices are omitted.
        </p>
        {report.outstanding.length === 0 ? (
          <div className="card p-4 text-sm text-[var(--text3)]">
            {report.invoiceRowCount == null
              ? 'Outstanding invoices are unavailable because invoices could not be read.'
              : t('No issued invoice has a remaining balance from the rows that were read.')}
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-start text-[var(--text3)]">
                <tr>
                  <th className="px-3 py-2 font-semibold">{t('Invoice')}</th>
                  <th className="px-3 py-2 font-semibold">{t('Customer')}</th>
                  <th className="px-3 py-2 font-semibold">{t('Status')}</th>
                  <th className="px-3 py-2 font-semibold">{t('Invoice date')}</th>
                  <th className="px-3 py-2 font-semibold">{t('Due')}</th>
                  <th className="px-3 py-2 font-semibold text-end">{t('Total')}</th>
                  <th className="px-3 py-2 font-semibold text-end">{t('Paid')}</th>
                  <th className="px-3 py-2 font-semibold text-end">{t('Balance')}</th>
                </tr>
              </thead>
              <tbody>
                {report.outstanding.map((row) => (
                  <tr key={`${row.id}-${row.number}`} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2">
                      {row.id ? (
                        <Link href={`/invoices/new?id=${encodeURIComponent(row.id)}`} className="text-[var(--gold)] hover:underline">
                          {row.number || row.id}
                        </Link>
                      ) : (
                        row.number || '—'
                      )}
                    </td>
                    <td className="px-3 py-2">{row.customer}</td>
                    <td className="px-3 py-2">{statusLabel(row.status)}</td>
                    <td className="px-3 py-2">{row.invoiceDate || '—'}</td>
                    <td className="px-3 py-2">{row.dueDate || '—'}</td>
                    <td className="px-3 py-2 text-end" dir="ltr">
                      {money(row.total)}
                    </td>
                    <td className="px-3 py-2 text-end" dir="ltr">
                      {money(row.amountPaid)}
                    </td>
                    <td className="px-3 py-2 text-end font-semibold" dir="ltr">
                      {money(row.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {report.unpricedInvoices.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-extrabold mb-1">{t('Invoices missing an amount')}</h2>
          <p className="text-xs text-[var(--text3)] mb-3">
            These rows were read and left out of a total because the source field was empty.
          </p>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-start text-[var(--text3)]">
                <tr>
                  <th className="px-3 py-2 font-semibold">{t('Invoice')}</th>
                  <th className="px-3 py-2 font-semibold">{t('Customer')}</th>
                  <th className="px-3 py-2 font-semibold">{t('Status')}</th>
                  <th className="px-3 py-2 font-semibold">{t('Why it was omitted')}</th>
                </tr>
              </thead>
              <tbody>
                {report.unpricedInvoices.map((row, index) => (
                  <tr key={`${row.id}-${row.reason}-${index}`} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2">{row.number || row.id || '—'}</td>
                    <td className="px-3 py-2">{row.customer}</td>
                    <td className="px-3 py-2">{statusLabel(row.status)}</td>
                    <td className="px-3 py-2">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-extrabold mb-1">{t('Payment processing')}</h2>
        <p className="text-xs text-[var(--text3)] mb-3">
          Collected amounts grouped by the method stored on the invoice. Fees are unavailable.
        </p>
        {report.paymentMethods.length === 0 ? (
          <div className="card p-4 text-sm text-[var(--text3)]">{t('No collected payments were read, or payment rows are unavailable.')}</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-start text-[var(--text3)]">
                <tr>
                  <th className="px-3 py-2 font-semibold">{t('Method')}</th>
                  <th className="px-3 py-2 font-semibold text-end">{t('Collected')}</th>
                  <th className="px-3 py-2 font-semibold text-end">{t('Payments')}</th>
                  <th className="px-3 py-2 font-semibold">{t('Source')}</th>
                </tr>
              </thead>
              <tbody>
                {report.paymentMethods.map((row) => (
                  <tr key={row.method} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2">{row.method}</td>
                    <td className="px-3 py-2 text-end" dir="ltr">
                      {money(row.amount)}
                    </td>
                    <td className="px-3 py-2 text-end">{row.count}</td>
                    <td className="px-3 py-2 text-xs text-[var(--text3)]">{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-extrabold mb-1">{t('Outstanding aging')}</h2>
        <p className="text-xs text-[var(--text3)] mb-3">
          {report.agingReason ||
            t('Buckets compare each invoice due date with today in the organization timezone.')}
        </p>
        {report.aging == null ? (
          <div className="card p-4 text-sm text-[var(--text3)]">{t('Aging is unavailable.')}</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {report.aging.map((bucket) => (
              <div key={bucket.id} className="card p-4">
                <div className="text-sm text-[var(--text2)]">{t(bucket.label)}</div>
                <div className="text-xl font-extrabold mt-1" dir="ltr">
                  {money(bucket.amount)}
                </div>
                <div className="text-xs text-[var(--text3)] mt-1">
                  {bucket.count} {bucket.count === 1 ? t('invoice') : t('invoices')}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

export function FinancialReportingView({ report }: { report: FinancialReport }) {
  const t = useT();
  const money = useMoney(report);
  const org = report.organizationName || (report.organizationId ? `Organization ${report.organizationId}` : t('No active organization'));
  const detail = report.detailIncluded !== false;

  return (
    <div className="max-w-6xl mx-auto w-full px-4 py-6">
      <h1 className="text-2xl font-extrabold">{t('Financial Reporting')}</h1>
      <p className="text-sm text-[var(--text3)] mt-1">
        {org}
        {report.organizationId ? ` · org ${report.organizationId}` : ''}
        {' · '}
        {t('as of')} {report.asOfDate}
        {report.timeZoneLabel ? ` ${report.timeZoneLabel}` : ''}
        {' · '}
        <span dir="ltr">{report.currencyCode || 'USD'}</span>
      </p>
      <p className="text-sm text-[var(--text2)] mt-3 max-w-3xl">
        {t(
          'Figures are sums of stored rows for this organization. Amounts use the organization currency and are not converted. A metric that has no table or column says unavailable and has no total.'
        )}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
        {report.summary.kpis.map((kpi) => (
          <KpiTile key={kpi.id} kpi={kpi} money={money} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        {report.summary.monthlyRevenue ? (
          <MonthlyChart points={report.summary.monthlyRevenue} money={money} />
        ) : (
          <section className="card p-4 text-sm text-[var(--text3)]">
            {report.summary.monthlyRevenueReason || t('Monthly revenue is unavailable.')}
          </section>
        )}
        <CompareChart summary={report.summary} money={money} />
      </div>

      {detail ? <DetailedSections report={report} money={money} /> : <ReportUpgradeLock />}
    </div>
  );
}
