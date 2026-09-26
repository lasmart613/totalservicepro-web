import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addressWithZip,
  catalogManufacturerValue,
  loadTicketReportContext,
  mapTicketServiceType,
  newServiceReportHref,
  reportPrefillFromTicket,
  ticketProblemComments,
} from './ticket-service-report.ts';

const here = dirname(fileURLToPath(import.meta.url));

function chain(rows: any[]) {
  const filters: Array<(row: any) => boolean> = [];
  const builder: any = {
    select() {
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push((row) => String(row?.[column] ?? '') === String(value ?? ''));
      return builder;
    },
    maybeSingle() {
      const found = rows.filter((row) => filters.every((fn) => fn(row)));
      return Promise.resolve({ data: found[0] ?? null, error: null });
    },
    then(onFulfilled: any, onRejected: any) {
      const found = rows.filter((row) => filters.every((fn) => fn(row)));
      return Promise.resolve({ data: found, error: null }).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

function clientFor(tables: Record<string, any[]>, blocked: string[] = []) {
  return {
    from(table: string) {
      if (blocked.includes(table)) {
        throw new Error(`unexpected read of ${table}`);
      }
      return chain(tables[table] || []);
    },
  };
}

test('ticket fields map onto the service report, with site and device filling blanks', () => {
  const prefill = reportPrefillFromTicket({
    ticket: {
      id: 42,
      ticket_number: 'ACME-1042',
      organization_id: 7,
      customer_organization_id: 88,
      customer_name: 'North Clinic',
      customer_address: '10 Main St',
      customer_city: '',
      customer_state: 'CA',
      zip: '',
      customer_phone: '555-0100',
      customer_email: 'desk@north.test',
      equipment_make: 'Candela',
      equipment_model: '',
      serial_number: '',
      equipment_type: 'laser',
      equipment_id: 9,
      service_type: 'Calibration',
      service_date: '2026-09-26T15:00:00',
      description: 'Handpiece error',
      notes: 'Handpiece error',
      assigned_to: '11111111-1111-4111-8111-111111111111',
    },
    customer: {
      id: 88,
      name: 'North Clinic HQ',
      address: '1 HQ Way',
      city: 'Oakland',
      state: 'CA',
      zip: '94607',
      phone: '555-0199',
      email: 'hq@north.test',
      contact_name: 'Riley Chen',
    },
    location: {
      id: 3,
      name: 'Surgery suite',
      address: '500 Site Rd',
      city: 'Berkeley',
      state: 'CA',
      zip: '94704',
      phone: '555-0177',
      contact_name: 'Site Lead',
    },
    equipment: {
      id: 9,
      manufacturer: 'Other Make',
      model: 'GentleMax Pro',
      serial_number: 'SN-9',
    },
    assignee: { first_name: 'Ada', last_name: 'Lovelace', email: 'ada@shop.test' },
  });

  assert.ok(prefill);
  assert.equal(prefill.ticketId, '42');
  assert.equal(prefill.ticketNumber, 'ACME-1042');
  assert.equal(prefill.customerOrganizationId, 88);
  assert.equal(prefill.customerName, 'North Clinic');
  assert.equal(prefill.customerAddress, '10 Main St, 94704');
  assert.equal(prefill.customerCity, 'Berkeley');
  assert.equal(prefill.customerState, 'CA');
  assert.equal(prefill.customerPhone, '555-0100');
  assert.equal(prefill.customerEmail, 'desk@north.test');
  assert.equal(prefill.customerContactName, 'Site Lead');
  assert.equal(prefill.equipmentMake, 'Candela');
  assert.equal(prefill.equipmentModel, 'GentleMax Pro');
  assert.equal(prefill.equipmentName, 'Candela GentleMax Pro');
  assert.equal(prefill.serialNumber, 'SN-9');
  assert.equal(prefill.equipmentId, 9);
  assert.equal(prefill.equipmentType, 'laser');
  assert.equal(prefill.serviceType, 'Cal');
  assert.equal(prefill.dateOut, '2026-09-26');
  assert.equal(prefill.serviceEngineer, 'Ada Lovelace');
  assert.equal(prefill.comments, 'Handpiece error');
});

test('problem text keeps distinct notes and does not repeat the zip', () => {
  assert.equal(ticketProblemComments('No fire', 'Checked fiber'), 'No fire\n\nChecked fiber');
  assert.equal(ticketProblemComments('Same', 'Same'), 'Same');
  assert.equal(addressWithZip('10 Main St, 94704', '94704'), '10 Main St, 94704');
  assert.equal(mapTicketServiceType('PM'), 'PM');
  assert.equal(mapTicketServiceType('Repair'), 'Repair');
  assert.equal(mapTicketServiceType('Training'), 'Training');
  assert.equal(mapTicketServiceType(''), '');
  assert.equal(newServiceReportHref(42), '/reports/new?ticketId=42');
  assert.equal(reportPrefillFromTicket({ ticket: { id: 'nope' } }), null);
});

test('catalog manufacturer match prefers the exact option id', () => {
  const value = catalogManufacturerValue('Candela', [
    { id: 3, name: 'Cande' },
    { id: 8, name: 'Candela' },
  ]);
  assert.equal(value, '8');
});

test('loader uses linked records and still allows another report when one exists', async () => {
  const supabase = clientFor({
    service_tickets: [
      {
        id: 42,
        organization_id: 7,
        ticket_number: 'ACME-1042',
        customer_name: 'North Clinic',
        customer_organization_id: 88,
        customer_location_id: 3,
        equipment_id: 9,
        equipment_make: '',
        equipment_model: '',
        serial_number: '',
        service_type: 'Repair',
        service_date: '2026-09-01',
        description: 'No output',
        notes: 'Interlock lamp',
        assigned_to: '11111111-1111-4111-8111-111111111111',
      },
    ],
    organizations: [
      {
        id: 88,
        name: 'North Clinic',
        address: '1 HQ Way',
        city: 'Oakland',
        state: 'CA',
        zip: '94607',
        phone: '555-0199',
        email: 'hq@north.test',
        contact_name: 'Riley Chen',
      },
    ],
    locations: [
      {
        id: 3,
        organization_id: 88,
        name: 'Surgery suite',
        address: '500 Site Rd',
        city: 'Berkeley',
        state: 'CA',
        zip: '94704',
        phone: '555-0177',
        contact_name: 'Site Lead',
      },
    ],
    equipment: [
      {
        id: 9,
        manufacturer: 'Candela',
        model: 'GentleMax Pro',
        serial_number: 'SN-9',
        customer_organization_id: 88,
      },
    ],
    user_profiles: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'ada@shop.test',
      },
    ],
    service_reports: [
      {
        id: 'rep-1',
        report_number: 'ACME-SR-1',
        status: 'draft',
        ticket_id: '42',
        ticket_number: 'ACME-1042',
        organization_id: 7,
      },
      {
        id: 'rep-1',
        report_number: 'ACME-SR-1',
        status: 'draft',
        ticket_id: '42',
        ticket_number: 'ACME-1042',
        organization_id: 7,
      },
    ],
  });

  const ctx = await loadTicketReportContext(supabase, '42', { organizationId: 7 });
  assert.ok(ctx);
  assert.equal(ctx.prefill.customerAddress, '500 Site Rd, 94704');
  assert.equal(ctx.prefill.customerCity, 'Berkeley');
  assert.equal(ctx.prefill.equipmentMake, 'Candela');
  assert.equal(ctx.prefill.equipmentModel, 'GentleMax Pro');
  assert.equal(ctx.prefill.serialNumber, 'SN-9');
  assert.equal(ctx.prefill.serviceEngineer, 'Ada Lovelace');
  assert.equal(ctx.prefill.serviceType, 'Repair');
  assert.equal(ctx.prefill.comments, 'No output\n\nInterlock lamp');
  assert.equal(ctx.existingReports.length, 1);
  assert.equal(ctx.existingReports[0].reportNumber, 'ACME-SR-1');
});

test('loader ignores a ticket that belongs to another shop', async () => {
  const supabase = clientFor(
    {
      service_tickets: [
        { id: 5, organization_id: 2, customer_name: 'Other shop', ticket_number: 'X-1' },
      ],
    },
    ['organizations', 'locations', 'sites', 'equipment', 'user_profiles', 'service_reports']
  );
  const ctx = await loadTicketReportContext(supabase, 5, { organizationId: 1 });
  assert.equal(ctx, null);
  assert.equal(await loadTicketReportContext(supabase, 'abc', { organizationId: 1 }), null);
});

test('schedule ticket view shows Create Service Report for report writers', () => {
  const page = readFileSync(join(here, '../app/service-tickets/[id]/page.tsx'), 'utf8');
  const actions = readFileSync(join(here, '../components/CreateServiceReportActions.tsx'), 'utf8');
  const form = readFileSync(join(here, '../app/reports/new/NewServiceReportClient.tsx'), 'utf8');

  assert.match(page, /canCreateServiceReports/);
  assert.match(page, /CreateServiceReportActions/);
  assert.match(page, /listReportsForTicket/);
  assert.match(actions, /Create Service Report/);
  assert.match(actions, /newServiceReportHref/);
  assert.match(actions, /data-testid="create-service-report"/);
  assert.match(actions, /sm:hidden/);
  assert.match(actions, /w-full/);
  assert.match(actions, /hidden w-full[\s\S]*sm:flex/);
  assert.match(form, /loadTicketReportContext/);
  assert.match(form, /ticketId/);
  assert.match(form, /ticket_id: linkedTicketId/);
  assert.match(form, /This form starts a new one/);
});
