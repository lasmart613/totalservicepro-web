import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canAccessJobCosting, jobCostingNavLink, membershipRoleForActiveOrg } from './job-costing-access.ts';
import { decideJobCostingAccess } from './job-costing-auth.ts';
import { assembleJobCostReport, type JobCostInput } from './job-costing.ts';
import { loadJobCostSources, type JobCostClient, type JobCostQuery } from './job-costing-load.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '..');

function read(rel: string): string {
  return readFileSync(join(webDir, rel), 'utf8');
}

function input(overrides: Partial<JobCostInput> = {}): JobCostInput {
  return {
    organizationId: 7,
    organizationName: 'Shop',
    tickets: [
      {
        id: 't1',
        ticket_number: 'RO-1',
        customer_name: 'Ada Clinic',
        status: 'open',
        estimate_id: 'e1',
        service_date: '2026-03-01',
      },
    ],
    ticketIssue: null,
    labor: [],
    laborIssue: null,
    wageColumnsPresent: false,
    parts: [],
    partsIssue: null,
    estimates: [
      {
        id: 'e1',
        estimate_number: 'EST-1',
        total: 500,
        estimate_data: { labor: 200, pricing: { laborRate: 185 }, laborHours: 2 },
      },
    ],
    estimateIssue: null,
    invoices: [],
    invoiceIssue: null,
    asOf: '2026-04-01',
    ...overrides,
  };
}

function job(overrides: Partial<JobCostInput> = {}) {
  const report = assembleJobCostReport(input(overrides));
  assert.equal(report.jobs.length, 1);
  return report.jobs[0];
}

test('admin and God can open job costing; other roles cannot', () => {
  for (const role of ['admin', 'company_admin']) {
    assert.equal(canAccessJobCosting({ role }), true);
    assert.equal(jobCostingNavLink({ role })?.href, '/business/job-costing');
  }

  const membershipAdmin = decideJobCostingAccess({
    user: { id: 'u1', email: 'tech@shop.test' },
    membershipRole: 'company_admin',
    activeOrganizationId: 7,
    env: {},
  });
  assert.equal(membershipAdmin.ok, true);
  if (membershipAdmin.ok) assert.equal(membershipAdmin.organizationId, 7);

  const profileOnly = decideJobCostingAccess({
    user: { id: 'u1', email: 'admin@shop.test' },
    activeOrganizationId: 7,
    env: {},
  });
  assert.equal(profileOnly.ok, false);
  if (!profileOnly.ok) assert.equal(profileOnly.status, 403);

  const platformAdmin = decideJobCostingAccess({
    user: { id: 'u1', email: 'admin@shop.test' },
    membershipRole: 'fse',
    isPlatformAdmin: true,
    activeOrganizationId: 7,
    env: {},
  });
  assert.equal(platformAdmin.ok, true);

  for (const role of ['fse', 'billing_manager', 'service_manager', 'dispatcher', 'scheduler', 'owner', 'customer']) {
    assert.equal(canAccessJobCosting({ role }), false);
    assert.equal(jobCostingNavLink({ role }), null);
    const access = decideJobCostingAccess({
      user: { id: 'u1', email: 'tech@shop.test' },
      membershipRole: role,
      env: {},
    });
    assert.equal(access.ok, false);
    if (!access.ok) assert.equal(access.status, 403);
  }

  assert.equal(canAccessJobCosting({ role: 'fse', god: true }), true);
  const god = decideJobCostingAccess({
    user: { id: 'larry', email: 'larrysmart@gmail.com' },
    membershipRole: 'fse',
    activeOrganizationId: 3,
    env: {},
  });
  assert.equal(god.ok, true);

  assert.equal(decideJobCostingAccess({ user: null, env: {} }).ok, false);
  const missing = decideJobCostingAccess({ user: { id: '', email: 'larrysmart@gmail.com' }, env: {} });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 401);
});

test('admin membership is the active organization only', () => {
  assert.equal(membershipRoleForActiveOrg([{ role: 'admin', organization_id: 9 }], 9), 'admin');
  assert.equal(membershipRoleForActiveOrg([{ role: 'admin', organization_id: 8 }], 9), null);

  const allowed = decideJobCostingAccess({
    user: { id: 'u1', email: 'tech@shop.test' },
    activeOrganizationId: 9,
    membershipRole: 'admin',
    env: {},
  });
  assert.equal(allowed.ok, true);

  const otherOrg = decideJobCostingAccess({
    user: { id: 'u1', email: 'tech@shop.test' },
    activeOrganizationId: 9,
    membershipRole: membershipRoleForActiveOrg([{ role: 'admin', organization_id: 8 }], 9),
    env: {},
  });
  assert.equal(otherOrg.ok, false);
});

