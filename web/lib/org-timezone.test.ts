import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ORG_TIMEZONE,
  formatDateInTimeZone,
  isoDateInTimeZone,
  orgTodayIso,
  parseOrgTimeZone,
  resolveOrgTimeZone,
  timeZoneFromState,
  ymdInTimeZone,
} from './org-timezone.ts';
import { generateDocNumber, ymdFrom } from './billing/doc-numbers.ts';
import { approveEstimateCreatingUnscheduledRequest } from './billing/approve-estimate.ts';
import { buildInvoiceHtml } from './billing/doc-html.ts';
import { buildOwnedEstimateMessage } from './billing/owned-doc-mail.ts';

const PT_EVENING = new Date('2026-10-06T00:30:00Z');

test('5:30pm Pacific is still October 5 when UTC is already October 6', () => {
  assert.equal(ymdInTimeZone(PT_EVENING, 'America/Los_Angeles'), '20261005');
  assert.equal(isoDateInTimeZone(PT_EVENING, 'America/Los_Angeles'), '2026-10-05');
  assert.equal(isoDateInTimeZone(PT_EVENING, 'UTC'), '2026-10-06');
  assert.equal(formatDateInTimeZone(PT_EVENING, 'America/Los_Angeles', 'en-US'), '10/5/2026');
  assert.equal(formatDateInTimeZone(PT_EVENING, 'UTC', 'en-US'), '10/6/2026');
  assert.equal(ymdFrom(PT_EVENING, 'America/Los_Angeles'), '20261005');
  assert.equal(ymdFrom('2026-10-05', 'UTC'), '20261005');
});

test('timezone resolution prefers the org setting, then state, then the browser, then Los Angeles', () => {
  assert.deepEqual(resolveOrgTimeZone({ stored: 'America/Chicago', state: 'AZ', browserTimeZone: 'Europe/Paris' }), {
    timeZone: 'America/Chicago',
    source: 'organization',
  });
  assert.deepEqual(resolveOrgTimeZone({ stored: 'Not/AZone', state: 'AZ', browserTimeZone: 'Europe/Paris' }), {
    timeZone: 'America/Phoenix',
    source: 'state',
  });
  assert.equal(timeZoneFromState('Arizona'), 'America/Phoenix');
  assert.equal(timeZoneFromState('California'), 'America/Los_Angeles');
  assert.deepEqual(resolveOrgTimeZone({ state: '', browserTimeZone: 'America/Denver' }), {
    timeZone: 'America/Denver',
    source: 'browser',
  });
  assert.deepEqual(resolveOrgTimeZone({ allowBrowser: false, browserTimeZone: 'Europe/Paris' }), {
    timeZone: DEFAULT_ORG_TIMEZONE,
    source: 'default',
  });
  assert.deepEqual(resolveOrgTimeZone(), {
    timeZone: DEFAULT_ORG_TIMEZONE,
    source: 'default',
  });
});

const APPROVAL_INSTANT = new Date('2026-10-06T00:52:00.000Z');

function numberingClient(org: Record<string, unknown> | null) {
  const inserts: { table: string; body: Record<string, unknown> }[] = [];
  function query(table: string) {
    const q: any = {
      select() {
        return q;
      },
      eq() {
        return q;
      },
      ilike() {
        return q;
      },
      order() {
        return q;
      },
      limit() {
        return q;
      },
      insert(body: Record<string, unknown>) {
        inserts.push({ table, body });
        return q;
      },
      update() {
        return q;
      },
      maybeSingle: async () => ({
        data: table === 'organizations' ? org : null,
        error: null,
      }),
      single: async () => ({
        data: { id: 42, ticket_number: inserts.at(-1)?.body?.ticket_number || null },
        error: null,
      }),
    };
    q.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
    return q;
  }
  return { from: query, inserts };
}

test('document numbers use the org date at 5:52pm PT, including approval tickets', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: APPROVAL_INSTANT });
  for (const org of [
    { ticket_prefix: 'QAL', name: 'Quality', timezone: 'America/Los_Angeles', state: 'CA' },
    { ticket_prefix: 'QAL', name: 'Quality', timezone: 'America/Phoenix', state: 'AZ' },
    { ticket_prefix: 'QAL', name: 'Quality', timezone: null, state: 'AZ' },
    { ticket_prefix: 'QAL', name: 'Quality', timezone: null, state: null },
  ]) {
    for (const kind of ['TKT', 'EST', 'INV'] as const) {
      const number = await generateDocNumber(numberingClient(org), {
        orgId: 9,
        kind,
        date: APPROVAL_INSTANT,
      });
      assert.match(number, new RegExp(`^QAL-${kind}-20261005-`));
      assert.doesNotMatch(number, /20261006/);
    }
  }

  const kept = await generateDocNumber(numberingClient({ ticket_prefix: 'QAL', name: 'Quality' }), {
    orgId: 9,
    kind: 'TKT',
    existing: 'QAL-TKT-20261005-02',
    date: APPROVAL_INSTANT,
  });
  assert.equal(kept, 'QAL-TKT-20261005-02');

  const client = numberingClient({
    ticket_prefix: 'QAL',
    name: 'Quality',
    timezone: 'America/Phoenix',
    state: 'AZ',
  });
  const approved = await approveEstimateCreatingUnscheduledRequest(client as never, {
    id: 15,
    organization_id: 9,
    customer_name: 'Clinic',
    estimate_number: 'QAL-EST-20261005-01',
    estimate_data: { model: 'gentlemax_pro' },
  });
  assert.equal(approved.already, false);
  assert.match(String(approved.ticket.ticket_number), /^QAL-TKT-20261005-/);
  assert.doesNotMatch(String(approved.ticket.ticket_number), /20261006/);
});

