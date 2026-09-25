import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRIMARY_LOCATION_NAME,
  applyDraftToLocations,
  applyLocationToTicketFields,
  canRemoveLocation,
  emptyLocationDraft,
  formatLocationOption,
  isLocationsUnavailable,
  loadCustomerLocations,
  localPrimaryFromOrg,
  locationsForDisplay,
  persistedLocationId,
  pickPrimaryLocation,
  removeLocationFromList,
  ticketPhoneForLocation,
  validateLocationDraft,
  type CustomerLocation,
} from './customer-locations.ts';

const here = dirname(fileURLToPath(import.meta.url));

const mainOffice: CustomerLocation = {
  id: 1,
  name: 'Main office',
  address: '100 Harbor Ave',
  city: 'Evanston',
  state: 'IL',
  zip: '60201',
  phone: '847-555-0100',
  contact_name: 'Front desk',
  is_primary: true,
};

const beverly: CustomerLocation = {
  id: 2,
  name: 'Beverly Hills',
  address: '400 Rodeo Dr',
  city: 'Beverly Hills',
  state: 'CA',
  zip: '90210',
  phone: '310-555-0199',
  contact_name: 'Avery Cole',
  is_primary: false,
};

test('a customer with only the organization address shows one primary location', () => {
  const shown = locationsForDisplay([], {
    address: '100 Harbor Ave',
    city: 'Evanston',
    state: 'IL',
    zip: '60201',
    phone: '847-555-0100',
  });
  assert.equal(shown.length, 1);
  assert.equal(shown[0].name, PRIMARY_LOCATION_NAME);
  assert.equal(shown[0].is_primary, true);
  assert.equal(shown[0].localOnly, true);
  assert.equal(localPrimaryFromOrg({ address: '', city: '', state: '', zip: '' }), null);
});

test('adding a second location keeps the original address as primary', () => {
  const next = applyDraftToLocations(
    [mainOffice],
    emptyLocationDraft({
      name: 'Beverly Hills',
      address: '400 Rodeo Dr',
      city: 'Beverly Hills',
      state: 'California',
      zip: '90210',
      phone: '310-555-0199',
      contact_name: 'Avery Cole',
      is_primary: false,
    })
  );
  assert.equal(next.length, 2);
  const primary = pickPrimaryLocation(next);
  assert.equal(primary?.id, 1);
  assert.equal(primary?.address, '100 Harbor Ave');
  const added = next.find((loc) => loc.name === 'Beverly Hills');
  assert.equal(added?.state, 'CA');
  assert.equal(added?.is_primary, false);
  assert.equal(validateLocationDraft(emptyLocationDraft()), 'Location name is required');
});

test('set-primary and remove promote another location without dropping the rest', () => {
  const both = [mainOffice, beverly];
  const flipped = applyDraftToLocations(both, emptyLocationDraft({ ...beverly, name: beverly.name, address: beverly.address || '', city: beverly.city || '', state: beverly.state || '', zip: beverly.zip || '', phone: beverly.phone || '', contact_name: beverly.contact_name || '', is_primary: true }), beverly.id);
  assert.equal(pickPrimaryLocation(flipped)?.name, 'Beverly Hills');
  assert.equal(flipped.find((loc) => loc.id === 1)?.is_primary, false);

  assert.equal(canRemoveLocation([mainOffice], mainOffice.id), false);
  assert.equal(canRemoveLocation(both, beverly.id), true);
  const removed = removeLocationFromList(flipped, beverly.id);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].name, 'Main office');
  assert.equal(removed[0].is_primary, true);
});

test('ticket location defaults to primary and can switch address without wiping a directory phone', () => {
  const current = {
    customer_address: '100 Harbor Ave',
    customer_city: 'Evanston',
    customer_state: 'IL',
    customer_zip: '60201',
    customer_phone: '847-555-0142',
  };
  const primaryFields = applyLocationToTicketFields(current, mainOffice, { officePhone: '847-555-0100' });
  assert.equal(primaryFields.customer_address, '100 Harbor Ave');
  assert.equal(primaryFields.customer_phone, '847-555-0142');
  assert.equal(primaryFields.customer_location_id, 1);

  const second = applyLocationToTicketFields(current, beverly, { officePhone: '847-555-0100' });
  assert.equal(second.customer_address, '400 Rodeo Dr');
  assert.equal(second.customer_city, 'Beverly Hills');
  assert.equal(second.customer_state, 'CA');
  assert.equal(second.customer_zip, '90210');
  assert.equal(second.customer_phone, '310-555-0199');
  assert.equal(second.customer_location_id, 2);
  assert.match(formatLocationOption(beverly), /Beverly Hills - 400 Rodeo Dr/);
  assert.match(formatLocationOption(mainOffice), /\(Primary\)/);
});

