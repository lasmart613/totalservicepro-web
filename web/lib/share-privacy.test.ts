import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicShareRequestRow } from './share-request-public.ts';
import { publicSellerView, storefrontAbout } from './marketplace/storefront.ts';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(web, p), 'utf8');

test('F-1: share/listing validates the uuid, returns generic errors, and drops serial + Stripe ids', () => {
  const src = read('app/api/share/listing/[id]/route.ts');
  assert.match(src, /LISTING_ID_RE = \/\^\[0-9a-f\]\{8\}-/);
  assert.match(src, /if \(!LISTING_ID_RE\.test\(id\)\)[\s\S]{0,80}'Not found' \}, \{ status: 404 \}/);
  assert.doesNotMatch(src, /error: error\.message|error: e instanceof Error \? e\.message|hint:/);
  const selects = src.slice(src.indexOf('SHARE_LISTING_SELECTS = ['), src.indexOf('];', src.indexOf('SHARE_LISTING_SELECTS = [')));
  assert.doesNotMatch(selects, /serial_number|stripe_product_id|stripe_price_id/);
  assert.match(src, /serial_number: undefined,\s*stripe_product_id: undefined,\s*stripe_price_id: undefined/);
  // The share pages never read Stripe ids.
  for (const p of ['app/marketplace/listing/[id]/page.tsx', 'app/marketplace/parts/[id]/page.tsx']) {
    assert.doesNotMatch(read(p), /stripe_product_id|stripe_price_id/);
  }
});

test("F-2: share/request never uses the requesting org's city", () => {
  const row = publicShareRequestRow({ id: 'r1', city: null, state: null }, { name: 'Clinic', city: 'Dallas', state: 'TX' } as any);
  assert.equal(row.city, null);
  assert.equal(row.state, 'TX');
  assert.equal(row.organization_name, 'Clinic');
  assert.doesNotMatch(JSON.stringify(row), /Dallas/);
  const own = publicShareRequestRow({ id: 'r2', city: 'Austin', state: 'TX' }, null);
  assert.equal(own.city, 'Austin');
  const src = read('app/api/share/request/[id]/route.ts');
  assert.match(src, /\.select\('name, state'\)/);
  assert.doesNotMatch(src, /'name, city, state'|hint:/);
});

test('F-2: seller org view: non-storefront sellers expose only id/name/type; notes never become a bio', () => {
  const plain = { id: 7, name: 'Seller', type: 'service_company', email: 'x@y.z', phone: '1', city: 'Reno', storefront_bio: null, notes: 'PRIVATE' } as any;
  assert.deepEqual(publicSellerView(plain), { id: 7, name: 'Seller', type: 'service_company' });
  assert.equal(publicSellerView(null), null);
  assert.equal(storefrontAbout({ notes: 'PRIVATE internal note' } as any), '');
  assert.equal(storefrontAbout({ storefront_bio: 'We sell parts' } as any), 'We sell parts');
  const server = read('lib/marketplace/storefront-server.ts');
  const selects = server.slice(server.indexOf('STOREFRONT_ORG_SELECTS = ['), server.indexOf('] as const'));
  assert.doesNotMatch(selects, /\bnotes\b|tax_id|stripe_/);
  assert.match(server, /resolveListingStorefront[\s\S]{0,200}loadPublicSellerOrg\(organizationId\)/);
});
