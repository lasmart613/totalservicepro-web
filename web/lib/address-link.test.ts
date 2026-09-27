import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatServiceAddress,
  formatTicketAddress,
  serviceAddressMapsUrls,
} from './address-link.ts';

const FULL = '100 Main St, Evanston, IL 60201';

test('formatServiceAddress is Street, City, ST ZIP and keeps partial addresses', () => {
  assert.equal(
    formatServiceAddress({ street: '100 Main St', city: 'Evanston', state: 'IL', zip: '60201' }),
    FULL
  );
  assert.equal(FULL.includes(', 60201'), false);
  assert.equal(
    formatServiceAddress({ street: ' 100 Main St ', city: '', state: ' IL ', zip: null }),
    '100 Main St, IL'
  );
  assert.equal(formatServiceAddress({ city: 'Tempe', state: 'AZ' }), 'Tempe, AZ');
  assert.equal(formatServiceAddress({ state: 'AZ', zip: '85251' }), 'AZ 85251');
  assert.equal(formatServiceAddress({ street: '   ', city: '', state: null, zip: undefined }), '');
  assert.equal(formatServiceAddress(null), '');
});

test('formatTicketAddress prefers customer fields and falls back to address, city, state, zip', () => {
  assert.equal(
    formatTicketAddress({
      customer_address: '100 Main St',
      address: 'ignored',
      customer_city: 'Evanston',
      customer_state: 'IL',
      zip: '60201',
    }),
    FULL
  );
  assert.equal(
    formatTicketAddress({ address: '400 Rodeo Dr', city: 'Beverly Hills', state: 'CA', customer_zip: '90210' }),
    '400 Rodeo Dr, Beverly Hills, CA 90210'
  );
  assert.equal(formatTicketAddress({}), '');
});

test('serviceAddressMapsUrls builds the Google Maps search URL and Android geo intent', () => {
  const urls = serviceAddressMapsUrls(FULL);
  assert.ok(urls);
  assert.equal(
    urls.https,
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(FULL)}`
  );
  assert.equal(urls.geo, `geo:0,0?q=${encodeURIComponent(FULL)}`);
  assert.equal(urls.https.includes(' '), false);
  assert.match(urls.https, /query=100%20Main%20St/);
  assert.equal(urls.https.includes(',%2060201'), false);
  const partial = serviceAddressMapsUrls('Tempe, AZ');
  assert.ok(partial);
  assert.equal(partial.https, `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Tempe, AZ')}`);
  assert.equal(serviceAddressMapsUrls(''), null);
  assert.equal(serviceAddressMapsUrls('   '), null);
});

test('AddressLink is the shared clickable service address and does not activate the ticket row', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const component = readFileSync(join(here, '../components/AddressLink.tsx'), 'utf8');
  const detail = readFileSync(join(here, '../app/service-tickets/[id]/page.tsx'), 'utf8');
  const schedule = readFileSync(join(here, '../app/service-schedule/page.tsx'), 'utf8');
  const home = readFileSync(join(here, '../components/home/HomeDashboard.tsx'), 'utf8');
  const helper = readFileSync(join(here, './address-link.ts'), 'utf8');
  const java = readFileSync(
    join(here, '../../app/src/main/java/com/photometrytools/MainActivity.java'),
    'utf8'
  );
  assert.match(component, /target="_blank"/);
  assert.match(component, /rel="noopener noreferrer"/);
  assert.match(component, /title=\{full\}/);
  assert.match(component, /stopPropagation/);
  assert.match(component, /openNativeServiceAddress/);
  assert.doesNotMatch(helper, /Capacitor/);
  assert.match(detail, /TicketAddressLink/);
  assert.doesNotMatch(detail, /ticket\.customer_city \|\| ticket\.city/);
  assert.match(detail, /isEditing &&/);
  assert.match(schedule, /TicketAddressLink/);
  assert.match(schedule, /truncate/);
  assert.match(home, /TicketAddressLink/);
  assert.match(java, /openGeoOrMaps/);
  assert.match(java, /resolveActivity/);
  assert.match(java, /ActivityNotFoundException/);
  assert.match(java, /openGeoOrMaps\(url\);\s*return true;/);
});