test('ticket phone keeps the directory number when the primary location only repeats the office line', () => {
  assert.equal(
    ticketPhoneForLocation({
      locationPhone: '847-555-0100',
      isPrimary: true,
      officePhone: '847-555-0100',
      currentPhone: '847-555-0142',
    }),
    '847-555-0142'
  );
  assert.equal(
    ticketPhoneForLocation({
      locationPhone: '312-555-0177',
      isPrimary: true,
      officePhone: '847-555-0100',
      currentPhone: '847-555-0142',
    }),
    '312-555-0177'
  );
  assert.equal(persistedLocationId('local-primary'), null);
  assert.equal(persistedLocationId(4), 4);
});

test('missing locations table is unavailable and a missing contact column is retried', async () => {
  assert.equal(isLocationsUnavailable('relation "public.locations" does not exist'), true);
  assert.equal(
    isLocationsUnavailable("Could not find the table 'public.locations' in the schema cache"),
    true
  );
  assert.equal(
    isLocationsUnavailable("Could not find the 'contact_name' column of 'locations' in the schema cache"),
    false
  );

  const missing = await loadCustomerLocations(
    {
      from() {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: async () => ({ data: null, error: { message: 'relation "public.locations" does not exist' } }),
        };
        return builder;
      },
    },
    9
  );
  assert.equal(missing.unavailable, true);
  assert.deepEqual(missing.locations, []);

  let selects: string[] = [];
  const drifted = await loadCustomerLocations(
    {
      from() {
        const builder = {
          select(cols: string) {
            selects.push(cols);
            return builder;
          },
          eq: () => builder,
          order: async () => {
            if (selects[selects.length - 1].includes('contact_name')) {
              return {
                data: null,
                error: { message: "Could not find the 'contact_name' column of 'locations' in the schema cache" },
              };
            }
            return { data: [{ id: 3, name: 'Main office', address: '1 Main', is_primary: true }], error: null };
          },
        };
        return builder;
      },
    },
    9
  );
  assert.equal(drifted.unavailable, false);
  assert.equal(drifted.schemaLag, true);
  assert.equal(drifted.locations[0].name, 'Main office');
  assert.equal(drifted.locations[0].is_primary, true);
});

test('customer edit screen exposes Add location and new service calls pick a location', () => {
  const form = readFileSync(join(here, '../components/CustomerInfoForm.tsx'), 'utf8');
  const editor = readFileSync(join(here, '../components/CustomerLocationsEditor.tsx'), 'utf8');
  const page = readFileSync(join(here, '../app/customers/[id]/page.tsx'), 'utf8');
  const schedule = readFileSync(join(here, '../app/service-schedule/page.tsx'), 'utf8');
  const migration = readFileSync(
    join(here, '../supabase/migrations/20260924_000000_customer_locations.sql'),
    'utf8'
  );

  assert.match(form, /Primary address/);
  assert.match(form, /Add location/);
  assert.match(form, /afterAddress/);
  assert.match(editor, /Add location/);
  assert.match(editor, /Set primary/);
  assert.match(editor, /Remove/);
  assert.match(page, /CustomerLocationsPanel/);
  assert.match(schedule, /CustomerLocationSelect/);
  assert.match(schedule, /customer_location_id/);
  assert.match(schedule, /loadCustomerLocations/);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.locations/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS contact_name/);
  assert.match(migration, /NOT EXISTS/);
  assert.match(migration, /Main office/);
  assert.match(migration, /locations_service_company_linked_manage/);
  assert.match(migration, /organization_customers/);
  assert.match(migration, /customer_location_id/);
  assert.match(migration, /ON DELETE SET NULL/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
});
