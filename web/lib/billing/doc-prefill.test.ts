import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addDaysIso,
  addMonthsIso,
  billingPrefill,
  estimateFromTicketHref,
  fillIfEmpty,
  invoiceFromReportHref,
  invoiceFromTicketHref,
  laborHoursFromTimes,
  loadBillingPrefill,
  netDueDate,
  nextPmDue,
  pulseCountFromParams,
} from './doc-prefill.ts';
import { signedDateInputValue, signedNowLocal } from '../sr-form-prefill.ts';
import { APP_STRING_KEYS } from '../i18n/app-copy.ts';

test('Net 30 due date crosses months and years', () => {
  assert.equal(netDueDate('2026-11-04'), '2026-12-04');
  assert.equal(netDueDate('2026-12-15'), '2027-01-14');
  assert.equal(netDueDate('2028-02-01'), '2028-03-02');
  assert.equal(netDueDate(''), '');
  assert.equal(addDaysIso('2026-01-31', 1), '2026-02-01');
});

test('Next PM due = date out + 12 months by default, clamps month end', () => {
  assert.equal(nextPmDue('2026-11-04'), '2027-11-04');
  assert.equal(nextPmDue('2026-11-04', 6), '2027-05-04');
  assert.equal(nextPmDue('2028-02-29'), '2029-02-28');
  assert.equal(addMonthsIso('2026-01-31', 1), '2026-02-28');
  assert.equal(nextPmDue(''), '');
  assert.equal(nextPmDue('2026-11-04', 0), '2027-11-04');
});

test('labor hours from arrival/departure round up to quarter hour', () => {
  assert.equal(laborHoursFromTimes('2026-11-04T16:00:00Z', '2026-11-04T18:05:00Z'), 2.25);
  assert.equal(laborHoursFromTimes('2026-11-04T16:00:00Z', '2026-11-04T17:00:00Z'), 1);
  assert.equal(laborHoursFromTimes('2026-11-04T16:00:00Z', null), null);
  assert.equal(laborHoursFromTimes('2026-11-04T18:00:00Z', '2026-11-04T16:00:00Z'), null);
});

test('pulse count picks the counter, not pulse mode/width', () => {
  assert.equal(pulseCountFromParams({ pulse_mode: 'CW', pulse_count: '1,234,567' }), '1,234,567');
  assert.equal(pulseCountFromParams({ shots: '9000' }), '9000');
  assert.equal(pulseCountFromParams({ pulse_width: '10' }), '');
  assert.equal(pulseCountFromParams(null), '');
});

const ticketPrefill: any = {
  ticketId: '42',
  ticketNumber: 'T-42',
  customerOrganizationId: 2639,
  customerName: 'QA Clinic',
  customerAddress: '1 Main St',
  customerCity: 'Austin',
  customerState: 'TX',
  customerPhone: '555',
  customerEmail: 'qa@example.com',
  customerContactName: 'Dr QA',
  customerWebsite: 'https://qa.example',
  equipmentMake: 'Lumenis',
  equipmentModel: 'UltraPulse Encore',
  equipmentType: 'laser',
  serialNumber: 'SN1',
  comments: 'Low power on CW',
};

test('billing prefill: report work performed wins for invoice description', () => {
  const p = billingPrefill({
    ticket: ticketPrefill,
    ticketRow: { arrival_time: '2026-11-04T16:00:00Z', departure_time: '2026-11-04T18:00:00Z' },
    report: { id: 'r1', report_number: 'SR-1', work_performed: 'Replaced tube', serial_number: 'SN2', model_parameters: { pulse_count: '100' } },
  })!;
  assert.equal(p.description, 'Replaced tube');
  assert.equal(p.serialNumber, 'SN2');
  assert.equal(p.pulseCount, '100');
  assert.equal(p.customerName, 'QA Clinic');
  assert.equal(p.equipmentModel, 'UltraPulse Encore');
  assert.deepEqual(p.laborLines, [{ description: 'Labor (2 hrs)', qty: 2, unit_price: 0 }]);
  assert.equal(p.issue, 'Low power on CW');
});

test('estimate issue falls back to last report pending issues', () => {
  const p = billingPrefill({ ticket: { ...ticketPrefill, comments: '' }, pendingIssues: 'Check shutter' })!;
  assert.equal(p.issue, 'Check shutter');
  assert.equal(p.description, '');
  assert.deepEqual(p.laborLines, []);
  assert.equal(billingPrefill({}), null);
});

