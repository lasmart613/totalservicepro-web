import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canAccessFinancialReporting,
  financialReportingNavLink,
  membershipRoleForActiveOrg,
} from './financial-reporting-access.ts';
import { decideFinancialAccess } from './financial-reporting-auth.ts';
import {
  assembleFinancialReport,
  invoiceColumnFlags,
  presentFinancialReport,
  type InvoiceColumnFlags,
} from './financial-reporting.ts';
import { loadShopFinancialSources, type FinanceClient } from './financial-reporting-load.ts';

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

function metric(id: string, report = sample()) {
  const hit = report.metrics.find((row) => row.id === id);
  assert.ok(hit, `missing metric ${id}`);
  return hit;
}

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
        invoice_data: { stripe_checkout_session_id: 'cs_test' },
      },
      {
        id: 4,
        invoice_number: 'INV-4',
        status: 'draft',
        customer_name: 'Clinic D',
        total: 50,
        amount_paid: 0,
        invoice_date: '2026-10-02',
      },
      {
        id: 5,
        invoice_number: 'INV-5',
        status: 'cancelled',
        customer_name: 'Clinic E',
        total: 999,
        amount_paid: 40,
        payment_method: 'Cash',
      },
      {
        id: 6,
        invoice_number: 'INV-6',
        status: 'paid',
        customer_name: 'Clinic F',
        total: 100,
        tax: null,
        amount_paid: null,
        invoice_date: '2026-10-02',
      },
    ],
    purchaseOrders: [
      { id: 1, po_number: 'PO-1', status: 'sent', supplier_name: 'Parts Co', total: 80 },
      { id: 2, po_number: 'PO-2', status: 'draft', supplier_name: 'Parts Co', total: 10 },
      { id: 3, po_number: 'PO-3', status: 'cancelled', supplier_name: 'Parts Co', total: 500 },
    ],
    estimates: [
      { id: 1, estimate_number: 'EST-1', status: 'sent', customer_name: 'Clinic A', total: 400 },
      { id: 2, estimate_number: 'EST-2', status: 'invoiced', customer_name: 'Clinic B', total: 100 },
    ],
  });
}

test('admin and God may open financial reporting; other roles may not', () => {
  for (const role of ['admin', 'company_admin', 'Company_Admin']) {
    assert.equal(canAccessFinancialReporting({ role }), true);
    assert.equal(financialReportingNavLink({ role })?.href, '/business/financial-reporting');
  }
  for (const role of ['fse', 'engineer', 'technician', 'billing_manager', 'service_manager', 'dispatcher', 'scheduler', 'owner', 'customer', '']) {
    assert.equal(canAccessFinancialReporting({ role }), false, role);
    assert.equal(financialReportingNavLink({ role }), null, role);
  }
  assert.equal(canAccessFinancialReporting({ role: 'fse', god: true }), true);
  assert.equal(financialReportingNavLink({ role: 'fse', god: true })?.label, 'Financial Reporting');
});

test('server gate uses the active org membership role plus God, not the profile role', () => {
  const env = {};
  assert.equal(decideFinancialAccess({ user: null, env }).status, 401);
  assert.equal(
    decideFinancialAccess({ user: { id: 'u1', email: 'tech@shop.test' }, membershipRole: 'billing_manager', env }).status,
    403
  );
  assert.equal(
    decideFinancialAccess({ user: { id: 'u1', email: 'tech@shop.test' }, membershipRole: 'fse', env }).status,
    403
  );
  assert.equal(
    decideFinancialAccess({ user: { id: 'u1', email: 'owner@clinic.test' }, membershipRole: 'owner', env }).ok,
    false
  );

  const profileOnly = decideFinancialAccess({
    user: { id: 'u1', email: 'admin@shop.test' },
    activeOrganizationId: 9,
    env,
  });
  assert.equal(profileOnly.ok, false);
  if (!profileOnly.ok) assert.equal(profileOnly.status, 403);

  const admin = decideFinancialAccess({
    user: { id: 'u1', email: 'tech@shop.test' },
    membershipRole: 'company_admin',
    activeOrganizationId: 9,
    env,
  });
  assert.equal(admin.ok, true);
  if (admin.ok) assert.equal(admin.organizationId, 9);

  const platformAdmin = decideFinancialAccess({
    user: { id: 'u1', email: 'admin@shop.test' },
    membershipRole: 'fse',
    isPlatformAdmin: true,
    activeOrganizationId: 9,
    env,
  });
  assert.equal(platformAdmin.ok, true);

  const god = decideFinancialAccess({
    user: { id: 'larry', email: 'larrysmart@gmail.com' },
    membershipRole: 'fse',
    activeOrganizationId: 3,
    env,
  });
  assert.equal(god.ok, true);
  if (god.ok) assert.equal(god.god, true);

  assert.equal(
    membershipRoleForActiveOrg(
      [
        { organization_id: 1, role: 'admin' },
        { organization_id: 2, role: 'fse' },
      ],
      2
    ),
    'fse'
  );
  const moonlight = decideFinancialAccess({
    user: { id: 'u2', email: 'moon@shop.test' },
    activeOrganizationId: 1,
    membershipRole: 'company_admin',
    env,
  });
  assert.equal(moonlight.ok, true);
  const otherShop = decideFinancialAccess({
    user: { id: 'u2', email: 'moon@shop.test' },
    activeOrganizationId: 2,
    membershipRole: membershipRoleForActiveOrg(
      [
        { organization_id: 1, role: 'admin' },
        { organization_id: 2, role: 'fse' },
      ],
      2
    ),
    env,
  });
  assert.equal(otherShop.ok, false);
});

