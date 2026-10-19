import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicShareRequestRow } from './share-request-public.ts';
import { sanitizeShareListingDetails } from './share-listing-public.ts';
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


test('QA #325 L-1: share listing details drop every stripe* key and seller contact', () => {
  const out = sanitizeShareListingDetails({
    stripe_price_id: 'price_1',
    stripe_product_id: 'prod_1',
    stripe_price_cents: 100,
    StripeAccount: 'acct_1',
    seller_email: 'a@b.c',
    contact_phone: '1',
    hours: 1200,
  });
  assert.deepEqual(out, { hours: 1200 });
  assert.equal(sanitizeShareListingDetails(null), null);
  assert.match(read('app/api/share/listing/[id]/route.ts'), /sanitizeShareListingDetails\(data\.details\)/);
});

test('QA #325: /api/share/request/<non-uuid> is a 404 before any DB call', () => {
  const src = read('app/api/share/request/[id]/route.ts');
  const guard = src.indexOf('REQUEST_ID_RE.test(id)');
  assert.ok(guard > 0);
  assert.ok(guard < src.indexOf('getSupabaseAdmin('), 'uuid check precedes the DB client');
  assert.match(src.slice(guard, guard + 200), /status: 404/);
});

test('QA #325 r2: share listing details sanitize recursively, case-insensitive', () => {
  const out = sanitizeShareListingDetails({
    price_stripe_id: 'x',
    Seller_Email: 'a@b.c',
    CONTACT_PHONE: '1',
    specs: { hours: 5, meta: { StripeRef: 'r', ok: true }, seller_phone: '2' },
    options: [{ name: 'A', my_stripe_price: 'p', contact_email: 'e' }, 'plain', 3, null, [{ stripe: 1, k: 2 }]],
  });
  assert.deepEqual(out, {
    specs: { hours: 5, meta: { ok: true } },
    options: [{ name: 'A' }, 'plain', 3, null, [{ k: 2 }]],
  });
  assert.doesNotMatch(JSON.stringify(out), /stripe|seller_|contact_/i);
  assert.deepEqual(sanitizeShareListingDetails([{ stripe_id: 1 }]), [{}]);
  assert.equal(sanitizeShareListingDetails('s'), 's');
});
