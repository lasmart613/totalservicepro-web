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
  serviceCallFromLocations,
  ticketContactForLocation,
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

test('switching locations overwrites phone and contact, and clears them when the location has none', () => {
  const current = {
    customer_address: '100 Harbor Ave',
    customer_city: 'Evanston',
    customer_state: 'IL',
    customer_zip: '60201',
    customer_phone: '847-555-0142',
    customer_contact: 'Directory desk',
  };
  const branch = applyLocationToTicketFields(current, beverly, { officePhone: '847-555-0100' });
  assert.equal(branch.customer_address, '400 Rodeo Dr');
  assert.equal(branch.customer_city, 'Beverly Hills');
  assert.equal(branch.customer_state, 'CA');
  assert.equal(branch.customer_zip, '90210');
  assert.equal(branch.customer_phone, '310-555-0199');
  assert.equal(branch.customer_contact, 'Avery Cole');
  assert.equal(branch.customer_location_id, 2);

  const backToMain = applyLocationToTicketFields(
    {
      customer_address: branch.customer_address,
      customer_city: branch.customer_city,
      customer_state: branch.customer_state,
      customer_zip: branch.customer_zip,
      customer_phone: branch.customer_phone,
      customer_contact: branch.customer_contact,
    },
    mainOffice,
    { officePhone: '847-555-0100' }
  );
  assert.equal(backToMain.customer_address, '100 Harbor Ave');
  assert.equal(backToMain.customer_phone, '847-555-0100');
  assert.equal(backToMain.customer_contact, 'Front desk');
  assert.equal(backToMain.customer_location_id, 1);

  const blank = applyLocationToTicketFields(backToMain, {
    ...beverly,
    phone: '',
    contact_name: null,
  });
  assert.equal(blank.customer_phone, '');
  assert.equal(blank.customer_contact, '');
  assert.match(formatLocationOption(beverly), /Beverly Hills - 400 Rodeo Dr/);
  assert.match(formatLocationOption(mainOffice), /\(Primary\)/);
});

test('ticket phone and contact come from the selected location even when it repeats the office line', () => {
  assert.equal(
    ticketPhoneForLocation({
      locationPhone: '847-555-0100',
      isPrimary: true,
      officePhone: '847-555-0100',
      currentPhone: '847-555-0142',
    }),
    '847-555-0100'
  );
  assert.equal(ticketPhoneForLocation({ locationPhone: '', currentPhone: '310-555-0199' }), '');
  assert.equal(ticketContactForLocation({ locationContact: 'Front desk' }), 'Front desk');
  assert.equal(ticketContactForLocation({ locationContact: '  ' }), '');
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

  assert.match(page, /address: form\.address/);
  assert.match(schedule, /serviceCallFromLocations/);
  assert.match(schedule, /if \(!resolved\.fields\)/);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.locations/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS contact_name/);
  assert.match(migration, /NOT EXISTS/);
  assert.match(migration, /Main office/);
  assert.match(migration, /locations_service_company_linked_manage/);
  assert.match(migration, /organization_customers/);
  assert.match(migration, /customer_location_id/);
  assert.match(migration, /ON DELETE SET NULL/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.locations_single_primary/);
  assert.match(migration, /DROP TRIGGER IF EXISTS locations_single_primary/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OF is_primary/);
  assert.match(migration, /EXECUTE FUNCTION public\.locations_single_primary/);
  assert.match(migration, /DROP INDEX IF EXISTS public\.locations_one_primary_per_org/);
  assert.doesNotMatch(migration, /CREATE UNIQUE INDEX/);
  assert.doesNotMatch(migration, /UPDATE public\.locations AS extra/);
  assert.doesNotMatch(migration, /SET is_primary = true/);
  assert.doesNotMatch(migration, /Allow all/i);
});

