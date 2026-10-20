import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMarketplaceListingId } from './listing-id.ts';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string) => readFileSync(join(webDir, p), 'utf8');

test('isMarketplaceListingId accepts uuids only', () => {
  assert.equal(isMarketplaceListingId('3f2b8c1e-9a4d-4e2b-8f61-0c7d5a9e1b23'), true);
  assert.equal(isMarketplaceListingId('3F2B8C1E-9A4D-4E2B-8F61-0C7D5A9E1B23'), true);
  for (const bad of ['abc', '', '123', "1' or '1'='1", '3f2b8c1e-9a4d-4e2b-8f61-0c7d5a9e1b2', null, undefined, 42]) {
    assert.equal(isMarketplaceListingId(bad), false, String(bad));
  }
});

test('GET /api/marketplace/parts/[id]: non-uuid -> 404 before any DB read; 500 never echoes DB text', () => {
  const src = read('app/api/marketplace/parts/[id]/route.ts');
  const get = src.slice(src.indexOf('export async function GET'), src.indexOf('async function requireManager'));
  const guard = get.indexOf('if (!isMarketplaceListingId(id)) return NextResponse.json({ error: \'Listing not found\' }, { status: 404 });');
  assert.ok(guard > 0, 'uuid guard in GET');
  assert.ok(guard < get.indexOf('loadMarketplaceListing(id)'), 'guard runs before the DB read');
  assert.match(get, /status >= 500 && status !== 503 \? 'Server error'/);
  const mgr = src.slice(src.indexOf('async function requireManager'));
  assert.ok(mgr.indexOf('isMarketplaceListingId(id)') < mgr.indexOf('loadMarketplaceListing(id)'), 'PATCH/DELETE guard too');
});

test('invoice form: Pulse count only for laser, and not saved otherwise', () => {
  const src = read('app/invoices/new/InvoiceFormClient.tsx');
  assert.match(src, /const showPulseCount = equipmentType === 'laser';/);
  assert.match(src, /\{showPulseCount && \(\s*<div>\s*<label[^>]*>\{t\('Pulse count'\)\}/);
  assert.match(src, /pulse_count: showPulseCount \? pulseCount : ''/);
  assert.ok(!/pulse_count: pulseCount,/.test(src));
});
