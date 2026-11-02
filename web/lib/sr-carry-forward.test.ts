import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  commentsWithPending,
  loadPendingFromLastVisit,
  pendingLine,
  pickPendingFromRows,
} from './sr-carry-forward.ts';
import { commentsWithArrival } from './ticket-checkin.ts';
import { buildServiceReportPrintHTML } from './service-report-print.ts';
import { APP_STRING_KEYS, appStrings } from './i18n/app-copy.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');

/** Minimal PostgREST-like fake that records filters and returns rows matching every eq. */
function fakeClient(rows: Record<string, unknown>[], opts: { error?: any } = {}) {
  const calls: Array<Record<string, string>> = [];
  return {
    calls,
    from(table: string) {
      assert.equal(table, 'service_reports');
      return {
        select(_cols: string) {
          const eqs: Record<string, string> = {};
          const q: any = {
            eq(col: string, val: unknown) {
              eqs[col] = String(val);
              return q;
            },
            order() {
              return q;
            },
            limit() {
              calls.push({ ...eqs });
              if (opts.error) return Promise.resolve({ data: null, error: opts.error });
              return Promise.resolve({
                data: rows.filter((r) => Object.entries(eqs).every(([k, v]) => String(r[k] ?? '') === v)),
                error: null,
              });
            },
          };
          return q;
        },
      };
    },
  };
}

const ROWS = [
  { id: 'a', organization_id: 2655, equipment_id: 10, serial_number: 'SN1', date_out: '2026-09-01', created_at: '2026-09-01T10:00:00Z', pending_issues: 'Old item' },
  { id: 'b', organization_id: 2655, equipment_id: 10, serial_number: 'SN1', date_out: '2026-10-15', created_at: '2026-10-15T10:00:00Z', pending_issues: 'Replace fan filter', report_number: 'SR-7' },
  { id: 'x', organization_id: 9999, equipment_id: 10, serial_number: 'SN1', date_out: '2026-11-01', created_at: '2026-11-01T10:00:00Z', pending_issues: 'OTHER ORG SECRET' },
];

test('picks the most recent prior report in the same org', () => {
  const p = pickPendingFromRows(ROWS, { organizationId: 2655 });
  assert.equal(p?.reportId, 'b');
  assert.equal(p?.date, '2026-10-15');
  assert.equal(p?.pendingIssues, 'Replace fan filter');
  assert.equal(p?.reportNumber, 'SR-7');
});

test('never returns another org even if RLS let the row through', () => {
  const p = pickPendingFromRows(ROWS, { organizationId: 9999 });
  assert.equal(p?.reportId, 'x');
  assert.equal(pickPendingFromRows(ROWS, { organizationId: 1 }), null);
  assert.equal(pickPendingFromRows(ROWS, { organizationId: '' }), null);
});

test('latest report with blank pending means resolved: nothing carried', () => {
  const rows = [...ROWS, { id: 'c', organization_id: 2655, equipment_id: 10, date_out: '2026-10-20', pending_issues: '  ' }];
  assert.equal(pickPendingFromRows(rows, { organizationId: 2655 }), null);
});

test('excludes the current ticket and its own reports', () => {
  const rows = [...ROWS, { id: 'c', organization_id: 2655, equipment_id: 10, date_out: '2026-10-20', ticket_number: 'T-5', pending_issues: 'mine' }];
  assert.equal(pickPendingFromRows(rows, { organizationId: 2655, excludeTicketNumber: 'T-5' })?.reportId, 'b');
  assert.equal(pickPendingFromRows(rows, { organizationId: 2655, excludeReportIds: ['c'] })?.reportId, 'b');
});

test('loader scopes by org and equipment_id, falls back to serial', async () => {
  const c1 = fakeClient(ROWS);
  const p1 = await loadPendingFromLastVisit(c1, { organizationId: 2655, equipmentId: 10 });
  assert.equal(p1?.reportId, 'b');
  assert.deepEqual(c1.calls, [{ organization_id: '2655', equipment_id: '10' }]);

  const c2 = fakeClient(ROWS);
  const p2 = await loadPendingFromLastVisit(c2, { organizationId: 2655, equipmentId: 77, serialNumber: 'SN1' });
  assert.equal(p2?.reportId, 'b');
  assert.deepEqual(c2.calls[1], { organization_id: '2655', serial_number: 'SN1' });

  assert.equal(await loadPendingFromLastVisit(fakeClient(ROWS), { organizationId: null, equipmentId: 10 }), null);
});