test('labor hours prefer duration_minutes, otherwise the clock span, and do not partial-sum', () => {
  const fromDuration = job({
    labor: [{ id: 'l1', ticket_id: 't1', duration_minutes: 90, clock_in: '2026-03-01T00:00:00Z', clock_out: '2026-03-01T05:00:00Z' }],
    wageColumnsPresent: false,
  });
  assert.equal(fromDuration.laborHours.hours, 1.5);

  const fromClock = job({
    labor: [{ id: 'l1', ticket_id: 't1', duration_minutes: null, clock_in: '2026-03-01T00:00:00Z', clock_out: '2026-03-01T01:30:00Z' }],
  });
  assert.equal(fromClock.laborHours.hours, 1.5);

  const partial = job({
    labor: [
      { id: 'l1', ticket_id: 't1', duration_minutes: 60 },
      { id: 'l2', ticket_id: 't1', duration_minutes: null, clock_in: null, clock_out: null },
    ],
  });
  assert.equal(partial.laborHours.available, false);
  assert.equal(partial.laborHours.hours, null);

  const empty = job({ labor: [] });
  assert.equal(empty.laborHours.hours, 0);
});

test('parts cost is quantity times stored unit cost, or unavailable when a line has no cost', () => {
  const priced = job({
    parts: [{ id: 'p1', ticket_id: 't1', quantity: 2, unit_cost: 40 }],
  });
  assert.equal(priced.partsCost.amount, 80);

  const missing = job({
    parts: [
      { id: 'p1', ticket_id: 't1', quantity: 2, unit_cost: 40 },
      { id: 'p2', ticket_id: 't1', quantity: 1, unit_cost: null },
    ],
  });
  assert.equal(missing.partsCost.available, false);
  assert.equal(missing.partsCost.amount, null);

  const none = job({ parts: [] });
  assert.equal(none.partsCost.amount, 0);
});

test('labor cost, total cost, and margin stay unavailable when no wage column is returned', () => {
  const row = job({
    labor: [{ id: 'l1', ticket_id: 't1', duration_minutes: 120 }],
    parts: [{ id: 'p1', ticket_id: 't1', quantity: 2, unit_cost: 40 }],
    invoices: [{ id: 'i1', estimate_id: 'e1', status: 'paid', total: 500, invoice_number: 'INV-1' }],
    wageColumnsPresent: false,
  });
  assert.equal(row.laborHours.hours, 2);
  assert.equal(row.laborCost.available, false);
  assert.equal(row.laborCost.amount, null);
  assert.equal(row.totalCost.available, false);
  assert.equal(row.margin.available, false);
  assert.equal(row.revenue.amount, 500);
  assert.equal(row.quotedLabor.amount, 200);
  assert.notEqual(row.laborCost.amount, 370);
});

test('an empty labor log is 0 hours, and labor cost is $0 only when a wage column exists', () => {
  const noWage = job({ labor: [], wageColumnsPresent: false });
  assert.equal(noWage.laborHours.hours, 0);
  assert.equal(noWage.laborCost.available, false);

  const withWage = job({ labor: [], wageColumnsPresent: true, parts: [] });
  assert.equal(withWage.laborCost.amount, 0);
  assert.equal(withWage.partsCost.amount, 0);
  assert.equal(withWage.totalCost.amount, 0);
});

test('hourly_rate and labor_cost price the job; the estimate rate does not', () => {
  const rated = job({
    wageColumnsPresent: true,
    labor: [
      { id: 'l1', ticket_id: 't1', duration_minutes: 60, hourly_rate: 100 },
      { id: 'l2', ticket_id: 't1', duration_minutes: 30, hourly_rate: 100 },
    ],
    parts: [{ id: 'p1', ticket_id: 't1', quantity: 2, unit_cost: 40 }],
    invoices: [{ id: 'i1', estimate_id: 'e1', status: 'sent', total: 500, invoice_number: 'INV-9' }],
  });
  assert.equal(rated.laborHours.hours, 1.5);
  assert.equal(rated.laborCost.amount, 150);
  assert.equal(rated.partsCost.amount, 80);
  assert.equal(rated.totalCost.amount, 230);
  assert.equal(rated.revenue.amount, 500);
  assert.equal(rated.revenue.basis, 'invoice');
  assert.equal(rated.margin.amount, 270);
  assert.equal(rated.quotedLabor.amount, 200);

  const explicit = job({
    wageColumnsPresent: true,
    labor: [{ id: 'l1', ticket_id: 't1', duration_minutes: 60, hourly_rate: 100, labor_cost: 40 }],
  });
  assert.equal(explicit.laborCost.amount, 40);

  const gap = job({
    wageColumnsPresent: true,
    labor: [
      { id: 'l1', ticket_id: 't1', duration_minutes: 60, hourly_rate: 100, labor_cost: 40 },
      { id: 'l2', ticket_id: 't1', duration_minutes: 30, hourly_rate: null, labor_cost: null },
    ],
  });
  assert.equal(gap.laborCost.available, false);
  assert.equal(gap.laborCost.amount, null);
});