test('fillIfEmpty never overwrites typed values', () => {
  assert.equal(fillIfEmpty('typed', 'prefill'), 'typed');
  assert.equal(fillIfEmpty('', 'prefill'), 'prefill');
  assert.equal(fillIfEmpty('  ', 'prefill'), 'prefill');
});

test('hrefs are client links with encoded ids', () => {
  assert.equal(invoiceFromTicketHref(42), '/invoices/new?ticketId=42');
  assert.equal(invoiceFromReportHref('a b'), '/invoices/new?reportId=a%20b');
  assert.equal(estimateFromTicketHref('7'), '/estimates/new?ticketId=7');
});

function fakeClient(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push([c, v]), q),
        limit: () => q,
        maybeSingle: async () => ({
          data: (tables[table] || []).find((r) => filters.every(([c, v]) => String(r[c]) === String(v))) ?? null,
          error: null,
        }),
        then: (res: any) =>
          res({ data: (tables[table] || []).filter((r) => filters.every(([c, v]) => String(r[c]) === String(v))), error: null }),
      };
      return q;
    },
  } as any;
}

test('loadBillingPrefill rejects a report from another shop', async () => {
  const client = fakeClient({ service_reports: [{ id: 'r9', organization_id: 5509, work_performed: 'x' }] });
  assert.equal(await loadBillingPrefill(client, { reportId: 'r9', organizationId: 2639 }), null);
});

test('loadBillingPrefill from a report alone fills customer and description', async () => {
  const client = fakeClient({
    service_reports: [
      { id: 'r1', organization_id: 2639, customer_name: 'QA Clinic', work_performed: 'Aligned beam', equipment_name: 'Aura KTP' },
    ],
  });
  const p = await loadBillingPrefill(client, { reportId: 'r1', organizationId: 2639 });
  assert.equal(p?.customerName, 'QA Clinic');
  assert.equal(p?.description, 'Aligned beam');
  assert.equal(p?.equipmentModel, 'Aura KTP');
});

test('signature date helpers', () => {
  const v = signedNowLocal({ stored: 'America/Los_Angeles' }, new Date(2026, 10, 4, 9, 5));
  assert.match(v, /^\d{4}-\d{2}-\d{2}T09:05$/);
  assert.equal(signedDateInputValue('2026-11-04'), '2026-11-04T00:00');
  assert.equal(signedDateInputValue('2026-11-04T10:30:00Z'), '2026-11-04T10:30');
  assert.equal(signedDateInputValue(null), '');
});

test('new labels are translated (es/de/ar)', () => {
  for (const key of ['Create invoice', 'Create estimate', 'Could not load that ticket or report', 'Prefilled from the service ticket / report. Review and save.']) {
    assert.ok((APP_STRING_KEYS as readonly string[]).includes(key), key);
  }
});

test('forms wire the prefill without touching edit loads', () => {
  const inv = readFileSync(new URL('../../app/invoices/new/InvoiceFormClient.tsx', import.meta.url), 'utf8');
  assert.match(inv, /searchParams\.get\('ticketId'\)/);
  assert.match(inv, /searchParams\.get\('reportId'\)/);
  assert.match(inv, /if \(editIdParam \|\| dueDateTouched\.current\) return;/);
  const est = readFileSync(new URL('../../app/estimates/new/EstimateFormClient.tsx', import.meta.url), 'utf8');
  assert.match(est, /else if \(fromTicketParam\)/);
  const sr = readFileSync(new URL('../../app/reports/new/NewServiceReportClient.tsx', import.meta.url), 'utf8');
  assert.match(sr, /setTechSigDate\(\(prev\) => prev \|\| signedNowLocal/);
  assert.match(sr, /if \(editReportId \|\| nextPmTouched\.current \|\| !dateOut\) return;/);
  const ticket = readFileSync(new URL('../../app/service-tickets/[id]/page.tsx', import.meta.url), 'utf8');
  assert.match(ticket, /ticket-create-invoice/);
  assert.match(ticket, /ticket-create-estimate/);
  const report = readFileSync(new URL('../../app/reports/[id]/page.tsx', import.meta.url), 'utf8');
  assert.match(report, /report-create-invoice/);
});