test('loader returns null when 000949 is not applied', async () => {
  const c = fakeClient(ROWS, { error: { code: '42703', message: 'column service_reports.pending_issues does not exist' } });
  assert.equal(await loadPendingFromLastVisit(c, { organizationId: 2655, equipmentId: 10, serialNumber: 'SN1' }), null);
});

test('comments prefill: arrival, then pending, then description; idempotent', () => {
  const p = { reportId: 'b', reportNumber: null, date: '2026-10-15', pendingIssues: 'Replace fan filter' };
  assert.equal(pendingLine(p), 'Pending from last visit (2026-10-15): Replace fan filter');
  const withPending = commentsWithPending('No lasing', p);
  assert.equal(withPending, 'Pending from last visit (2026-10-15): Replace fan filter\n\nNo lasing');
  assert.equal(commentsWithPending(withPending, p), withPending);
  assert.equal(commentsWithPending('x', null), 'x');
  const full = commentsWithArrival(withPending, '11/2/2026, 1:05 PM MST');
  assert.ok(full.startsWith('Arrival: 11/2/2026, 1:05 PM MST\n\nPending from last visit'));
});

test('print / email HTML includes both fields only when present', () => {
  const base = { report_number: 'SR-1', comments: 'c' } as any;
  const html = buildServiceReportPrintHTML({ ...base, work_performed: 'Swapped <PSU>', pending_issues: 'Watch fan' });
  assert.match(html, /data-sr-field="work_performed"/);
  assert.match(html, /Swapped &lt;PSU&gt;/);
  assert.match(html, /Pending Issues \/ Watch Items to be Addressed on Next Visit/);
  assert.match(html, /Watch fan/);
  const none = buildServiceReportPrintHTML(base);
  assert.doesNotMatch(none, /data-sr-field=/);
  const es = buildServiceReportPrintHTML({ ...base, work_performed: 'w', locale: 'es' });
  assert.match(es, /Trabajo realizado/);
});

test('i18n keys exist in all 8 locales', () => {
  const keys = [
    'Work Performed',
    'Pending Issues / Watch Items to be Addressed on Next Visit',
    'Describe the work performed on this visit...',
    'Items to check or fix on the next visit...',
    'Pending from last visit ({date})',
    'Pending from last visit',
    'View report',
  ];
  for (const key of keys) assert.ok(APP_STRING_KEYS.includes(key), key);
  for (const loc of ['fa', 'es', 'fr', 'he', 'it', 'de', 'pt', 'ar'] as const) {
    const table = appStrings(loc);
    for (const key of keys) assert.ok(table[key]?.trim(), `${loc}:${key}`);
    assert.ok(table['Pending from last visit ({date})'].includes('{date}'), loc);
  }
});

test('form, view, ticket and migration are wired', () => {
  const form = read('app/reports/new/NewServiceReportClient.tsx');
  assert.match(form, /work_performed: workPerformed/);
  assert.match(form, /pending_issues: pendingIssues/);
  assert.match(form, /commentsWithPending\(prefill\.comments, ctx\.pendingFromLastVisit\)/);
  const commentsAt = form.indexOf('Comments / Parts Needed');
  assert.ok(commentsAt > 0 && form.indexOf('sr-work-performed') > commentsAt);
  assert.ok(form.indexOf('sr-pending-issues') > form.indexOf('sr-work-performed'));
  const view = read('app/reports/[id]/page.tsx');
  assert.match(view, /report\.work_performed/);
  assert.match(view, /report\.pending_issues/);
  const ticket = read('app/service-tickets/[id]/page.tsx');
  assert.match(ticket, /data-testid="ticket-pending-from-last"/);
  assert.match(ticket, /organizationId: normalized\.organization_id/);
  const sql = read('supabase/migrations/20261102_000949_service_report_work_pending.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS work_performed text/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS pending_issues text/);
  assert.doesNotMatch(sql, /NOT NULL|UPDATE |DELETE /i);
});
