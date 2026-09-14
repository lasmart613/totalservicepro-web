import assert from 'node:assert/strict';
import test from 'node:test';
import {
  capImportPhotos,
  indexListingsBySku,
  listingPayloadFromRow,
  listingSkuKey,
  previewCatalogImport,
} from './catalog-import.ts';
import type { CatalogParsedRow } from './catalog-upload.ts';
import { FREE_LISTING_PHOTO_LIMIT, PAID_LISTING_PHOTO_LIMIT } from './storefront.ts';

function row(partial: Partial<CatalogParsedRow>): CatalogParsedRow {
  return {
    rowNumber: 1,
    catalogKind: 'part',
    sku: 'PSU-1044',
    title: 'Candela GentleMax power supply',
    brand: 'Candela',
    model: 'GentleMax',
    condition: 'New',
    price: 890,
    qty: 3,
    description: 'OEM HV PSU',
    category: 'part',
    photoUrls: ['https://cdn.example/psu.jpg'],
    raw: {},
    status: 'pending',
    errorMessage: null,
    ...partial,
  };
}

test('SKU key matches part_number or details.sku', () => {
  assert.equal(listingSkuKey({ part_number: 'PSU-1044' }), 'psu-1044');
  assert.equal(listingSkuKey({ details: { sku: 'PSU-1044' } }), 'psu-1044');
  assert.equal(listingSkuKey({ title: 'No sku' }), null);
});

test('re-upload with the same SKU previews an update, not a duplicate', () => {
  const existing = [
    {
      id: 'listing-1',
      part_number: 'PSU-1044',
      title: 'Old title',
      details: { sku: 'PSU-1044' },
    },
  ];
  const { preview, counts } = previewCatalogImport({
    rows: [row({ qty: 8, price: 910 })],
    existing,
    organizationId: 44,
    userId: 'user-1',
    sellerOrgName: 'Luxor Photonix',
    paidPhotos: true,
  });
  assert.equal(counts.update, 1);
  assert.equal(counts.create, 0);
  assert.equal(preview[0].action, 'update');
  assert.equal(preview[0].existingListingId, 'listing-1');
});

test('unknown SKU creates a parts listing payload with seller org', () => {
  const { preview, commits, counts } = previewCatalogImport({
    rows: [row()],
    existing: [],
    organizationId: 44,
    userId: 'user-1',
    sellerOrgName: 'Luxor Photonix',
    paidPhotos: true,
  });
  assert.equal(counts.create, 1);
  assert.equal(preview[0].action, 'create');
  assert.equal(commits[0].payload.listing_type, 'part');
  assert.equal(commits[0].payload.part_number, 'PSU-1044');
  assert.equal(commits[0].payload.organization_id, 44);
  const details = commits[0].payload.details as { seller_org_name?: string; sku?: string };
  assert.equal(details.seller_org_name, 'Luxor Photonix');
  assert.equal(details.sku, 'PSU-1044');
});

test('duplicate SKU later in the file is skipped', () => {
  const { counts, preview } = previewCatalogImport({
    rows: [row({ rowNumber: 1 }), row({ rowNumber: 2, title: 'Second copy' })],
    existing: [],
    organizationId: 1,
    userId: 'u',
    paidPhotos: true,
  });
  assert.equal(counts.create, 1);
  assert.equal(counts.skip, 1);
  assert.equal(preview[1].action, 'skip');
});

test('rows without title or SKU stay errors', () => {
  const { counts } = previewCatalogImport({
    rows: [row({ sku: null, title: null, status: 'error', errorMessage: 'Each row needs a title or SKU.' })],
    existing: [],
    organizationId: 1,
    userId: 'u',
    paidPhotos: true,
  });
  assert.equal(counts.error, 1);
});

test('photo cap respects Free 1 vs Premium/Team 8', () => {
  const urls = Array.from({ length: 10 }, (_, i) => `https://cdn.example/${i}.jpg`);
  assert.equal(capImportPhotos(urls, false).length, FREE_LISTING_PHOTO_LIMIT);
  assert.equal(capImportPhotos(urls, true).length, PAID_LISTING_PHOTO_LIMIT);
});

test('payload maps brand/model/qty onto marketplace_listings columns', () => {
  const payload = listingPayloadFromRow({
    row: row({ model: 'GentleMax / GentleMax Pro' }),
    organizationId: 9,
    userId: 'u1',
    sellerOrgName: 'Luxor Photonix',
    paidPhotos: true,
  });
  assert.equal(payload.manufacturer, 'Candela');
  assert.equal(payload.model, 'GentleMax / GentleMax Pro');
  assert.equal(payload.quantity, 3);
  assert.equal((payload.details as { compatible_models?: string }).compatible_models, 'GentleMax / GentleMax Pro');
});

test('indexListingsBySku keeps the first listing for a SKU', () => {
  const map = indexListingsBySku([
    { id: 'a', part_number: 'X-1' },
    { id: 'b', part_number: 'X-1' },
  ]);
  assert.equal(map.get('x-1')?.id, 'a');
});
