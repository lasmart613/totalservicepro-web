import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assembleFinancialReport,
  presentFinancialReport,
  type InvoiceColumnFlags,
} from './financial-reporting.ts';
import { homepageFinancialKpiResponse, selectHomepageFinancialKpis } from './home-financial-kpis.ts';
import { appStrings } from './i18n/app-copy.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '..');

const columns: InvoiceColumnFlags = {
  amount_paid: true,
  payment_method: true,
  paid_at: true,
  tax: true,
  due_date: true,
  invoice_date: true,
  invoice_data: true,
  total: true,
};

function sample() {
  return assembleFinancialReport({
    organizationId: 42,
    organizationName: 'Acme Laser',
    asOf: new Date('2026-10-02T15:00:00Z'),
    invoiceColumns: columns,
    invoices: [
      {
        id: 1,
        invoice_number: 'INV-1',
        status: 'sent',
        customer_name: 'Clinic A',
        total: 1000,
        tax: 0,
        amount_paid: 0,
        invoice_date: '2026-09-01',
        due_date: '2026-09-15',
      },
      {
        id: 2,
        invoice_number: 'INV-2',
        status: 'partially_paid',
        customer_name: 'Clinic B',
        total: 500,
        tax: 10,
        amount_paid: 200,
        payment_method: 'Check',
        invoice_date: '2026-09-10',
        due_date: '2026-10-01',
        invoice_data: { last_payment_at: '2026-09-12' },
      },
      {
        id: 3,
        invoice_number: 'INV-3',
        status: 'paid',
        customer_name: 'Clinic C',
        total: 300,
        tax: 20,
        amount_paid: 300,
        payment_method: 'Stripe',
        paid_at: '2026-10-02T12:00:00Z',
        invoice_date: '2026-10-01',
        due_date: '2026-10-15',
      },
    ],
    purchaseOrders: [
      { id: 1, po_number: 'PO-1', status: 'sent', supplier_name: 'Parts Co', total: 80 },
      { id: 2, po_number: 'PO-2', status: 'draft', supplier_name: 'Parts Co', total: 10 },
      { id: 3, po_number: 'PO-3', status: 'cancelled', supplier_name: 'Parts Co', total: 500 },
    ],
    estimates: [
      { id: 1, estimate_number: 'EST-1', status: 'sent', customer_name: 'Clinic A', total: 400 },
    ],
  });
}

function ids(report = sample()) {
  return selectHomepageFinancialKpis(report).map((card) => card.id);
}

test('premium homepage cards reuse report totals and omit unavailable cash paid out', () => {
  const report = sample();
  const cards = selectHomepageFinancialKpis(report);
  const byId = Object.fromEntries(cards.map((card) => [card.id, card]));

  assert.deepEqual(ids(report), [
    'accounts_receivable',
    'accounts_payable',
    'revenue_this_month',
    'collected_this_month',
    'paid_invoices',
    'billed_income',
    'cash_collected',
    'open_estimates',
    'average_job_value',
  ]);

  assert.equal(byId.accounts_receivable.amount, 1300);
  assert.equal(byId.accounts_receivable.count, 2);
  assert.equal(byId.accounts_receivable.label, 'Accounts receivable');
  assert.equal(byId.accounts_receivable.detailLabel, 'Outstanding invoices');
  assert.equal(byId.accounts_payable.amount, 80);
  assert.equal(byId.accounts_payable.label, 'Accounts payable');
  assert.equal(byId.accounts_payable.detailLabel, 'Purchase-order commitments');
  assert.match(byId.accounts_payable.note || '', /not cash paid to the supplier/);
  assert.equal(byId.collected_this_month.amount, report.summary.collectedThisMonth);
  assert.equal(cards.some((card) => card.id === 'cash_paid_out' || card.id === 'gross_margin'), false);

  const planted = {
    ...report,
    metrics: report.metrics.map((metric) =>
      metric.id === 'cash_paid_out' ? { ...metric, amount: 999 } : metric
    ),
  };
  assert.equal(selectHomepageFinancialKpis(planted).some((card) => card.amount === 999), false);
});

test('free presentation keeps summary totals and drops premium payable and line items', () => {
  const free = presentFinancialReport(sample(), false);
  const body = homepageFinancialKpiResponse(free);
  const byId = Object.fromEntries(body.kpis.map((card) => [card.id, card]));

  assert.equal(body.detailIncluded, false);
  assert.equal(byId.accounts_receivable.amount, 1300);
  assert.equal(byId.revenue_this_month.amount, 300);
  assert.ok(byId.paid_invoices);
  assert.ok(byId.open_estimates);
  assert.equal(byId.accounts_payable, undefined);
  assert.equal(byId.billed_income, undefined);
  assert.equal(byId.cash_collected, undefined);
  assert.deepEqual(Object.keys(body).sort(), ['currencyCode', 'detailIncluded', 'kpis', 'numberFormat']);
  assert.doesNotMatch(JSON.stringify(body), /Clinic A|INV-1|Parts Co/);
});

