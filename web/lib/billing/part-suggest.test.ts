import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  exactPartSuggest,
  filterPartSuggests,
  fromCatalogRow,
  fromMarketplaceRow,
  mergePartSuggests,
} from './part-suggest.ts';

test('catalog and marketplace rows become suggest hits', () => {
  const cat = fromCatalogRow({
    id: 1,
    part_number: 'HP-1',
    name: 'Handpiece',
    brand: 'Candela',
    sale_price: 900,
    unit_cost: 400,
  });
  assert.equal(cat?.part_number, 'HP-1');
  assert.equal(cat?.unit_price, 400);
  assert.equal(cat?.source, 'catalog');
  const mkt = fromMarketplaceRow({
    id: 'abc',
    title: 'Used flashlamp',
    part_number: 'FL-9',
    price: 125,
    manufacturer: 'Lumenis',
  });
  assert.equal(mkt?.part_number, 'FL-9');
  assert.equal(mkt?.unit_price, 125);
  assert.equal(mkt?.source, 'marketplace');
});

test('same part number prefers catalog over marketplace', () => {
  const merged = mergePartSuggests([
    fromMarketplaceRow({ id: 2, part_number: 'HP-1', title: 'Mkt HP', price: 50 })!,
    fromCatalogRow({ id: 1, part_number: 'HP-1', name: 'Catalog HP', unit_cost: 40 })!,
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'catalog');
  assert.equal(merged[0].unit_price, 40);
});

test('query matches part number or description', () => {
  const hits = [
    fromCatalogRow({ id: 1, part_number: 'CAN-HP-003', name: 'GentleMax handpiece' })!,
    fromMarketplaceRow({ id: 2, part_number: 'XYZ', title: 'Pump diode' })!,
  ];
  assert.equal(filterPartSuggests(hits, 'handpiece').length, 1);
  assert.equal(exactPartSuggest(hits, 'can-hp-003')?.description.includes('GentleMax'), true);
});

test('PO form loads catalog and marketplace parts for the part# field', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../../app/purchase-orders/new/PurchaseOrderFormClient.tsx'), 'utf8');
  assert.match(src, /from\('parts_catalog'\)/);
  assert.match(src, /from\('marketplace_listings'\)/);
  assert.match(src, /filterPartSuggests/);
  assert.match(src, /exactPartSuggest/);
});
