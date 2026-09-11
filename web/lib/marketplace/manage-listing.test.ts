import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildListingRemovePayload,
  buildListingUpdatePayload,
  mergeListingDetails,
} from './manage-listing.ts';

test('update payload writes seller fields and preserves Stripe ids in details', () => {
  const payload = buildListingUpdatePayload(
    {
      title: '  AcuPulse cable  ',
      description: 'OEM fiber',
      price: '125.50',
      part_number: ' AP-1 ',
      quantity: '3',
      images: ['https://cdn.example/a.jpg'],
      details: { sku: 'SKU-1', stripe_product_id: 'prod_hack' },
    },
    { details: { stripe_product_id: 'prod_real', stripe_price_id: 'price_real', warranty: '90 days' } }
  );

  assert.equal(payload.title, 'AcuPulse cable');
  assert.equal(payload.part_number, 'AP-1');
  assert.equal(payload.price, 125.5);
  assert.equal(payload.quantity, 3);
  assert.equal(payload.qty, 3);
  assert.deepEqual(payload.images, ['https://cdn.example/a.jpg']);
  assert.deepEqual(payload.photos, ['https://cdn.example/a.jpg']);
  const details = payload.details as Record<string, unknown>;
  assert.equal(details.sku, 'SKU-1');
  assert.equal(details.warranty, '90 days');
  assert.equal(details.quantity_available, 3);
  assert.equal(details.stripe_product_id, 'prod_real');
  assert.equal(details.stripe_price_id, 'price_real');
  assert.equal(typeof payload.updated_at, 'string');
});

test('contact price clears the stored amount', () => {
  const payload = buildListingUpdatePayload({ price: 99, price_type: 'contact' });
  assert.equal(payload.price, null);
  assert.equal(payload.price_type, 'contact');
});

test('only active/removed status may be set from the seller form', () => {
  assert.equal(buildListingUpdatePayload({ status: 'removed' }).status, 'removed');
  assert.equal(buildListingUpdatePayload({ status: 'active' }).status, 'active');
  assert.equal(buildListingUpdatePayload({ status: 'sold' }).status, undefined);
});

test('soft-remove keeps history via status=removed', () => {
  const payload = buildListingRemovePayload();
  assert.equal(payload.status, 'removed');
  assert.equal(typeof payload.updated_at, 'string');
});

test('mergeListingDetails does not copy seller_id or ownership keys', () => {
  const merged = mergeListingDetails({ sku: 'A' }, { sku: 'B', seller_id: 'nope' } as Record<string, unknown>);
  assert.equal(merged.sku, 'B');
  assert.equal(merged.seller_id, undefined);
});

test('parts manage API authorizes owners and soft-deletes', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../../app/api/marketplace/parts/[id]/route.ts'), 'utf8');
  assert.match(src, /export async function PATCH/);
  assert.match(src, /export async function DELETE/);
  assert.match(src, /canManageMarketplaceListing/);
  assert.match(src, /buildListingRemovePayload/);
  assert.match(src, /status: 403/);
});

test('public parts catalog hides removed listings', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../../app/marketplace/parts/page.tsx'), 'utf8');
  assert.match(source, /isPublicListingStatus/);
});

test('seller UI exposes Edit and Remove on the parts detail and my-listings pages', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const detail = readFileSync(join(here, '../../app/marketplace/parts/[id]/page.tsx'), 'utf8');
  const mine = readFileSync(join(here, '../../app/marketplace/my-listings/page.tsx'), 'utf8');
  const edit = readFileSync(join(here, '../../app/marketplace/parts/[id]/edit/page.tsx'), 'utf8');
  assert.match(detail, /Edit listing/);
  assert.match(detail, /Remove listing/);
  assert.match(mine, /partsEditPath/);
  assert.match(mine, /Remove/);
  assert.match(edit, /Save changes/);
});
