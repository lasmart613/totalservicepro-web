import type { ReactNode } from 'react';
import Link from 'next/link';
import type { HoursFigure, JobCostReport, MoneyFigure, RevenueFigure } from '@/lib/job-costing';

function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

function MoneyCell({ figure }: { figure: MoneyFigure }) {
  if (!figure.available || figure.amount == null) {
    return (
      <span className="text-[var(--text3)]" title={figure.reason || undefined}>
        Unavailable
      </span>
    );
  }
  return <span>{formatMoney(figure.amount)}</span>;
}

function HoursCell({ figure }: { figure: HoursFigure }) {
  if (!figure.available || figure.hours == null) {
    return (
      <span className="text-[var(--text3)]" title={figure.reason || undefined}>
        Unavailable
      </span>
    );
  }
  return <span>{figure.hours.toFixed(2)} h</span>;
}

function RevenueCell({ figure }: { figure: RevenueFigure }) {
  return (
    <div>
      <MoneyCell figure={figure} />
      {figure.available && figure.detail && (
        <div className="text-[11px] text-[var(--text3)]">
          {figure.basis === 'estimate' ? 'Estimate quote' : 'Invoice'} · {figure.detail}
        </div>
      )}
    </div>
  );
}

function Rollup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <article className="card p-4">
      <h2 className="text-sm font-semibold text-[var(--text2)]">{label}</h2>
      <div className="text-xl font-extrabold mt-1">{children}</div>
    </article>
  );
}

export function JobCostingView({ report }: { report: JobCostReport }) {
  const org =
    report.organizationName ||
    (report.organizationId ? `Organization ${report.organizationId}` : 'No active organization');

  return (
    <div className="max-w-6xl mx-auto w-full px-4 py-6">
      <h1 className="text-2xl font-extrabold">Job Costing</h1>
      <p className="text-sm text-[var(--text3)] mt-1">
        {org}
        {report.organizationId ? ` · org ${report.organizationId}` : ''}
        {' · '}as of {report.asOfDate} UTC
      </p>
      <p className="text-sm text-[var(--text2)] mt-3 max-w-3xl">
        Each repair order shows labor and parts taken from stored rows. A figure with no
        source says unavailable and is left out of totals. Quoted estimate labor is shown
        beside the job and is not added into cost or margin.
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
          <MoneyCell figure={report.rollups.laborCost} />
        </Rollup>
        <Rollup label="Parts and materials">
          <MoneyCell figure={report.rollups.partsCost} />
        </Rollup>
        <Rollup label="Total cost">
          <MoneyCell figure={report.rollups.totalCost} />
        </Rollup>
        <Rollup label="Revenue">
          <MoneyCell figure={report.rollups.revenue} />
        </Rollup>
        <Rollup label="Margin">
          <MoneyCell figure={report.rollups.margin} />
        </Rollup>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-extrabold mb-1">Repair orders</h2>
        <p className="text-xs text-[var(--text3)] mb-3">
          Shop totals above are the sum of these rows only when every repair order has that figure.
        </p>
        {report.ticketCount == null ? (
          <div className="card p-4 text-sm text-[var(--text3)]">
            {report.ticketIssue || 'Repair orders are unavailable because service_tickets could not be read.'}
          </div>
        ) : report.jobs.length === 0 ? (
          <div className="card p-4 text-sm text-[var(--text3)]">
            No repair orders were read for this organization.
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm min-w-[960px]">
              <thead className="text-left text-[var(--text3)]">
                <tr>
                  <th className="px-3 py-2 font-semibold">Repair order</th>
                  <th className="px-3 py-2 font-semibold">Customer</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold text-right">Labor hours</th>
                  <th className="px-3 py-2 font-semibold text-right">Labor cost</th>
                  <th className="px-3 py-2 font-semibold text-right">Parts</th>
                  <th className="px-3 py-2 font-semibold text-right">Total cost</th>
                  <th className="px-3 py-2 font-semibold text-right">Revenue</th>
                  <th className="px-3 py-2 font-semibold text-right">Margin</th>
                  <th className="px-3 py-2 font-semibold text-right">Quoted labor</th>
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
                      <MoneyCell figure={job.laborCost} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyCell figure={job.partsCost} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyCell figure={job.totalCost} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <RevenueCell figure={job.revenue} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyCell figure={job.margin} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyCell figure={job.quotedLabor} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-extrabold mb-1">Where each figure comes from</h2>
        <dl className="card divide-y divide-[var(--border)]">
          {report.figures.map((item) => (
            <div key={item.figure} className="px-4 py-3">
              <dt className="text-sm font-semibold">{item.figure}</dt>
              <dd className="text-xs text-[var(--text3)] mt-1">{item.source}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-[var(--text3)] mt-3">{report.inventoryNote}</p>
      </section>
    </div>
  );
}