test('a successful empty locations read still shows the organization address', async () => {
  const org = {
    address: '100 Harbor Ave',
    city: 'Evanston',
    state: 'IL',
    zip: '60201',
    phone: '847-555-0100',
  };
  const loaded = await loadCustomerLocations(
    {
      from() {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: async () => ({ data: [], error: null }),
        };
        return builder;
      },
    },
    44
  );
  assert.equal(loaded.unavailable, false);
  assert.deepEqual(loaded.locations, []);

  const shown = locationsForDisplay(loaded.locations, org);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].name, PRIMARY_LOCATION_NAME);
  assert.equal(shown[0].address, '100 Harbor Ave');
  assert.equal(shown[0].city, 'Evanston');
  assert.equal(shown[0].state, 'IL');
  assert.equal(shown[0].zip, '60201');
  assert.equal(shown[0].is_primary, true);
  assert.equal(shown[0].localOnly, true);

  const ticket = serviceCallFromLocations(
    loaded.locations,
    { ...org, phone: '847-555-0142' },
    '847-555-0100'
  );
  assert.equal(ticket.fields, null);
  assert.equal(ticket.selectedId, '');
  assert.deepEqual(ticket.locations, []);
});

test('two primary flags display the most recently updated location', async () => {
  const older: CustomerLocation = {
    ...mainOffice,
    id: 4,
    name: 'North clinic',
    updated_at: '2026-01-02T00:00:00.000Z',
    is_primary: true,
  };
  const newer: CustomerLocation = {
    ...beverly,
    id: 9,
    name: 'South clinic',
    updated_at: '2026-08-23T12:00:00.000Z',
    is_primary: true,
  };

  assert.equal(pickPrimaryLocation([older, newer])?.id, 9);
  assert.equal(pickPrimaryLocation([newer, older])?.id, 9);

  const shown = locationsForDisplay([older, newer], {
    address: '100 Harbor Ave',
    city: 'Evanston',
    state: 'IL',
    zip: '60201',
  });
  assert.equal(shown.length, 2);
  assert.equal(shown.filter((loc) => loc.is_primary).length, 1);
  assert.equal(shown.find((loc) => loc.is_primary)?.name, 'South clinic');

  const tied = locationsForDisplay(
    [
      { ...older, id: 4, updated_at: '2026-08-23T12:00:00.000Z' },
      { ...newer, id: 9, updated_at: '2026-08-23T12:00:00.000Z' },
    ],
    {}
  );
  assert.equal(tied.filter((loc) => loc.is_primary).length, 1);
  assert.equal(tied.find((loc) => loc.is_primary)?.id, 9);

  const missingStamp = locationsForDisplay(
    [
      { ...older, id: 3, updated_at: null },
      { ...newer, id: 8, updated_at: undefined },
    ],
    {}
  );
  assert.equal(missingStamp.filter((loc) => loc.is_primary).length, 1);
  assert.equal(missingStamp.find((loc) => loc.is_primary)?.id, 8);

  const ticket = serviceCallFromLocations(
    [older, newer],
    {
      address: '100 Harbor Ave',
      city: 'Evanston',
      state: 'IL',
      zip: '60201',
      phone: '847-555-0142',
    },
    '847-555-0100'
  );
  assert.equal(ticket.fields?.customer_address, '400 Rodeo Dr');
  assert.equal(ticket.fields?.customer_city, 'Beverly Hills');
  assert.equal(ticket.locations.filter((loc) => loc.is_primary).length, 1);
  assert.equal(ticket.selectedId, '9');

  const loaded = await loadCustomerLocations(
    {
      from() {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: async () => ({
            data: [
              { id: 4, name: 'North clinic', address: '100 Harbor Ave', is_primary: true, updated_at: '2026-01-02T00:00:00.000Z' },
              { id: 9, name: 'South clinic', address: '400 Rodeo Dr', is_primary: true, updated_at: '2026-08-23T12:00:00.000Z' },
            ],
            error: null,
          }),
        };
        return builder;
      },
    },
    44
  );
  assert.equal(loaded.unavailable, false);
  assert.equal(loaded.locations.filter((loc) => loc.is_primary).length, 1);
  assert.equal(loaded.locations.find((loc) => loc.is_primary)?.id, 9);
});
