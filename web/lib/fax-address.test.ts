import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADDRESS_LINE2_MAX,
  addressLine2FieldError,
  faxFieldError,
  formatFaxLine,
  formatPostalLines,
  formatPostalQuery,
  formatPostalText,
  normalizeAddressLine2,
  normalizeFax,
} from './fax-address.ts';

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
