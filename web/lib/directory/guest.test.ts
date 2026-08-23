import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GUEST_ADDRESS_PLACEHOLDER,
  GUEST_DIRECTORY_PAGE_SIZE,
  GUEST_EMAIL_PLACEHOLDER,
  GUEST_NAME_PLACEHOLDER,
  GUEST_PHONE_PLACEHOLDER,
  GUEST_SIGNUP_HREF,
  clampGuestDirectoryPageSize,
  directoryHref,
  displayGuestDirectoryField,
  guestCardLeaksPii,
  guestDirectoryTypeFilter,
  matchesGuestDirectoryFilter,
  redactDirectoryOrg,
  regionFromState,
} from './guest.ts';

const SAMPLE: Parameters<typeof redactDirectoryOrg>[0] = {
  id: 42,
  name: 'Acme Laser Clinic of Dallas',
  type: 'customer',
  city: 'Dallas',
  state: 'TX',
  address: '123 Main Street',
  zip: '75201',
  phone: '214-555-0199',
  email: 'front@acmelaserclinic.com',
  website: 'https://acmelaserclinic.com',
  logo_url: 'https://cdn.example.com/acme-logo.png',
  description: 'Acme treats patients on Main Street in Dallas.',
  contact_name: 'Jordan Lee',
};

test('guest cards keep type chrome and a generic region, never the clinic identity', () => {
  const card = redactDirectoryOrg(SAMPLE);
  assert.equal(card.id, 42);
  assert.equal(card.type, 'customer');
  assert.equal(card.typeLabel, 'Laser Clinic / Practice');
  assert.equal(card.region, 'South');
  assert.equal(card.name, GUEST_NAME_PLACEHOLDER);
  assert.equal(card.phone, GUEST_PHONE_PLACEHOLDER);
  assert.equal(card.email, GUEST_EMAIL_PLACEHOLDER);
  assert.equal(card.address, GUEST_ADDRESS_PLACEHOLDER);
  assert.equal(card.hasPhone, true);
  assert.equal(card.hasEmail, true);
  assert.equal(card.hasWebsite, true);
  assert.equal(guestCardLeaksPii(card, SAMPLE), false);
  const blob = JSON.stringify(card);
  assert.doesNotMatch(blob, /Acme/);
  assert.doesNotMatch(blob, /Dallas/);
  assert.doesNotMatch(blob, /214-555/);
  assert.doesNotMatch(blob, /acmelaserclinic/i);
  assert.doesNotMatch(blob, /123 Main/);
  assert.doesNotMatch(blob, /Jordan/);
  assert.doesNotMatch(blob, /\bTX\b/);
  assert.doesNotMatch(blob, /75201/);
});

test('missing contact fields stay omitted so cards still look real', () => {
  const card = redactDirectoryOrg({
    id: 7,
    name: 'Silent Repair Co',
    type: 'service_company',
    state: 'Oregon',
  });
  assert.equal(card.region, 'West');
  assert.equal(card.typeLabel, 'Repair company');
  assert.equal(card.hasPhone, false);
  assert.equal(card.hasEmail, false);
  assert.equal(card.hasWebsite, false);
  assert.equal(card.phone, null);
  assert.equal(card.email, null);
  assert.doesNotMatch(JSON.stringify(card), /Silent Repair/);
});

test('unknown or identifying state values are dropped instead of echoed', () => {
  assert.equal(regionFromState('CA'), 'West');
  assert.equal(regionFromState('california'), 'West');
  assert.equal(regionFromState('ON'), 'Canada');
  assert.equal(regionFromState('Springfield'), null);
  assert.equal(regionFromState(''), null);
});

test('guest field helpers never return the real value while logged out', () => {
  assert.equal(displayGuestDirectoryField(false, 'Acme Laser Clinic', GUEST_NAME_PLACEHOLDER), GUEST_NAME_PLACEHOLDER);
  assert.equal(displayGuestDirectoryField(true, 'Acme Laser Clinic', GUEST_NAME_PLACEHOLDER), 'Acme Laser Clinic');
  assert.equal(GUEST_SIGNUP_HREF, '/signup');
});

test('logged-out directory clicks go to register, not an org detail page', () => {
  assert.equal(directoryHref(false, '/directory/42'), GUEST_SIGNUP_HREF);
  assert.equal(directoryHref(false, '/directory/42?tab=contact'), GUEST_SIGNUP_HREF);
  assert.equal(directoryHref(true, '/directory/42'), '/directory/42');
});

test('type filters map to real Organizations.type values', () => {
  assert.deepEqual(guestDirectoryTypeFilter('clinics'), ['customer', 'laser_clinic']);
  assert.deepEqual(guestDirectoryTypeFilter('service'), ['service_company', 'service']);
  assert.deepEqual(guestDirectoryTypeFilter('manufacturer'), ['manufacturer']);
  assert.equal(guestDirectoryTypeFilter('all'), null);
  assert.equal(matchesGuestDirectoryFilter('customer', 'clinics'), true);
  assert.equal(matchesGuestDirectoryFilter('service_company', 'clinics'), false);
  assert.equal(matchesGuestDirectoryFilter('manufacturer', 'clinics'), false);
  assert.equal(matchesGuestDirectoryFilter('manufacturer', 'service'), false);
  assert.equal(matchesGuestDirectoryFilter('manufacturer', 'manufacturer'), true);
});

test('guest directory pages stay in the 24–48 first-page range', () => {
  assert.equal(GUEST_DIRECTORY_PAGE_SIZE, 36);
  assert.equal(clampGuestDirectoryPageSize('36'), 36);
  assert.equal(clampGuestDirectoryPageSize('1700'), 48);
  assert.equal(clampGuestDirectoryPageSize('0'), 1);
});

test('logged-out directory redacts PII and sends card clicks to signup', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, '../../app/directory/page.tsx'), 'utf8');
  const api = readFileSync(join(here, '../../app/api/directory/route.ts'), 'utf8');
  const ui = readFileSync(join(here, '../../components/directory/GuestRedactedText.tsx'), 'utf8');
  const card = readFileSync(join(here, '../../components/directory/GuestDirectoryCard.tsx'), 'utf8');
  const deep = readFileSync(join(here, '../../app/directory/[id]/page.tsx'), 'utf8');
  assert.match(page, /GuestDirectoryCard/);
  assert.match(page, /\/api\/directory/);
  assert.match(page, /GUEST_SIGNUP_HREF/);
  assert.match(page, /useSignedIn/);
  assert.match(api, /redactDirectoryOrg/);
  assert.match(api, /organizations/);
  assert.doesNotMatch(api, /\.eq\(\s*['\"]list_in_directory['\"]/);
  assert.match(ui, /blur-\[7px\]/);
  assert.match(ui, /placeholder/);
  assert.match(card, /directoryHref/);
  assert.doesNotMatch(card, /href=\{?["'`]tel:/);
  assert.doesNotMatch(card, /href=\{?["'`]mailto:/);
  assert.doesNotMatch(card, /maps\.google|google\.com\/maps/);
  assert.doesNotMatch(card, /websiteHref/);
  assert.doesNotMatch(card, /target="_blank"/);
  assert.match(deep, /useGuestSignupRedirect/);
});
