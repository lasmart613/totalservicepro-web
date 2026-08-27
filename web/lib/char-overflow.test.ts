import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  charLimitFromError,
  injectShortDefaults,
  insertOmittingCharOverflow,
  shortTicketPrefix,
  stripOverflowingAddressFields,
} from './char-overflow.ts';

const CHAR3 = { message: 'value too long for type character(3)', code: '22001' };

function mockInsertClient(script: Array<{ error?: typeof CHAR3 | { message: string } | null; data?: any }>) {
  let i = 0;
  const seen: Record<string, unknown>[] = [];
  return {
    seen,
    from() {
      const builder: any = {
        insert(row: Record<string, unknown>) {
          seen.push({ ...row });
          return builder;
        },
        select() {
          return builder;
        },
        single() {
          return builder;
        },
        then(resolve: (v: any) => void, reject?: (e: any) => void) {
          const step = script[Math.min(i, script.length - 1)];
          i += 1;
          const result = step.error
            ? { data: null, error: step.error }
            : { data: step.data ?? { id: 99, ticket_number: 'X-TKT-1' }, error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

test('shortTicketPrefix is always 3 letters', () => {
  assert.equal(shortTicketPrefix('Northshore Clinic'), 'NOR');
  assert.equal(shortTicketPrefix('A'), 'A');
  assert.equal(shortTicketPrefix(''), 'CUS');
});

test('22001 without a typed limit still defaults to character(3)', () => {
  assert.equal(charLimitFromError({ code: '22001', message: 'new row violates' }), 3);
  assert.equal(charLimitFromError('value too long for type character(3)'), 3);
});

test('ticket CHAR(3) shortens Medium/Scheduled/Repair then omits city and UUID', () => {
  const payload: Record<string, unknown> = {
    ticket_number: 'LPX-TKT-20260827-01',
    customer_name: 'Orange Medical Spa',
    organization_id: 12,
    customer_organization_id: 44,
    priority: 'Medium',
    status: 'Scheduled',
    service_type: 'Repair',
    customer_city: 'Orange',
    customer_state: 'CA',
    assigned_to: '11111111-1111-1111-1111-111111111111',
    customer_phone: '714-555-0100',
  };
  assert.equal(stripOverflowingAddressFields(payload, 3), 'assigned_to');
  assert.equal(payload.assigned_to, undefined);
  assert.equal(stripOverflowingAddressFields(payload, 3), 'customer_phone');
  assert.equal(stripOverflowingAddressFields(payload, 3), 'customer_city');
  assert.equal(payload.customer_city, undefined);
  assert.equal(stripOverflowingAddressFields(payload, 3), 'priority');
  assert.equal(payload.priority, 'Med');
  assert.equal(stripOverflowingAddressFields(payload, 3), 'status');
  assert.equal(payload.status, 'Sch');
  assert.equal(stripOverflowingAddressFields(payload, 3), 'service_type');
  assert.equal(payload.service_type, 'Rpr');
  assert.equal(payload.ticket_number, 'LPX-TKT-20260827-01');
  assert.equal(payload.customer_name, 'Orange Medical Spa');
  assert.equal(payload.customer_state, 'CA');
});

test('injectShortDefaults fills ticket_prefix and USA when payload already fits', () => {
  const payload: Record<string, unknown> = { name: 'Orange Medical Spa' };
  assert.equal(injectShortDefaults(payload), 'ticket_prefix');
  assert.equal(payload.ticket_prefix, 'ORA');
  assert.equal(injectShortDefaults(payload), 'country');
  assert.equal(payload.country, 'USA');
});

test('insertOmittingCharOverflow retries ticket insert until CHAR(3) fields are gone', async () => {
  const client = mockInsertClient([
    { error: CHAR3 },
    { error: CHAR3 },
    { error: CHAR3 },
    { error: CHAR3 },
    { data: { id: 7, ticket_number: 'LPX-TKT-1' } },
  ]);
  const payload: Record<string, unknown> = {
    ticket_number: 'LPX-TKT-1',
    customer_name: 'Clinic',
    organization_id: 1,
    priority: 'Medium',
    status: 'Scheduled',
    service_type: 'Repair',
    customer_city: 'Orange',
    assigned_to: '11111111-1111-1111-1111-111111111111',
  };
  const { data, error } = await insertOmittingCharOverflow(client as any, 'service_tickets', payload, {
    select: 'id, ticket_number',
  });
  assert.equal(error, null);
  assert.equal(data.id, 7);
  assert.equal(payload.assigned_to, undefined);
  assert.ok(['Med', undefined].includes(payload.priority as string | undefined));
  assert.ok(client.seen.length >= 2);
});

test('insertOmittingCharOverflow injects USA when only name remains and 22001 continues', async () => {
  const client = mockInsertClient([
    { error: CHAR3 },
    { data: { id: 3 } },
  ]);
  const payload: Record<string, unknown> = { name: 'Clinic' };
  const { error } = await insertOmittingCharOverflow(client as any, 'organizations', payload, {
    select: 'id',
  });
  assert.equal(error, null);
  assert.equal(payload.ticket_prefix, 'CLI');
  assert.ok(client.seen.some((row) => row.ticket_prefix === 'CLI'));
});

test('Add Service Ticket submit uses omit-and-retry on every write, including tickets', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const schedule = readFileSync(join(here, '../app/service-schedule/page.tsx'), 'utf8');
  const form = readFileSync(join(here, './customer-form.ts'), 'utf8');
  assert.match(schedule, /insertOmittingCharOverflow/);
  assert.match(schedule, /service_tickets/);
  assert.match(form, /insertOmittingCharOverflow\(supabase, 'organizations'/);
  assert.match(form, /insertOmittingCharOverflow\(\s*supabase,\s*'organization_customers'/);
  assert.match(form, /ticket_prefix: shortTicketPrefix/);
  assert.match(form, /country: region\.country/);
  assert.doesNotMatch(schedule, /from\('service_tickets'\)\s*\n\s*\.insert\(\[payload\]\)/);
});
