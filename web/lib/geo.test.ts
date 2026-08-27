import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRegionInput, normalizeStateCode } from './geo.ts';
import { customerOrgPayload, emptyCustomerForm } from './customer-form.ts';

test('maps US state names and abbreviations to 2-letter codes', () => {
  assert.deepEqual(normalizeRegionInput('Texas'), { state: 'TX', country: 'USA' });
  assert.deepEqual(normalizeRegionInput('california'), { state: 'CA', country: 'USA' });
  assert.deepEqual(normalizeRegionInput('tx'), { state: 'TX', country: 'USA' });
  assert.deepEqual(normalizeRegionInput('IL'), { state: 'IL', country: 'USA' });
  assert.equal(normalizeStateCode('New York'), 'NY');
});

test('maps country names so they are not stored in a CHAR(3) state column', () => {
  assert.deepEqual(normalizeRegionInput('United States'), { state: null, country: 'USA' });
  assert.deepEqual(normalizeRegionInput('USA'), { state: null, country: 'USA' });
  assert.deepEqual(normalizeRegionInput('US'), { state: null, country: 'USA' });
  assert.deepEqual(normalizeRegionInput('Canada'), { state: null, country: 'CAN' });
});

test('maps Canadian provinces', () => {
  assert.deepEqual(normalizeRegionInput('Ontario'), { state: 'ON', country: 'CAN' });
  assert.deepEqual(normalizeRegionInput('bc'), { state: 'BC', country: 'CAN' });
});

test('customer org payload stores TX not Texas, and keeps a US ZIP', () => {
  const form = {
    ...emptyCustomerForm(),
    name: 'Northshore Clinic',
    state: 'Texas',
    zip: '60601',
    city: 'Chicago',
  };
  const payload = customerOrgPayload(form, { type: 'customer' });
  assert.equal(payload.state, 'TX');
  assert.equal(payload.zip, '60601');
  assert.equal(payload.type, 'customer');
  assert.equal(payload.country, 'USA');
  assert.ok(String(payload.state).length <= 3);
});

test('United States typed in State is not written to organizations.state', () => {
  const form = { ...emptyCustomerForm(), name: 'Clinic', state: 'United States' };
  const payload = customerOrgPayload(form);
  assert.equal(payload.state, null);
});
