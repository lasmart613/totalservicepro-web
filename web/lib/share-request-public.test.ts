import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { OPEN_SERVICE_REQUEST_COLUMNS, publicShareRequestRow, SHARE_REQUEST_SELECT } from './share-request-public.ts';

const row = {
  id: 'r1', title: 'T', description: 'D', status: 'open', urgency: 'high', manufacturer: 'Candela', model: 'GentleMax',
  service_type: 'repair', city: '', state: null, location: 'L', category: 'laser', created_at: '2026-10-18', budget_max: 500,
  organization_id: 2655, serial_number: 'SN-SECRET', error_codes: 'E42', preferred_date: '2026-10-20', posted_by: 'u', contact_email: 'x@y',
};

test('share select is exactly the open_service_requests column set', () => {
  assert.deepEqual(SHARE_REQUEST_SELECT.split(', '), [...OPEN_SERVICE_REQUEST_COLUMNS]);
  for (const banned of ['serial_number', 'error_codes', 'preferred_date', 'posted_by', 'awarded']) {
    assert.ok(!SHARE_REQUEST_SELECT.includes(banned), banned);
  }
});

test('public share row drops serial, error codes, preferred date and org id', () => {
  const out = publicShareRequestRow(row, { name: 'QA Clinic', city: 'Phoenix', state: 'AZ' }) as Record<string, unknown>;
  for (const banned of ['serial_number', 'error_codes', 'preferred_date', 'posted_by', 'contact_email', 'organization_id']) {
    assert.ok(!(banned in out), banned);
  }
  assert.equal(out.organization_name, 'QA Clinic');
  assert.equal(out.city, 'Phoenix');
  assert.equal(out.state, 'AZ');
  assert.equal(out._public_share, true);
  assert.ok(!JSON.stringify(out).includes('SN-SECRET'));
  assert.ok(!JSON.stringify(out).includes('E42'));
});

test('route uses the shared select and does not echo DB errors', () => {
  const src = readFileSync(new URL('../app/api/share/request/[id]/route.ts', import.meta.url), 'utf8');
  assert.match(src, /\.select\(SHARE_REQUEST_SELECT\)/);
  assert.doesNotMatch(src, /serial_number|error_codes|preferred_date/);
  assert.doesNotMatch(src, /error\.message \}/);
});