test('figures come from invoice, purchase order, and estimate rows', () => {
  const report = sample();
  const billed = metric('billed_income', report);
  assert.equal(billed.availability, 'available');
  assert.equal(billed.amount, 1900);
  assert.equal(billed.count, 4);

  const collected = metric('cash_collected', report);
  assert.equal(collected.amount, 500);
  assert.match(collected.note || '', /no recorded payment/);

  const outstanding = metric('outstanding_balance', report);
  assert.equal(outstanding.amount, 1300);
  assert.equal(outstanding.count, 2);
  assert.deepEqual(
    report.outstanding.map((row) => [row.number, row.balance]),
    [
      ['INV-1', 1000],
      ['INV-2', 300],
    ]
  );

  assert.equal(metric('draft_invoices', report).amount, 50);
  assert.equal(metric('sales_tax', report).amount, 30);
  assert.equal(metric('billed_this_month', report).amount, 400);
  assert.equal(metric('collected_this_month', report).amount, 300);
  assert.equal(metric('stripe_processed', report).amount, 300);
  assert.equal(metric('voided_payments', report).amount, 40);
  assert.equal(metric('po_commitments', report).amount, 80);
  assert.equal(metric('po_drafts', report).amount, 10);
  assert.equal(metric('estimate_pipeline', report).amount, 400);
  assert.match(metric('estimate_pipeline', report).note || '', /Not income/);

  assert.equal(metric('cash_paid_out', report).availability, 'unavailable');
  assert.equal(metric('cash_paid_out', report).amount, undefined);
  assert.match(metric('cash_paid_out', report).reason || '', /Payment details aren't recorded yet/);
  assert.doesNotMatch(
    `${metric('cash_paid_out', report).reason} ${metric('cash_paid_out', report).source}`,
    /purchase_orders|amount_paid|paid_at|payment_method/
  );
  assert.equal(metric('net_cash_flow', report).availability, 'unavailable');
  assert.equal(metric('processing_fees', report).availability, 'unavailable');
  assert.equal(metric('bank_balance', report).availability, 'unavailable');
  assert.equal(metric('payroll', report).availability, 'unavailable');
  assert.match(metric('payroll', report).reason || '', /Labor hours aren't recorded yet/);
  assert.doesNotMatch(metric('payroll', report).reason || '', /labor_log/);
  for (const row of report.metrics) {
    const shown = `${row.reason || ''} ${row.note || ''} ${row.source}`;
    assert.doesNotMatch(shown, /purchase_orders|labor_log|service_invoices|service_estimates|amount_paid|paid_at|payment_method|invoice_data|invoice_date/);
  }
  assert.equal(metric('marketplace_payouts', report).availability, 'unavailable');

  assert.equal(report.paymentMethods.find((row) => row.method === 'Stripe')?.amount, 300);
  assert.equal(report.paymentMethods.find((row) => row.method === 'Check')?.amount, 200);
  assert.equal(report.aging?.find((row) => row.id === '1_30')?.amount, 1300);
  assert.equal(report.unpricedInvoices.some((row) => row.number === 'INV-6'), true);
});

test('deposit in invoice_data counts as collected when amount_paid is zero', () => {
  const report = assembleFinancialReport({
    organizationId: 1,
    asOf: new Date('2026-10-02T00:00:00Z'),
    invoiceColumns: columns,
    invoices: [
      {
        id: 7,
        status: 'sent',
        customer_name: 'Clinic G',
        total: 80,
        amount_paid: 0,
        invoice_data: { deposit: 25, depositMethod: 'Stripe', stripe_checkout_session_id: 'cs_2' },
        due_date: '2026-10-20',
      },
    ],
    purchaseOrders: [],
    estimates: [],
  });
  assert.equal(metric('cash_collected', report).amount, 25);
  assert.equal(metric('outstanding_balance', report).amount, 55);
  assert.equal(metric('stripe_processed', report).amount, 25);
});

test('collected cash is unavailable when payment fields were not returned', () => {
  const report = assembleFinancialReport({
    organizationId: 1,
    asOf: new Date('2026-10-02T00:00:00Z'),
    invoiceColumns: invoiceColumnFlags('id, status, customer_name, total, created_at, organization_id'),
    invoices: [{ id: 1, status: 'paid', customer_name: 'Clinic', total: 10 }],
    purchaseOrders: null,
    purchaseOrderIssue: 'relation purchase_orders does not exist',
    estimates: null,
    estimateIssue: 'relation service_estimates does not exist',
  });
  assert.equal(metric('billed_income', report).amount, 10);
  assert.equal(metric('cash_collected', report).availability, 'unavailable');
  assert.equal(metric('cash_collected', report).amount, undefined);
  assert.equal(metric('po_commitments', report).availability, 'unavailable');
  assert.match(metric('po_commitments', report).reason || '', /Purchase orders could not be read/);
  assert.doesNotMatch(metric('po_commitments', report).reason || '', /purchase_orders/);
  assert.match(metric('estimate_pipeline', report).reason || '', /Estimates could not be read/);
  assert.doesNotMatch(metric('estimate_pipeline', report).reason || '', /service_estimates/);
  assert.doesNotMatch(metric('cash_collected', report).reason || '', /amount_paid|invoice_data/);
  assert.equal(metric('estimate_pipeline', report).availability, 'unavailable');
  assert.equal(report.aging, null);
  assert.match(report.agingReason || '', /due date/);
});

test('a failed invoice read does not become a zero total', () => {
  const report = assembleFinancialReport({
    organizationId: null,
    invoiceColumns: invoiceColumnFlags(''),
    invoices: null,
    invoiceIssue: 'This login has no active organization, so shop invoices cannot be scoped.',
    purchaseOrders: null,
    purchaseOrderIssue: 'no org',
    estimates: null,
    estimateIssue: 'no org',
  });
  assert.equal(metric('billed_income', report).availability, 'unavailable');
  assert.equal(metric('outstanding_balance', report).amount, undefined);
  assert.equal(report.invoiceRowCount, null);
  assert.equal(report.outstanding.length, 0);
});

test('loader retries when a payment column is missing and does not invent rows', async () => {
  const seen: string[] = [];
  const client: FinanceClient = {
    from(table: string) {
      let columns = '';
      const query = {
        select(next: string) {
          columns = next;
          return query;
        },
        eq() {
          return query;
        },
        order() {
          return query;
        },
        async range() {
          seen.push(`${table}:${columns.includes('amount_paid') ? 'paid' : 'base'}`);
          if (table === 'service_invoices' && columns.includes('amount_paid')) {
            return { data: null, error: { message: "Could not find the 'amount_paid' column of 'service_invoices' in the schema cache" } };
          }
          if (table === 'service_invoices') {
            return {
              data: [{ id: 1, status: 'sent', customer_name: 'Clinic', total: 20, invoice_data: { deposit: 5 } }],
              error: null,
            };
          }
          return { data: [], error: null };
        },
      };
      return query;
    },
  };

  const sources = await loadShopFinancialSources(client, 42);
  assert.equal(sources.invoiceIssue, null);
  assert.equal(sources.invoiceColumns.amount_paid, false);
  assert.equal(sources.invoiceColumns.invoice_data, true);
  assert.equal(sources.invoices?.length, 1);
  const report = assembleFinancialReport({
    organizationId: 42,
    asOf: new Date('2026-10-02T00:00:00Z'),
    ...sources,
  });
  assert.equal(metric('cash_collected', report).amount, 5);
  assert.equal(metric('outstanding_balance', report).amount, 15);
  assert.ok(seen.some((line) => line === 'service_invoices:paid'));
  assert.ok(seen.some((line) => line === 'service_invoices:base'));
});

test('nav and page keep financial reporting in Business Management and enforce it on the server', () => {
  const header = readFileSync(join(webDir, 'components/Header.tsx'), 'utf8');
  const hub = readFileSync(join(webDir, 'app/hub/page.tsx'), 'utf8');
  const home = readFileSync(join(webDir, 'components/home/HomeDashboard.tsx'), 'utf8');
  const page = readFileSync(join(webDir, 'app/business/financial-reporting/page.tsx'), 'utf8');
  const route = readFileSync(join(webDir, 'app/api/business/financial-reporting/route.ts'), 'utf8');
  const server = readFileSync(join(webDir, 'lib/financial-reporting-server.ts'), 'utf8');
  const reports = readFileSync(join(webDir, 'app/reports/page.tsx'), 'utf8');
  const adminReports = readFileSync(join(webDir, 'app/admin/reports/page.tsx'), 'utf8');

  assert.match(header, /label: 'Business Management'/);
  assert.match(header, /financialReportingNavLink\(\{ role: orgPowerRole, god: isGod \}\)/);
  assert.match(header, /\.\.\.\(financialNav \? \[financialNav\] : \[\]\)/);
  assert.match(hub, /canAccessFinancialReporting\(\{ role: orgPowerRole, god \}\)/);
  assert.match(hub, /\/business\/financial-reporting/);
  assert.match(home, /canAccessFinancialReporting\(\{ role: orgPowerRole, god \}\)/);
  assert.doesNotMatch(reports, /financial-reporting/);
  assert.doesNotMatch(adminReports, /financial-reporting/);

  assert.match(page, /loadAuthorizedFinancialReport/);
  assert.match(page, /FinancialReportingGate/);
  assert.doesNotMatch(page, /from\('service_invoices'\)/);
  assert.match(route, /result\.status === 403/);
  assert.match(route, /loadAuthorizedFinancialReport/);
  assert.match(server, /decideFinancialAccess/);
  assert.doesNotMatch(readFileSync(join(webDir, 'lib/financial-reporting-access.ts'), 'utf8'), /from '\.\/god/);
  assert.doesNotMatch(header, /from '@\/lib\/god'/);
  assert.doesNotMatch(header, /larrysmart@gmail\.com/);
  assert.match(route, /export function DELETE/);
  assert.match(readFileSync(join(webDir, 'lib/auth-session.ts'), 'utf8'), /method: 'DELETE'/);
  assert.match(server, /email: user\.email/);
  assert.doesNotMatch(server, /getSupabaseAdmin/);
  assert.match(server, /gateFinancialDetail/);
  assert.match(readFileSync(join(webDir, 'lib/job-costing-server.ts'), 'utf8'), /gateJobCostingPlan/);
});

test('summary KPIs use the same invoice rows and free presentation drops line items', () => {
  const report = sample();
  const revenue = report.summary.kpis.find((row) => row.id === 'revenue_this_month');
  const outstanding = report.summary.kpis.find((row) => row.id === 'outstanding_invoices');
  const paid = report.summary.kpis.find((row) => row.id === 'paid_invoices');
  const average = report.summary.kpis.find((row) => row.id === 'average_job_value');
  const margin = report.summary.kpis.find((row) => row.id === 'gross_margin');
  const open = report.summary.kpis.find((row) => row.id === 'open_estimates');
  assert.equal(revenue?.amount, 400);
  assert.equal(revenue?.compareAmount, 1500);
  assert.equal(outstanding?.amount, 1300);
  assert.equal(paid?.amount, 300);
  assert.equal(paid?.count, 1);
  assert.equal(average?.amount, 475);
  assert.equal(margin?.availability, 'unavailable');
  assert.equal(open?.amount, 400);
  assert.equal(report.summary.monthlyRevenue?.find((point) => point.month === '2026-10')?.amount, 400);
  assert.equal(report.currencyCode, 'USD');
  assert.equal(report.detailIncluded, true);
  assert.ok(report.outstanding.length > 0);

  const free = presentFinancialReport(report, false);
  assert.equal(free.detailIncluded, false);
  assert.equal(free.outstanding.length, 0);
  assert.equal(free.paymentMethods.length, 0);
  assert.equal(free.aging, null);
  assert.equal(free.metrics.length, 0);
  assert.equal(free.summary.kpis.find((row) => row.id === 'outstanding_invoices')?.amount, 1300);

  const eur = assembleFinancialReport({
    organizationId: 1,
    currencyCode: 'eur',
    numberFormat: 'dot_comma_after',
    invoices: [],
    invoiceColumns: columns,
    purchaseOrders: [],
    estimates: [],
  });
  assert.equal(eur.currencyCode, 'EUR');
  assert.equal(eur.numberFormat, 'dot_comma_after');
});