test('premium detail flags that were left on a free report are still ignored', () => {
  const leaked = { ...sample(), detailIncluded: false };
  const cards = selectHomepageFinancialKpis(leaked);
  assert.equal(cards.some((card) => card.id === 'accounts_payable'), false);
  assert.equal(cards.some((card) => card.id === 'billed_income'), false);
  assert.equal(cards.find((card) => card.id === 'accounts_receivable')?.amount, 1300);
});

test('a readable empty shop shows real zeros, and an unreadable payable total is omitted', () => {
  const empty = assembleFinancialReport({
    organizationId: 1,
    invoiceColumns: columns,
    invoices: [],
    purchaseOrders: [],
    estimates: [],
  });
  const premium = selectHomepageFinancialKpis(empty);
  assert.equal(premium.find((card) => card.id === 'accounts_receivable')?.amount, 0);
  assert.equal(premium.find((card) => card.id === 'accounts_receivable')?.count, 0);
  assert.equal(premium.find((card) => card.id === 'accounts_payable')?.amount, 0);

  const free = selectHomepageFinancialKpis(presentFinancialReport(empty, false));
  assert.equal(free.find((card) => card.id === 'accounts_receivable')?.amount, 0);
  assert.equal(free.find((card) => card.id === 'accounts_payable'), undefined);

  const unread = assembleFinancialReport({
    organizationId: 1,
    invoiceColumns: columns,
    invoices: [],
    purchaseOrders: null,
    purchaseOrderIssue: 'Purchase orders could not be read.',
    estimates: [],
  });
  assert.equal(selectHomepageFinancialKpis(unread).find((card) => card.id === 'accounts_payable'), undefined);
  assert.equal(selectHomepageFinancialKpis(unread).some((card) => card.amount == null), false);
});

test('homepage labels used by the cards are translated for es, de, and ar', () => {
  const keys = [
    'Financial KPIs',
    'Accounts receivable',
    'Accounts payable',
    'Loading financial KPIs...',
    'Financial KPIs could not be loaded.',
    '1 outstanding invoice',
    '{count} outstanding invoices',
    'Outstanding invoices',
    'Purchase-order commitments',
    'Issued invoices that still have a balance.',
  ];
  for (const key of keys) {
    for (const locale of ['es', 'de', 'ar'] as const) {
      const value = appStrings(locale)[key];
      assert.equal(typeof value, 'string', `${locale} ${key}`);
      assert.notEqual(value, key, `${locale} ${key}`);
    }
  }
  assert.ok(appStrings('ar')['{count} outstanding invoices'].includes('{count}'));
  assert.ok(appStrings('de')['{count} outstanding invoices'].includes('{count}'));
});

test('homepage loads financial cards from the authorized report route', () => {
  const home = readFileSync(join(webDir, 'components/home/HomeDashboard.tsx'), 'utf8');
  const ui = readFileSync(join(webDir, 'components/home/HomeFinancialKpis.tsx'), 'utf8');
  const route = readFileSync(join(webDir, 'app/api/business/home-financial-kpis/route.ts'), 'utf8');
  const server = readFileSync(join(webDir, 'lib/financial-reporting-server.ts'), 'utf8');

  assert.match(home, /canAccessFinancialReporting\(\{ role: orgPowerRole, god \}\) && <HomeFinancialKpis \/>/);
  assert.doesNotMatch(home, /from\('service_invoices'\)/);
  assert.doesNotMatch(home, /from\('purchase_orders'\)/);
  assert.match(ui, /HOME_FINANCIAL_KPI_API/);
  assert.match(ui, /Authorization/);
  assert.match(ui, /res\.status === 401 \|\| res\.status === 403/);
  assert.doesNotMatch(ui, /from\('service_invoices'\)/);
  assert.doesNotMatch(ui, /from\('purchase_orders'\)/);

  assert.match(route, /loadAuthorizedFinancialReport/);
  assert.match(route, /detailRequested: false/);
  assert.match(route, /homepageFinancialKpiResponse\(result\.report\)/);
  assert.match(route, /if \(!result\.ok\)/);
  assert.match(route, /status: result\.status/);
  assert.doesNotMatch(route, /NextResponse\.json\(result\.report\)/);
  assert.doesNotMatch(route, /getSupabaseAdmin/);
  assert.doesNotMatch(route, /service_invoices/);
  assert.match(server, /decideFinancialAccess/);
  assert.match(server, /gateFinancialDetail/);
  assert.match(server, /presentFinancialReport/);
});