test('estimate email and invoice PDF dates use the org zone and show GentleMax Pro', () => {
  const estimate = buildOwnedEstimateMessage({
    row: {
      created_at: '2026-10-06T00:52:00.000Z',
      estimate_number: 'QAL-EST-20261005-01',
      customer_name: 'Clinic',
      estimate_data: { model: 'gentlemax_pro' },
    },
    company: { company_name: 'Quality' },
    theme: null,
    timeZone: 'America/Phoenix',
  });
  assert.match(estimate, /10\/5\/2026/);
  assert.doesNotMatch(estimate, /10\/6\/2026/);
  assert.match(estimate, /GentleMax Pro/);
  assert.doesNotMatch(estimate, /gentlemax_pro/);

  const invoice = buildInvoiceHtml({
    company: { company_name: 'Quality' },
    customer: { name: 'Clinic' },
    invNumber: 'QAL-INV-20261005-01',
    invoiceDate: '2026-10-06T00:52:00.000Z',
    description: 'Device: gentlemax_pro',
    lines: [],
    subtotal: 0,
    tax: 0,
    total: 0,
    timeZone: 'America/Los_Angeles',
  });
  assert.match(invoice, /10\/5\/2026/);
  assert.doesNotMatch(invoice, /10\/6\/2026/);
  assert.match(invoice, /GentleMax Pro/);
  assert.doesNotMatch(invoice, /gentlemax_pro/);

  const fallback = buildOwnedEstimateMessage({
    row: {
      created_at: '2026-10-06T00:52:00.000Z',
      estimate_number: 'QAL-EST-20261005-01',
      customer_name: 'Clinic',
      estimate_data: { model: 'gentlemax_pro' },
    },
    company: { company_name: 'Quality' },
    theme: null,
  });
  assert.match(fallback, /10\/5\/2026/);
  assert.match(fallback, /GentleMax Pro/);
});

test('23:30 org time stays on that calendar day when UTC is already the next day', async () => {
  const late = new Date('2026-10-06T06:30:00.000Z');
  assert.equal(isoDateInTimeZone(late, 'UTC'), '2026-10-06');
  assert.equal(orgTodayIso({ stored: 'America/Los_Angeles', now: late }), '2026-10-05');
  assert.equal(orgTodayIso({ stored: 'America/Phoenix', now: late }), '2026-10-05');
  assert.equal(orgTodayIso({ stored: null, state: 'AZ', now: late }), '2026-10-05');
  assert.equal(orgTodayIso({ stored: null, state: null, now: late }), '2026-10-05');
  assert.equal(
    resolveOrgTimeZone({ stored: null, state: 'AZ', browserTimeZone: 'UTC', allowBrowser: false }).timeZone,
    'America/Phoenix'
  );
  assert.equal(
    resolveOrgTimeZone({ stored: null, state: null, browserTimeZone: 'UTC', allowBrowser: false }).timeZone,
    DEFAULT_ORG_TIMEZONE
  );

  for (const org of [
    { ticket_prefix: 'QAL', name: 'Quality', timezone: 'America/Los_Angeles', state: 'CA' },
    { ticket_prefix: 'QAL', name: 'Quality', timezone: null, state: 'AZ' },
    { ticket_prefix: 'QAL', name: 'Quality', timezone: null, state: null },
  ]) {
    const dated = orgTodayIso({
      stored: org.timezone,
      state: org.state,
      now: late,
    });
    assert.equal(dated, '2026-10-05');
    for (const kind of ['INV', 'EST', 'PO'] as const) {
      const fromForm = await generateDocNumber(numberingClient(org), {
        orgId: 9,
        kind,
        date: dated,
      });
      assert.match(fromForm, new RegExp(`^QAL-${kind}-20261005-`));
      const fromInstant = await generateDocNumber(numberingClient(org), {
        orgId: 9,
        kind,
        date: late,
      });
      assert.match(fromInstant, new RegExp(`^QAL-${kind}-20261005-`));
      assert.doesNotMatch(fromInstant, /20261006/);
    }
  }
});

test('timezone setting accepts IANA names and clears on auto', () => {
  assert.deepEqual(parseOrgTimeZone('America/Phoenix'), { ok: true, timezone: 'America/Phoenix' });
  assert.deepEqual(parseOrgTimeZone('auto'), { ok: true, timezone: null });
  assert.deepEqual(parseOrgTimeZone(''), { ok: true, timezone: null });
  const bad = parseOrgTimeZone('Pacific Time');
  assert.equal(bad.ok, false);
});
