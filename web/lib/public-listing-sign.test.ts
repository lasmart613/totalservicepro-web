import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isPublicListingObject, listingPathOwner, publicListingObjectKeys } from './public-listing-sign.ts';

const U = '0d04a116-38a8-4ba0-8738-7981e398f551';
const V = '11111111-2222-4333-8444-555555555555';
const base = 'https://yljztfajyvjzqikxdddf.supabase.co/storage/v1/object/public';

test('listingPathOwner accepts only {uuid}/listings/{file}', () => {
  assert.equal(listingPathOwner(`${U}/listings/1_0.jpg`), U);
  assert.equal(listingPathOwner(`parts/${U}/1_0.jpg`), null);
  assert.equal(listingPathOwner(`2655/equipment/1.jpg`), null);
  assert.equal(listingPathOwner(`${U}/listings/../x.jpg`), null);
  assert.equal(listingPathOwner(`${U}/listings/a/b.jpg`), null);
  assert.equal(listingPathOwner(`not-a-uuid/listings/a.jpg`), null);
});

test('only paths referenced by a public listing of that seller are signable', () => {
  const keys = publicListingObjectKeys([
    { status: 'active', seller_id: U, images: [`${base}/equipment-photos/${U}/listings/1_0.jpg`], photos: [] },
    { status: 'removed', seller_id: U, images: [`${base}/equipment-photos/${U}/listings/2_0.jpg`] },
    { status: 'draft', seller_id: U, images: [`${base}/marketplace-images/${U}/listings/3_0.jpg`] },
    // listing of V pointing at U's folder is ignored
    { status: 'active', seller_id: V, images: [`${base}/equipment-photos/${U}/listings/4_0.jpg`] },
    { status: 'active', created_by: U, photos: [`${base}/marketplace-images/${U}/listings/5_0.jpg`] },
  ]);
  assert.ok(isPublicListingObject(keys, 'equipment-photos', `${U}/listings/1_0.jpg`));
  assert.ok(isPublicListingObject(keys, 'marketplace-images', `${U}/listings/5_0.jpg`));
  assert.ok(!isPublicListingObject(keys, 'equipment-photos', `${U}/listings/2_0.jpg`), 'removed listing');
  assert.ok(!isPublicListingObject(keys, 'marketplace-images', `${U}/listings/3_0.jpg`), 'draft listing');
  assert.ok(!isPublicListingObject(keys, 'equipment-photos', `${U}/listings/4_0.jpg`), 'other seller');
  assert.ok(!isPublicListingObject(keys, 'equipment-photos', `${U}/listings/9_9.jpg`), 'unreferenced guess');
  assert.ok(!isPublicListingObject(keys, 'equipment-photos', `2655/equipment/1.jpg`));
});

test('signed-urls route gates service-role signing on public listing keys', () => {
  const src = readFileSync(new URL('../app/api/storage/signed-urls/route.ts', import.meta.url), 'utf8');
  assert.match(src, /publicListingObjectKeys/);
  assert.match(src, /isPublicListingObject\(publicKeys/);
  assert.match(src, /apply\(getSupabaseAdmin\(\), serviceItems\)/);
});
