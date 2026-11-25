import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADDRESS_LINE2_MAX,
  addressLine2FieldError,
  faxFieldError,
  formatFaxLine,
  formatPostalLines,
  formatPostalQuery,
  formatPostalText,
  missingFaxOrAddressLine2,
  normalizeAddressLine2,
  normalizeFax,
  optionalContactError,
  orgProfileContactPatch,
  stripMissingFaxAddress,
} from './fax-address.ts';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(web, rel), 'utf8');

test('fax uses the directory phone shape and is optional', () => {
  assert.equal(normalizeFax(''), null);
  assert.equal(normalizeFax('   '), null);
  assert.equal(normalizeFax(null), null);
  assert.equal(normalizeFax('(602) 555-0123'), '(602) 555-0123');
  assert.equal(normalizeFax('+1 602.555.0199 ext 12'), '+1 602.555.0199 ext 12');
  assert.equal(normalizeFax('  602-555-0199  '), '602-555-0199');
  assert.equal(normalizeFax('call me'), null);
  assert.equal(normalizeFax('12'), null);
  assert.equal(faxFieldError(''), null);
  assert.equal(faxFieldError('(602) 555-0100'), null);
  assert.match(faxFieldError('nope') || '', /phone number/);
  assert.equal(formatFaxLine(''), '');
  assert.equal(formatFaxLine(null), '');
  assert.equal(formatFaxLine('602-555-0199'), 'Fax: 602-555-0199');
});

test('address line 2 is optional, trimmed, and capped', () => {
  assert.equal(normalizeAddressLine2(''), null);
  assert.equal(normalizeAddressLine2('  Suite 200  '), 'Suite 200');
  assert.equal(normalizeAddressLine2('a'.repeat(ADDRESS_LINE2_MAX)), 'a'.repeat(ADDRESS_LINE2_MAX));
  assert.equal(normalizeAddressLine2('a'.repeat(ADDRESS_LINE2_MAX + 1)), null);
  assert.equal(addressLine2FieldError(''), null);
  assert.equal(addressLine2FieldError('Unit 4'), null);
  assert.match(addressLine2FieldError('a'.repeat(ADDRESS_LINE2_MAX + 1)) || '', /too long/);
});

test('line 2 sits on its own line under the street and is omitted when empty', () => {
  assert.deepEqual(
    formatPostalLines({ line1: '100 Main St', city: 'Evanston', state: 'IL', zip: '60201' }),
    ['100 Main St, Evanston, IL 60201']
  );
  assert.equal(
    formatPostalText({
      line1: '100 Main St',
      line2: 'Suite 4',
      city: 'Evanston',
      state: 'IL',
      zip: '60201',
    }),
    '100 Main St\nSuite 4\nEvanston, IL 60201'
  );
  assert.equal(
    formatPostalText({ line1: '100 Main St', line2: '   ', city: 'Tempe', state: 'AZ' }),
    '100 Main St, Tempe, AZ'
  );
  assert.equal(
    formatPostalText({ line2: 'Unit B', city: 'Tempe', state: 'AZ' }),
    'Unit B\nTempe, AZ'
  );
  assert.equal(formatPostalText(null), '');
  assert.equal(
    formatPostalQuery({ line1: '100 Main St', line2: 'Suite 4', city: 'Evanston', state: 'IL', zip: '60201' }),
    '100 Main St, Suite 4, Evanston, IL 60201'
  );
});

test('invoice and report prefill keep fax and line 2 beside phone and street', async () => {
  const { billingPrefill } = await import('./billing/doc-prefill.ts');
  const filled = billingPrefill({
    ticket: {
      ticketId: '9',
      ticketNumber: 'T-9',
      customerName: 'North Clinic',
      customerAddress: '1 Main',
      customerAddressLine2: 'Suite 2',
      customerCity: 'Mesa',
      customerState: 'AZ',
      customerPhone: '480-555-0100',
      customerFax: '480-555-0199',
      customerEmail: 'a@clinic.test',
      customerContactName: 'Pat',
      comments: 'Down',
    },
    report: {
      customer_name: 'North Clinic',
      customer_address: '1 Main',
      customer_address_line2: 'Suite 2',
      customer_phone: '480-555-0100',
      customer_fax: '480-555-0199',
    },
  });
  assert.ok(filled);
  assert.equal(filled.customerAddressLine2, 'Suite 2');
  assert.equal(filled.customerFax, '480-555-0199');
  assert.equal(filled.customerPhone, '480-555-0100');
  assert.equal(filled.customerAddress, '1 Main');
});

