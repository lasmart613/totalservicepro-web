import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OPTIONAL_ORG_COLUMNS,
  charLimitFromError,
  customerOrgPayload,
  emptyCustomerForm,
  filterLinkedCustomers,
  matchLinkedCustomer,
  stripOverflowingAddressFields,
} from './customer-form.ts';

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
  assert.match(src, /Assign to FSE|AssignFseSelect/);
  assert.match(src, /loadTicketAssignees/);
  assert.match(src, /applyTicketAssignee/);
  assert.match(src, /100dvh/);
  assert.match(src, /overflowY: 'auto'/);
  assert.match(src, /normalizeStateCode/);
  assert.match(src, /customer_state: customerState/);
  assert.match(src, /insertOmittingCharOverflow/);
});

test('postgres character(3) overflow names the limit and optional address fields can be stripped', () => {
  assert.equal(charLimitFromError('value too long for type character(3)'), 3);
  const payload: Record<string, unknown> = { name: 'Clinic', zip: '60601', state: 'TX' };
  assert.equal(stripOverflowingAddressFields(payload, 3), 'zip');
  assert.equal(payload.zip, undefined);
  assert.equal(payload.state, 'TX');
});

test('character(3) retry omits UUID created_by, phone, biz_type, and type — never name', () => {
  const payload: Record<string, unknown> = {
    name: 'Northshore Clinic',
    type: 'customer',
    created_by: '11111111-1111-1111-1111-111111111111',
    phone: '312-555-0100',
    biz_type: 'Medical Spa',
    specialties: ['Hair Removal'],
  };
  assert.equal(stripOverflowingAddressFields(payload, 3), 'created_by');
  assert.equal(payload.created_by, undefined);
  assert.equal(stripOverflowingAddressFields(payload, 3), 'specialties');
  assert.equal(payload.specialties, undefined);
  assert.equal(stripOverflowingAddressFields(payload, 3), 'phone');
  assert.equal(stripOverflowingAddressFields(payload, 3), 'biz_type');
  assert.equal(stripOverflowingAddressFields(payload, 3), 'type');
  assert.equal(payload.type, undefined);
  assert.equal(payload.name, 'Northshore Clinic');
  assert.equal(stripOverflowingAddressFields(payload, 3), null);
});

test('empty specialties are omitted from the org insert payload', () => {
  const payload = customerOrgPayload({ ...emptyCustomerForm(), name: 'Clinic' }, { type: 'customer' });
  assert.equal('specialties' in payload, false);
});

test('customer org payload normalizes social handles and lists social columns as optional', () => {
  const payload = customerOrgPayload(
    { ...emptyCustomerForm(), name: 'Clinic', x_url: '@northshore', instagram_url: 'instagram.com/clinic' },
    { type: 'customer' }
  );
  assert.equal(payload.x_url, 'https://x.com/northshore');
  assert.equal(payload.instagram_url, 'https://instagram.com/clinic');
  assert.equal(payload.website, null);
  assert.equal(payload.facebook_url, null);
  for (const col of [
    'x_url',
    'instagram_url',
    'facebook_url',
    'tiktok_url',
    'youtube_url',
    'linkedin_url',
    'yelp_url',
    'threads_url',
  ]) {
    assert.ok((OPTIONAL_ORG_COLUMNS as readonly string[]).includes(col), col);
  }
});

test('Add Customer form accepts full state names instead of forcing ISO typing', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../components/CustomerInfoForm.tsx'), 'utf8');
  assert.match(src, /TX or Texas/);
  assert.doesNotMatch(src, /maxLength=\{2\}/);
});

test('ticket editor keeps shop organization_id and writes customer_organization_id', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../app/service-tickets/[id]/page.tsx'), 'utf8');
  assert.match(src, /TICKET_SAVE_FIELDS/);
  assert.match(src, /customer_organization_id: selectedOrg\.id/);
  assert.match(src, /loadLinkedCustomers/);
  assert.doesNotMatch(src, /[^_]organization_id: selectedOrg\.id/);
  assert.doesNotMatch(src, /update\(\{ \.\.\.formData/);
});

test('send-invoice requires an owned invoice row before service-role writes', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../app/api/billing/send-invoice/route.ts'), 'utf8');
  assert.doesNotMatch(src, /row\.organization_id == null/);
  assert.match(src, /This invoice belongs to another organization/);
  assert.match(src, /if \(invoiceId && inv\)/);
});
