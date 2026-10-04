'use client';

import Link from 'next/link';
import { money } from '@/lib/billing/save-helpers';
import type { FinancialMetric, FinancialReport } from '@/lib/financial-reporting';
import { useT } from '@/lib/fa/locale';

function MetricCard({ metric }: { metric: FinancialMetric }) {
  const t = useT();
  const unavailable = metric.availability !== 'available';
  return (
    <article className="card p-4 flex flex-col gap-2 min-h-[9.5rem]">
      <h2 className="text-sm font-semibold text-[var(--text2)]">{t(metric.label)}</h2>
      <div className={`text-2xl font-extrabold ${unavailable ? 'text-[var(--text3)]' : 'text-[var(--text)]'}`}>
        {unavailable ? t('Unavailable') : money(metric.amount || 0)}
      </div>
      {metric.count != null && !unavailable && (
        <div className="text-xs text-[var(--text3)]">{metric.count} row{metric.count === 1 ? '' : 's'}</div>
      )}
      <p className="text-xs text-[var(--text3)] mt-auto">
        {unavailable ? metric.reason : metric.note || metric.source}
      </p>
      {!unavailable && metric.note && (
        <p className="text-[11px] text-[var(--text3)]">Source: {metric.source}</p>
      )}
    </article>
  );
}

export function FinancialReportingView({ report }: { report: FinancialReport }) {
  const t = useT();
  const org = report.organizationName || (report.organizationId ? `Organization ${report.organizationId}` : t('No active organization'));

  return (
    <div className="max-w-6xl mx-auto w-full px-4 py-6">
      <h1 className="text-2xl font-extrabold">{t('Financial Reporting')}</h1>
      <p className="text-sm text-[var(--text3)] mt-1">
        {org}
        {report.organizationId ? ` · org ${report.organizationId}` : ''}
        {' · '}{t('as of')} {report.asOfDate} UTC
      </p>
      <p className="text-sm text-[var(--text2)] mt-3 max-w-3xl">
        {t('Figures are sums of stored rows for this organization. Amounts are shown in dollars, the same way invoices and purchase orders are. A metric that has no table or column says unavailable and has no total.')}
      </p>
      <p className="text-xs text-[var(--text3)] mt-2">
        Invoices read: {report.invoiceRowCount == null ? 'unavailable' : report.invoiceRowCount}
        {' · '}Purchase orders read: {report.purchaseOrderRowCount == null ? 'unavailable' : report.purchaseOrderRowCount}
        {' · '}Estimates read: {report.estimateRowCount == null ? 'unavailable' : report.estimateRowCount}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
        {report.metrics.map((metric) => (
          <MetricCard key={metric.id} metric={metric} />
        ))}
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-extrabold mb-1">{t('Outstanding unpaid invoices')}</h2>
        <p className="text-xs text-[var(--text3)] mb-3">
          Source: service_invoices. Issued invoices with total minus recorded payment still above zero.
          Drafts, voided, and cancelled invoices are omitted.
        </p>
        {report.outstanding.length === 0 ? (
          <div className="card p-4 text-sm text-[var(--text3)]">
            {report.invoiceRowCount == null
              ? 'Outstanding invoices are unavailable because service_invoices could not be read.'
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
                    <td className="px-3 py-2">{row.status}</td>
                    <td className="px-3 py-2">{row.invoiceDate || '—'}</td>
                    <td className="px-3 py-2">{row.dueDate || '—'}</td>
                    <td className="px-3 py-2 text-right">{money(row.total)}</td>
                    <td className="px-3 py-2 text-right">{money(row.amountPaid)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{money(row.balance)}</td>
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
              <thead className="text-left text-[var(--text3)]">
                <tr>
                  <th className="px-3 py-2 font-semibold">Invoice</th>
                  <th className="px-3 py-2 font-semibold">Customer</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Why it was omitted</th>
                </tr>
              </thead>
              <tbody>
                {report.unpricedInvoices.map((row, index) => (
                  <tr key={`${row.id}-${row.reason}-${index}`} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2">{row.number || row.id || '—'}</td>
                    <td className="px-3 py-2">{row.customer}</td>
                    <td className="px-3 py-2">{row.status}</td>
                    <td className="px-3 py-2">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-extrabold mb-1">Payment processing</h2>
        <p className="text-xs text-[var(--text3)] mb-3">
          Collected amounts grouped by the method stored on the invoice. Fees are unavailable.
        </p>
        {report.paymentMethods.length === 0 ? (
          <div className="card p-4 text-sm text-[var(--text3)]">
            No collected payments were read, or payment rows are unavailable.
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[var(--text3)]">
                <tr>
                  <th className="px-3 py-2 font-semibold">Method</th>
                  <th className="px-3 py-2 font-semibold text-right">Collected</th>
                  <th className="px-3 py-2 font-semibold text-right">Payments</th>
                  <th className="px-3 py-2 font-semibold">Source</th>
                </tr>
              </thead>
              <tbody>
                {report.paymentMethods.map((row) => (
                  <tr key={row.method} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2">{row.method}</td>
                    <td className="px-3 py-2 text-right">{money(row.amount)}</td>
                    <td className="px-3 py-2 text-right">{row.count}</td>
                    <td className="px-3 py-2 text-xs text-[var(--text3)]">{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-extrabold mb-1">Outstanding aging</h2>
        <p className="text-xs text-[var(--text3)] mb-3">
          {report.agingReason || 'Buckets use service_invoices.due_date compared with today (UTC).'}
        </p>
        {report.aging == null ? (
          <div className="card p-4 text-sm text-[var(--text3)]">Aging is unavailable.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {report.aging.map((bucket) => (
              <div key={bucket.id} className="card p-4">
                <div className="text-sm text-[var(--text2)]">{bucket.label}</div>
                <div className="text-xl font-extrabold mt-1">{money(bucket.amount)}</div>
                <div className="text-xs text-[var(--text3)] mt-1">{bucket.count} invoice{bucket.count === 1 ? '' : 's'}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
