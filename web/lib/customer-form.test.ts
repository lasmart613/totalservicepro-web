import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterLinkedCustomers, matchLinkedCustomer } from './customer-form.ts';

const LUXOR_CUSTOMERS = [
  { id: 1, name: 'Northshore Clinic', city: 'Evanston', state: 'IL' },
  { id: 2, name: 'Galactic Med Spa', city: 'Mos Eisley', state: 'AZ' },
  { id: 3, name: 'Oak Park Dermatology', city: 'Oak Park', state: 'IL' },
];

test('ticket customer autofill matches assigned shops by name or city', () => {
  const byName = filterLinkedCustomers(LUXOR_CUSTOMERS, 'north');
  assert.equal(byName.length, 1);
  assert.equal(byName[0].name, 'Northshore Clinic');

  const byCity = filterLinkedCustomers(LUXOR_CUSTOMERS, 'oak park');
  assert.equal(byCity.length, 1);
  assert.equal(byCity[0].id, 3);

  const emptyQuery = filterLinkedCustomers(LUXOR_CUSTOMERS, '');
  assert.equal(emptyQuery.length, 3);
});

test('exact name match is used instead of creating a duplicate company', () => {
  assert.equal(matchLinkedCustomer(LUXOR_CUSTOMERS, ' galactic med spa ')?.id, 2);
  assert.equal(matchLinkedCustomer(LUXOR_CUSTOMERS, 'Not On Roster'), null);
});

test('new service call form autocompletes assigned customers and can add a new company', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../app/service-schedule/page.tsx'), 'utf8');
  assert.match(src, /loadLinkedCustomers/);
  assert.match(src, /organization_customers|loadLinkedCustomers/);
  assert.match(src, /AddCustomerModal/);
  assert.match(src, /createLinkedCustomer/);
  assert.match(src, /Add a company/);
  assert.match(src, /customer_organization_id/);
  assert.match(src, /Assign to/);
  assert.match(src, /\/api\/team\/list/);
  assert.match(src, /assigned_to: assignedTo/);
  assert.match(src, /100dvh/);
  assert.match(src, /overflowY: 'auto'/);
  assert.doesNotMatch(
    src,
    /<label className="label">Customer name \*<\/label>\s*<input\s+className="input"\s+value=\{form\.customer_name\}/
  );
});