test('revenue uses an issued linked invoice, otherwise one linked estimate', () => {
  const invoice = job({
    invoices: [{ id: 'i1', estimate_id: 'e1', status: 'paid', total: 250, invoice_number: 'INV-1' }],
  });
  assert.equal(invoice.revenue.amount, 250);
  assert.equal(invoice.revenue.basis, 'invoice');

  const draft = job({
    invoices: [{ id: 'i1', estimate_id: 'e1', status: 'draft', total: 999, invoice_number: 'INV-D' }],
  });
  assert.equal(draft.revenue.amount, 500);
  assert.equal(draft.revenue.basis, 'estimate');

  const voided = job({
    invoices: [{ id: 'i1', estimate_id: 'e1', status: 'void', total: 999 }],
  });
  assert.equal(voided.revenue.basis, 'estimate');

  const summed = job({
    invoices: [
      { id: 'i1', estimate_id: 'e1', status: 'partially_paid', total: 100, invoice_number: 'INV-1' },
      { id: 'i2', estimate_id: 'e1', status: 'overdue', total: 40, invoice_number: 'INV-2' },
    ],
  });
  assert.equal(summed.revenue.amount, 140);

  const blankTotal = job({
    invoices: [
      { id: 'i1', estimate_id: 'e1', status: 'sent', total: 100 },
      { id: 'i2', estimate_id: 'e1', status: 'sent', total: null },
    ],
  });
  assert.equal(blankTotal.revenue.available, false);

  const byName = job({
    invoices: [
      {
        id: 'i1',
        estimate_id: 'other',
        status: 'paid',
        total: 999,
        customer_name: 'Ada Clinic',
        invoice_number: 'INV-X',
      },
    ],
  });
  assert.equal(byName.revenue.amount, 500);
  assert.equal(byName.revenue.basis, 'estimate');
});

test('repair orders link through estimate id, approved ticket id, and ticket number', () => {
  const byTicketEstimate = job({
    tickets: [{ id: 't1', ticket_number: 'RO-1', customer_name: 'Ada', estimate_id: 'e1' }],
    estimates: [{ id: 'e1', total: 80, estimate_number: 'EST-1', estimate_data: { labor: 10 } }],
  });
  assert.equal(byTicketEstimate.revenue.amount, 80);

  const byApprovedId = job({
    tickets: [{ id: 't9', ticket_number: 'RO-9', customer_name: 'Ada' }],
    estimates: [{ id: 'e9', total: 70, approved_ticket_id: 't9', estimate_data: { labor: 5 } }],
  });
  assert.equal(byApprovedId.revenue.amount, 70);

  const byDataId = job({
    tickets: [{ id: 't8', ticket_number: 'RO-8' }],
    estimates: [{ id: 'e8', total: 60, estimate_data: { approved_ticket_id: 't8', labor: 4 } }],
  });
  assert.equal(byDataId.revenue.amount, 60);

  const byNumber = job({
    tickets: [{ id: 't7', ticket_number: 'RO-7' }],
    estimates: [{ id: 'e7', total: 55, approved_ticket_number: 'RO-7', estimate_data: { labor: 3 } }],
  });
  assert.equal(byNumber.revenue.amount, 55);

  const twoQuotes = job({
    tickets: [{ id: 't1', ticket_number: 'RO-1' }],
    estimates: [
      { id: 'e1', total: 10, approved_ticket_id: 't1', estimate_data: { labor: 1 } },
      { id: 'e2', total: 20, approved_ticket_id: 't1', estimate_data: { labor: 2 } },
    ],
    invoices: [],
  });
  assert.equal(twoQuotes.revenue.available, false);
  assert.equal(twoQuotes.quotedLabor.amount, 3);
});

test('a failed repair-order read does not become zero jobs', () => {
  const report = assembleJobCostReport(
    input({ tickets: null, ticketIssue: 'service_tickets could not be read' })
  );
  assert.equal(report.ticketCount, null);
  assert.equal(report.jobs.length, 0);
  assert.equal(report.rollups.revenue.available, false);
  assert.equal(report.rollups.partsCost.amount, null);
});