test('org profile patch keeps fax and address line 2 and refuses a bad fax', () => {
  const ok: Record<string, unknown> = { name: 'Shop', fax: '  (602) 555-0199 ', address_line2: '  Suite 4 ' };
  assert.deepEqual(orgProfileContactPatch(ok), { ok: true });
  assert.equal(ok.fax, '(602) 555-0199');
  assert.equal(ok.address_line2, 'Suite 4');
  const blank: Record<string, unknown> = { fax: '   ', address_line2: '' };
  assert.deepEqual(orgProfileContactPatch(blank), { ok: true });
  assert.equal(blank.fax, null);
  assert.equal(blank.address_line2, null);
  const bad: Record<string, unknown> = { fax: 'not-a-fax', phone: '602-555-0100' };
  const refused = orgProfileContactPatch(bad);
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.match(refused.error, /phone number/);
  assert.equal(bad.phone, '602-555-0100');
  const long: Record<string, unknown> = { address_line2: 'x'.repeat(ADDRESS_LINE2_MAX + 1) };
  const tooLong = orgProfileContactPatch(long);
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) assert.match(tooLong.error, /Address line 2/);
});

test('a missing fax or address_line2 column is recognized and stripped', () => {
  const payload = { fax: '602-555-0199', address_line2: 'Suite 4', name: 'Shop' };
  assert.equal(missingFaxOrAddressLine2(null), false);
  assert.equal(missingFaxOrAddressLine2({ message: 'permission denied' }), false);
  assert.equal(
    missingFaxOrAddressLine2({ message: "Could not find the 'fax' column of 'organizations' in the schema cache", code: 'PGRST204' }),
    true
  );
  assert.equal(stripMissingFaxAddress(payload, { message: "Could not find the 'fax' column of 'organizations' in the schema cache" }), true);
  assert.equal('fax' in payload, false);
  assert.equal(payload.address_line2, 'Suite 4');
  assert.equal(
    stripMissingFaxAddress(payload, { code: '42703', message: 'column "address_line2" of relation "organizations" does not exist' }),
    true
  );
  assert.deepEqual(payload, { name: 'Shop' });
});

test('signup and profile writes validate fax before it can hit the database check', () => {
  assert.equal(optionalContactError({ fax: '', address_line2: '' }), null);
  assert.match(optionalContactError({ fax: 'abc', address_line2: 'Suite 1' }) || '', /phone number/);
  const route = read('app/api/org/profile/route.ts');
  assert.match(route, /'fax'/);
  assert.match(route, /'address_line2'/);
  assert.match(route, /orgProfileContactPatch\(payload\)/);
  assert.match(route, /status: 400/);
  const profile = read('app/profile/page.tsx');
  assert.match(profile, /faxFieldError\(profile\.fax\)/);
  assert.match(profile, /address_line2: normalizeAddressLine2\(profile\.address_line2\)/);
  assert.match(profile, /stripMissingFaxAddress\(payload, error\)/);
  assert.match(profile, /Address line 2 \(suite, unit, etc\.\)/);
  const company = read('app/company/page.tsx');
  assert.match(company, /faxFieldError\(newContact\.fax\)/);
  assert.match(company, /fax: normalizeFax\(newContact\.fax\)/);
  for (const page of ['app/signup/company/page.tsx', 'app/signup/owner/page.tsx', 'app/signup/supplier/page.tsx']) {
    const src = read(page);
    assert.match(src, /optionalContactError\(\{ fax, address_line2: addressLine2 \}\)/, page);
    assert.match(src, /optionalContactValues\(\{ fax, address_line2: addressLine2 \}\)/, page);
  }
  const onboarding = read('app/onboarding/page.tsx');
  assert.match(onboarding, /optionalContactError\(\{/);
  assert.match(onboarding, /stripMissingFaxAddress\(slim, profErr\)/);
  assert.match(onboarding, /stripMissingFaxAddress\(updatePayload, uErr\)/);
  assert.match(onboarding, /address_line2: contact\.address_line2/);
  const customer = read('app/customers/[id]/page.tsx');
  assert.match(customer, /formatPostalLines\(\{/);
  assert.match(customer, /line2: form\.address_line2/);
  assert.match(customer, /formatFaxLine\(form\.fax\)/);
  const companyHtml = read('../app/src/main/assets/company_profile.html');
  const companySave = companyHtml.slice(companyHtml.indexOf('async function saveCompany'));
  assert.ok(companySave.indexOf('faxFieldError(') >= 0);
  assert.ok(companySave.indexOf('faxFieldError(') < companySave.indexOf("tspPost('/api/org/profile'"));
  const profileHtml = read('../app/src/main/assets/user_profile.html');
  const profileSave = profileHtml.slice(profileHtml.indexOf('async function saveProfile'));
  assert.ok(profileSave.indexOf('faxFieldError(') >= 0);
  assert.ok(profileSave.indexOf('faxFieldError(') < profileSave.indexOf(".from('user_profiles')"));
  assert.match(companyHtml, /Fax must look like a phone number \(7–20 digits\)\./);
  assert.match(profileHtml, /Fax must look like a phone number \(7–20 digits\)\./);
});
