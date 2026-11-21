/**
 * Homepage financial cards from an already authorized, already tiered report.
 * Does not read the database and does not decide who may see the figures.
 * The API loader does that, then calls this.
 *
 * Free plans keep the summary totals Financial Reporting already shows.
 * Premium detail metrics are included only when detailIncluded is true.
 * A metric that is unavailable is omitted. It is not turned into zero.
 */

import type { FinancialMetric, FinancialReport, MoneyKpi } from './financial-reporting.ts';

export const HOME_FINANCIAL_KPI_API = '/api/business/home-financial-kpis';

export type HomepageFinancialKpi = {
  id: string;
  label: string;
  /** Second line, such as the outstanding-invoice name or the purchase-order source. */
  detailLabel: string | null;
  amount: number;
  count: number | null;
  note: string | null;
  compareAmount: number | null;
  deltaPercent: number | null;
  href: string;
};

export type HomepageFinancialKpiPayload = {
  currencyCode: string;
  numberFormat: string;
  detailIncluded: boolean;
  kpis: HomepageFinancialKpi[];
};

const REPORT_HREF = '/business/financial-reporting';

function isMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Drop notes that interpolate a count or a month, so the homepage does not show an untranslated sentence. */
function staticNote(note: string | null | undefined): string | null {
  if (!note) return null;
  if (/\d/.test(note)) return null;
  return note;
}

function fromSummary(
  kpi: MoneyKpi | undefined,
  patch: {
    id: string;
    label: string;
    href: string;
    detailLabel?: string | null;
    note?: string | null;
  }
): HomepageFinancialKpi | null {
  if (!kpi || kpi.availability !== 'available' || !isMoney(kpi.amount)) return null;
  return {
    id: patch.id,
    label: patch.label,
    detailLabel: patch.detailLabel ?? null,
    amount: kpi.amount,
    count: typeof kpi.count === 'number' ? kpi.count : null,
    note: patch.note !== undefined ? patch.note : staticNote(kpi.note),
    compareAmount: isMoney(kpi.compareAmount) ? kpi.compareAmount : null,
    deltaPercent:
      typeof kpi.deltaPercent === 'number' && Number.isFinite(kpi.deltaPercent) ? kpi.deltaPercent : null,
    href: patch.href,
  };
}

function fromMetric(
  metric: FinancialMetric | undefined,
  patch: {
    id: string;
    label: string;
    href: string;
    detailLabel?: string | null;
    note?: string | null;
  }
): HomepageFinancialKpi | null {
  if (!metric || metric.availability !== 'available' || !isMoney(metric.amount)) return null;
  return {
    id: patch.id,
    label: patch.label,
    detailLabel: patch.detailLabel ?? null,
    amount: metric.amount,
    count: typeof metric.count === 'number' ? metric.count : null,
    note: patch.note !== undefined ? patch.note : staticNote(metric.note),
    compareAmount: null,
    deltaPercent: null,
    href: patch.href,
  };
}

/**
 * Cards for the logged-in homepage.
 * Accounts receivable is the outstanding issued-invoice balance (one figure,
 * also labeled outstanding invoices). Accounts payable is open purchase-order
 * commitments, which exist only on the Premium detail report. Cash paid to
 * suppliers is not stored, so that unavailable metric is left off.
 */
export function selectHomepageFinancialKpis(report: FinancialReport): HomepageFinancialKpi[] {
  const summary = new Map((report.summary?.kpis || []).map((kpi) => [kpi.id, kpi]));
  const premium = report.detailIncluded === true;
  const metrics = premium ? new Map((report.metrics || []).map((metric) => [metric.id, metric])) : null;

  const cards: Array<HomepageFinancialKpi | null> = [
    fromSummary(summary.get('outstanding_invoices'), {
      id: 'accounts_receivable',
      label: 'Accounts receivable',
      detailLabel: 'Outstanding invoices',
      href: REPORT_HREF,
      note: 'Issued invoices that still have a balance.',
    }),
  ];

  if (metrics) {
    cards.push(
      fromMetric(metrics.get('po_commitments'), {
        id: 'accounts_payable',
        label: 'Accounts payable',
        detailLabel: 'Purchase-order commitments',
        href: '/purchase-orders',
      })
    );
  }

  cards.push(
    fromSummary(summary.get('revenue_this_month'), {
      id: 'revenue_this_month',
      label: 'Revenue this month',
      href: REPORT_HREF,
    })
  );

  if (isMoney(report.summary?.collectedThisMonth)) {
    cards.push({
      id: 'collected_this_month',
      label: 'Collected this month',
      detailLabel: null,
      amount: report.summary.collectedThisMonth,
      count: null,
      note: null,
      compareAmount: null,
      deltaPercent: null,
      href: REPORT_HREF,
    });
  }

  cards.push(
    fromSummary(summary.get('paid_invoices'), {
      id: 'paid_invoices',
      label: 'Paid invoices',
      href: '/invoices',
    })
  );

  if (metrics) {
    cards.push(
      fromMetric(metrics.get('billed_income'), {
        id: 'billed_income',
        label: 'Billed income',
        href: REPORT_HREF,
      }),
      fromMetric(metrics.get('cash_collected'), {
        id: 'cash_collected',
        label: 'Cash collected',
        href: REPORT_HREF,
      })
    );
  }

  cards.push(
    fromSummary(summary.get('open_estimates'), {
      id: 'open_estimates',
      label: 'Open estimates',
      href: '/estimates',
    }),
    fromSummary(summary.get('average_job_value'), {
      id: 'average_job_value',
      label: 'Average job value',
      href: REPORT_HREF,
    })
  );

  return cards.filter((card): card is HomepageFinancialKpi => card != null);
}

/** JSON body for the homepage. Line items, customer names, and raw metrics stay off. */
export function homepageFinancialKpiResponse(report: FinancialReport): HomepageFinancialKpiPayload {
  return {
    currencyCode: report.currencyCode,
    numberFormat: report.numberFormat,
    detailIncluded: report.detailIncluded === true,
    kpis: selectHomepageFinancialKpis(report),
  };
}