test('shop totals stay unavailable when any repair order is missing that figure', () => {
  const report = assembleJobCostReport(
    input({
      wageColumnsPresent: true,
      tickets: [
        { id: 't1', ticket_number: 'RO-1', estimate_id: 'e1', service_date: '2026-03-02' },
        { id: 't2', ticket_number: 'RO-2', service_date: '2026-03-01' },
      ],
      labor: [{ id: 'l1', ticket_id: 't1', duration_minutes: 60, hourly_rate: 100 }],
      parts: [
        { id: 'p1', ticket_id: 't1', quantity: 1, unit_cost: 10 },
        { id: 'p2', ticket_id: 't2', quantity: 1, unit_cost: null },
      ],
      estimates: [
        { id: 'e1', total: 300, estimate_data: { labor: 50 } },
        { id: 'e2', total: 40, approved_ticket_id: 't2', estimate_data: {} },
      ],
    })
  );
  assert.equal(report.jobs[0].ticketNumber, 'RO-1');
  assert.equal(report.jobs[0].margin.amount, 190);
  assert.equal(report.jobs[1].laborCost.amount, 0);
  assert.equal(report.jobs[1].quotedLabor.available, false);
  assert.equal(report.rollups.laborHours.available, true);
  assert.equal(report.rollups.margin.available, false);
});

test('loader retries when hourly_rate is missing and scopes labor by ticket id', async () => {
  const calls: string[] = [];
  const client: JobCostClient = {
    from(table: string): JobCostQuery {
      const state = { columns: '', eq: '', inn: '' };
      const query: JobCostQuery = {
        select(columns) {
          state.columns = columns;
          return query;
        },
        eq(column, value) {
          state.eq = `${column}=${value}`;
          return query;
        },
        in(column, values) {
          state.inn = `${column} in ${values.join(',')}`;
          return query;
        },
        order() {
          return query;
        },
        async range() {
          calls.push(`${table} [${state.columns}] ${state.eq}${state.inn}`);
          if (table === 'service_tickets') {
            return { data: [{ id: 't1', ticket_number: 'RO-1', organization_id: 7 }], error: null };
          }
          if (table === 'labor_log' && state.columns.includes('hourly_rate')) {
            return { data: null, error: { message: 'column labor_log.hourly_rate does not exist' } };
          }
          if (table === 'labor_log') {
            assert.match(state.inn, /ticket_id in t1/);
            assert.equal(state.eq, '');
            return {
              data: [{ id: 'l1', ticket_id: 't1', duration_minutes: 90 }],
              error: null,
            };
          }
          if (table === 'parts_used') return { data: [], error: null };
          return { data: [], error: null };
        },
      };
      return query;
    },
  };

  const sources = await loadJobCostSources(client, 7);
  assert.equal(sources.wageColumnsPresent, false);
  assert.equal(sources.laborIssue, null);
  assert.equal(sources.labor?.[0]?.duration_minutes, 90);
  assert.equal(calls.some((call) => call.startsWith('labor_log') && call.includes('hourly_rate')), true);
  assert.equal(calls.some((call) => call.includes('organization_id') && call.startsWith('labor_log')), false);
});

test('job costing is gated in the business nav and not in service reports', () => {
  const header = read('components/Header.tsx');
  const hub = read('app/hub/page.tsx');
  const home = read('components/home/HomeDashboard.tsx');
  const access = read('lib/job-costing-access.ts');
  const server = read('lib/job-costing-server.ts');
  const page = read('app/business/job-costing/page.tsx');
  const route = read('app/api/business/job-costing/route.ts');
  const load = read('lib/job-costing-load.ts');
  const session = read('lib/auth-session.ts');

  assert.match(header, /jobCostingNavLink/);
  assert.match(access, /\/business\/job-costing/);
  assert.doesNotMatch(header, /larrysmart@gmail.com/);
  assert.match(hub, /canAccessJobCosting/);
  assert.match(home, /canAccessJobCosting/);
  assert.match(home, /\/business\/job-costing/);
  assert.doesNotMatch(access, /from '\.\/god/);
  assert.match(server, /email: user\.email/);
  assert.match(server, /decideJobCostingAccess/);
  assert.doesNotMatch(server, /getSupabaseAdmin/);
  assert.doesNotMatch(page, /service_tickets/);
  assert.doesNotMatch(page, /\.from\(/);
  assert.match(route, /result\.status === 403/);
  assert.match(route, /export function DELETE/);
  assert.match(session, /method: 'DELETE'/);
  assert.doesNotMatch(load, /inventory_transactions/);
  assert.doesNotMatch(load, /sale_price/);
  assert.doesNotMatch(read('lib/job-costing.ts'), /laborRate/);
  assert.doesNotMatch(read('app/reports/page.tsx'), /job-costing/);
  assert.doesNotMatch(read('app/admin/reports/page.tsx'), /job-costing/);
});
