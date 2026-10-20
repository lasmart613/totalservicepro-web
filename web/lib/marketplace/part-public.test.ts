import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripPrivatePartFields, viewerSeesPartSerial } from './part-public.ts';

const web = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(join(web, p), 'utf8');

const row = {
  id: 'l1',
  title: 'Handpiece',
  serial_number: 'SN-123',
  part_number: 'PN-9',
  stripe_product_id: 'prod_x',
  stripe_price_id: 'price_x',
  seller_id: 'u-seller',
  created_by: 'u-seller',
  organization_id: 'org-s',
  details: { seller_email: 'a@b.c', nested: { price_stripe_id: 'p', keep: 1 }, list: [{ Contact_Phone: '1', ok: true }] },
};

test('B: serial only for the owner or seller-org members', () => {
  assert.equal(viewerSeesPartSerial(row, null), false);
  assert.equal(viewerSeesPartSerial(row, { userId: 'u-other', orgId: 'org-other' }), false);
  assert.equal(viewerSeesPartSerial(row, { userId: 'u-other', orgId: 'org-other', role: 'admin' }), false);
  assert.equal(viewerSeesPartSerial(row, { userId: 'u-seller' }), true);
  assert.equal(viewerSeesPartSerial(row, { userId: 'u-tech', orgId: 'org-s', role: 'technician' }), true);
  assert.equal(viewerSeesPartSerial(row, { userId: 'u-m', orgId: 'x', membershipOrgIds: ['org-s'] }), true);
  assert.equal(viewerSeesPartSerial({ ...row, organization_id: null, seller_id: null, created_by: null }, { userId: 'u', orgId: 'org-s' }), false);
});

test('B: Stripe ids always dropped; serial dropped unless revealed; details sanitized', () => {
  const pub = stripPrivatePartFields(row, false) as Record<string, unknown>;
  assert.ok(!('serial_number' in pub));
  assert.ok(!('stripe_product_id' in pub));
  assert.ok(!('stripe_price_id' in pub));
  assert.equal(pub.part_number, 'PN-9');
  assert.deepEqual(pub.details, { nested: { keep: 1 }, list: [{ ok: true }] });
  const mine = stripPrivatePartFields(row, true) as Record<string, unknown>;
  assert.equal(mine.serial_number, 'SN-123');
  assert.ok(!('stripe_price_id' in mine));
  assert.equal(row.stripe_price_id, 'price_x', 'input not mutated');
});

test('B: parts list, detail and storefront routes use the helpers', () => {
  for (const p of ['app/api/marketplace/parts/route.ts', 'app/api/marketplace/parts/[id]/route.ts']) {
    const src = read(p);
    assert.match(src, /stripPrivatePartFields\(/, p);
    assert.match(src, /viewerSeesPartSerial\(/, p);
    assert.doesNotMatch(src, /\.\.\.row,\n|\.\.\.listing,\n/, p);
  }
  const store = read('app/api/marketplace/sellers/[slug]/route.ts');
  assert.doesNotMatch(store, /serial_number: signedIn/);
  assert.match(store, /viewerSeesPartSerial\(/);
});
