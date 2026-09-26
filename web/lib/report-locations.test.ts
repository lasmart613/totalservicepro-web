import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CustomerLocation } from './customer-locations.ts';
import {
  UNASSIGNED_EQUIPMENT_LABEL,
  groupEquipmentForSite,
  loadCustomerEquipment,
  reportLocationControl,
  resetEquipmentLocationProbe,
  reportSiteFields,
  shouldClearEquipmentSelection,
} from './report-locations.ts';
import { reportPrefillFromTicket } from './ticket-service-report.ts';

const here = dirname(fileURLToPath(import.meta.url));

function loc(partial: Partial<CustomerLocation> & Pick<CustomerLocation, 'id' | 'name'>): CustomerLocation {
  return {
    address: null,
    city: null,
    state: null,
    zip: null,
    phone: null,
    contact_name: null,
    is_primary: false,
    ...partial,
  };
}

const main = loc({
  id: 1,
  name: 'Main office',
  address: '1 HQ Way',
  city: 'Oakland',
  state: 'CA',
  zip: '94607',
  phone: '555-0199',
  contact_name: 'Riley Chen',
  is_primary: true,
});

const suite = loc({
  id: 3,
  name: 'Surgery suite',
  address: '500 Site Rd',
  city: 'Berkeley',
  state: 'CA',
  zip: '94704',
  phone: '555-0177',
  contact_name: 'Site Lead',
});

test('multi-location dropdown is shown and enabled', () => {
  const control = reportLocationControl([suite, main]);
  assert.equal(control.shown, true);
  assert.equal(control.disabled, false);
  assert.equal(control.mode, 'multiple');
  assert.equal(control.selectedId, '1');
});

test('single location auto-selects and disables the dropdown', () => {
  const control = reportLocationControl([suite]);
  assert.equal(control.shown, true);
  assert.equal(control.disabled, true);
  assert.equal(control.mode, 'single');
  assert.equal(control.selectedId, '3');
  const fields = reportSiteFields(suite);
  assert.equal(fields.siteName, 'Surgery suite');
  assert.equal(fields.address, '500 Site Rd, 94704');
  assert.equal(fields.city, 'Berkeley');
  assert.equal(fields.state, 'CA');
  assert.equal(fields.phone, '555-0177');
  assert.equal(fields.contactName, 'Site Lead');
});

test('equipment filtering keeps the selected site and Other / unassigned', () => {
  const rows = [
    { id: 9, manufacturer: 'Candela', model: 'GentleMax', serial_number: 'SN-9', location_id: 3 },
    { id: 10, manufacturer: 'Cynosure', model: 'Elite', serial_number: 'SN-10', location_id: 1 },
    { id: 11, manufacturer: 'Quanta', model: 'Q-Plus', serial_number: 'SN-11', location_id: null },
  ];
  const groups = groupEquipmentForSite(rows, 3, { siteLabel: 'Surgery suite' });
  assert.deepEqual(groups.atSite.map((row) => row.id), [9]);
  assert.deepEqual(groups.unassigned.map((row) => row.id), [11]);
  assert.equal(groups.siteLabel, 'Surgery suite');
  assert.equal(UNASSIGNED_EQUIPMENT_LABEL, 'Other / unassigned');
  assert.equal(shouldClearEquipmentSelection(rows, groups, 10), true);
  assert.equal(shouldClearEquipmentSelection(rows, groups, 11), false);

  const kept = groupEquipmentForSite(rows, 3, { keepIds: [10] });
  assert.deepEqual(kept.unassigned.map((row) => row.id), [10, 11]);
  assert.equal(shouldClearEquipmentSelection(rows, kept, 10), false);
});

test('ticket prefill preselects the ticket location', () => {
  const prefill = reportPrefillFromTicket({
    ticket: {
      id: 42,
      customer_organization_id: 88,
      customer_name: 'North Clinic',
      customer_location_id: 3,
      equipment_id: 9,
    },
    location: {
      id: 3,
      name: 'Surgery suite',
      address: '500 Site Rd',
      city: 'Berkeley',
      state: 'CA',
      zip: '94704',
    },
  });
  assert.ok(prefill);
  assert.equal(prefill.locationId, 3);
  assert.equal(prefill.siteName, 'Surgery suite');
  assert.equal(prefill.equipmentId, 9);

  const control = reportLocationControl([main, suite], prefill.locationId);
  assert.equal(control.shown, true);
  assert.equal(control.disabled, false);
  assert.equal(control.selectedId, '3');

  const hidden = reportLocationControl([]);
  assert.equal(hidden.shown, false);
  assert.equal(hidden.selectedId, '');
});

test('missing equipment.location_id is remembered for the rest of the session', async () => {
  resetEquipmentLocationProbe();
  const calls: string[] = [];
  const supabase = {
    from() {
      return {
        select(columns: string) {
          calls.push(columns);
          return {
            eq() {
              return this;
            },
            limit() {
              if (columns.includes('location_id')) {
                return Promise.resolve({
                  data: null,
                  error: {
                    code: '42703',
                    message: 'column equipment.location_id does not exist',
                  },
                });
              }
              return Promise.resolve({
                data: [{ id: 11, manufacturer: 'Quanta', model: 'Q-Plus', serial_number: 'SN-11' }],
                error: null,
              });
            },
          };
        },
      };
    },
  };
  const rows = await loadCustomerEquipment(supabase, 88);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].location_id, null);
  assert.equal(calls.length, 2);

  const again = await loadCustomerEquipment(supabase, 99);
  assert.equal(again.length, 1);
  assert.equal(again[0].location_id, null);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].includes('location_id'), false);
  resetEquipmentLocationProbe();
});

test('service report form shows the location dropdown and resets on customer change', () => {
  const form = readFileSync(join(here, '../app/reports/new/NewServiceReportClient.tsx'), 'utf8');
  assert.match(form, /data-testid="report-location"/);
  assert.match(form, /locationUi\.disabled/);
  assert.match(form, /data-testid="report-equipment"/);
  assert.match(form, /data-testid="report-site"/);
  assert.match(form, /UNASSIGNED_EQUIPMENT_LABEL/);
  assert.match(form, /groupEquipmentForSite/);
  assert.match(form, /loadCustomerLocations/);
  assert.match(form, /prefill\.locationId/);
  assert.match(form, /resetEquipmentPick\(\)/);
  const selectCustomer = form.slice(form.indexOf('const handleSelectCustomer'), form.indexOf('const handleAddNewCustomer'));
  assert.match(selectCustomer, /resetEquipmentPick\(\)/);
  assert.match(selectCustomer, /setSelectedLocationId\(''\)/);
  assert.match(selectCustomer, /setSiteName\(''\)/);
});
