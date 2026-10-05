'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { HoursFigure, JobCostReport, MoneyFigure, RevenueFigure } from '@/lib/job-costing';
import { formatOrgMoney } from '@/lib/money-format';
import { useSiteLocale, useT } from '@/lib/fa/locale';
import { PUBLIC_LOCALES } from '@/lib/i18n/locales';

function useReportMoney(report: { currencyCode?: string; numberFormat?: string }) {
  const siteLocale = useSiteLocale();
  const locale = PUBLIC_LOCALES.find((item) => item.id === siteLocale)?.htmlLang || 'en';
  return (amount: number) =>
    formatOrgMoney(amount, { currencyCode: report.currencyCode, numberFormat: report.numberFormat }, locale);
}

function MoneyCell({ figure, money }: { figure: MoneyFigure; money: (amount: number) => string }) {
  const t = useT();
  if (!figure.available || figure.amount == null) {
    return (
      <span className="text-[var(--text3)]" title={figure.reason || undefined}>
        {t('Unavailable')}
      </span>
    );
  }
  return <span dir="ltr">{money(figure.amount)}</span>;
}

function HoursCell({ figure }: { figure: HoursFigure }) {
  const t = useT();
  if (!figure.available || figure.hours == null) {
    return (
      <span className="text-[var(--text3)]" title={figure.reason || undefined}>
        {t('Unavailable')}
      </span>
    );
  }
  return <span>{figure.hours.toFixed(2)} h</span>;
}

function RevenueCell({ figure, money }: { figure: RevenueFigure; money: (amount: number) => string }) {
  const t = useT();
  return (
    <div>
      <MoneyCell figure={figure} money={money} />
      {figure.available && figure.detail && (
        <div className="text-[11px] text-[var(--text3)]">
          {figure.basis === 'estimate' ? t('Estimate quote') : t('Invoice')} · {figure.detail}
        </div>
      )}
    </div>
  );
}

function Rollup({ label, children }: { label: string; children: ReactNode }) {
  const t = useT();
  return (
    <article className="card p-4">
      <h2 className="text-sm font-semibold text-[var(--text2)]">{t(label)}</h2>
      <div className="text-xl font-extrabold mt-1">{children}</div>
    </article>
  );
}

export function JobCostingView({ report }: { report: JobCostReport }) {
  const t = useT();
  const money = useReportMoney(report);
  const org =
    report.organizationName ||
    (report.organizationId ? `Organization ${report.organizationId}` : t('No active organization'));

  return (
    <div className="max-w-6xl mx-auto w-full px-4 py-6">
      <h1 className="text-2xl font-extrabold">{t('Job Costing')}</h1>
      <p className="text-sm text-[var(--text3)] mt-1">
        {org}
        {report.organizationId ? ` · org ${report.organizationId}` : ''}
        {' · '}{t('as of')} {report.asOfDate} UTC
      </p>
      <p className="text-sm text-[var(--text2)] mt-3 max-w-3xl">
        {t('Each repair order shows labor and parts taken from stored rows. A figure with no source says unavailable and is left out of totals. Quoted estimate labor is shown beside the job and is not added into cost or margin.')}
      </p>
      <p className="text-xs text-[var(--text3)] mt-2">
        Repair orders read: {report.ticketCount == null ? 'unavailable' : report.ticketCount}
        {report.wageColumnsPresent
          ? ' · labor_log returned a wage or labor cost column'
          : ' · labor_log did not return hourly_rate or labor_cost, so labor cost stays unavailable'}
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
        <Rollup label="Labor hours">
          <HoursCell figure={report.rollups.laborHours} />
        </Rollup>
        <Rollup label="Labor cost">
          <MoneyCell figure={report.rollups.laborCost} money={money} />
        </Rollup>
        <Rollup label="Parts and materials">
          <MoneyCell figure={report.rollups.partsCost} money={money} />
        </Rollup>
        <Rollup label="Total cost">
          <MoneyCell figure={report.rollups.totalCost} money={money} />
        </Rollup>
        <Rollup label="Revenue">
          <MoneyCell figure={report.rollups.revenue} money={money} />
        </Rollup>
        <Rollup label="Margin">
          <MoneyCell figure={report.rollups.margin} money={money} />
        </Rollup>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-extrabold mb-1">{t('Repair orders')}</h2>
        <p className="text-xs text-[var(--text3)] mb-3">
          {t('Shop totals above are the sum of these rows only when every repair order has that figure.')}
        </p>
        {report.ticketCount == null ? (
          <div className="card p-4 text-sm text-[var(--text3)]">
            {report.ticketIssue || 'Repair orders are unavailable because service_tickets could not be read.'}
          </div>
        ) : report.jobs.length === 0 ? (
          <div className="card p-4 text-sm text-[var(--text3)]">
            {t('No repair orders were read for this organization.')}
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm min-w-[960px]">
              <thead className="text-start text-[var(--text3)]">
                <tr>
                  <th className="px-3 py-2 font-semibold">{t('Repair order')}</th>
                  <th className="px-3 py-2 font-semibold">{t('Customer')}</th>
                  <th className="px-3 py-2 font-semibold">{t('Status')}</th>
                  <th className="px-3 py-2 font-semibold text-end">{t('Labor hours')}</th>
                  <th className="px-3 py-2 font-semibold text-end">{t('Labor cost')}</th>
                  <th className="px-3 py-2 font-semibold text-end">{t('Parts')}</th>
                  <th className="px-3 py-2 font-semibold text-end">{t('Total cost')}</th>
                  <th className="px-3 py-2 font-semibold text-end">{t('Revenue')}</th>
                  <th className="px-3 py-2 font-semibold text-end">{t('Margin')}</th>
                  <th className="px-3 py-2 font-semibold text-end">{t('Quoted labor')}</th>
                </tr>
              </thead>
              <tbody>
                {report.jobs.map((job) => (
                  <tr key={job.ticketId || job.ticketNumber} className="border-t border-[var(--border)] align-top">
                    <td className="px-3 py-2">
                      {job.ticketId ? (
                        <Link
                          href={`/service-tickets/${encodeURIComponent(job.ticketId)}`}
                          className="text-[var(--gold)] hover:underline"
                        >
                          {job.ticketNumber}
                        </Link>
                      ) : (
                        job.ticketNumber
                      )}
                      {job.serviceDate && (
                        <div className="text-[11px] text-[var(--text3)]">{job.serviceDate}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">{job.customer}</td>
                    <td className="px-3 py-2">{job.status}</td>
                    <td className="px-3 py-2 text-right">
                      <HoursCell figure={job.laborHours} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyCell figure={job.laborCost} money={money} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyCell figure={job.partsCost} money={money} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyCell figure={job.totalCost} money={money} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <RevenueCell figure={job.revenue} money={money} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyCell figure={job.margin} money={money} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyCell figure={job.quotedLabor} money={money} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-extrabold mb-1">{t('Where each figure comes from')}</h2>
        <dl className="card divide-y divide-[var(--border)]">
          {report.figures.map((item) => (
            <div key={item.figure} className="px-4 py-3">
              <dt className="text-sm font-semibold">{t(item.figure)}</dt>
              <dd className="text-xs text-[var(--text3)] mt-1">{item.source}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-[var(--text3)] mt-3">{report.inventoryNote}</p>
      </section>
    </div>
  );
}
