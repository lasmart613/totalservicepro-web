import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PARTS_CATALOG_COLUMNS,
  partsCatalogManufacturerLabel,
  partsCatalogWritePayload,
} from './parts-catalog-columns.ts';

test('parts catalog writes brand and drops manufacturer and image_urls', () => {
  const row = partsCatalogWritePayload({
    part_number: 'PN-1',
    name: 'Flashlamp',
    manufacturer: 'Candela',
    description: 'Lamp',
    category: 'Consumables',
    image_urls: ['https://cdn.example/a.webp', 'https://cdn.example/b.webp'],
    sale_price: 12,
    is_active: true,
  });
  assert.equal(row.brand, 'Candela');
  assert.equal(row.image_url, 'https://cdn.example/a.webp');
  assert.equal('manufacturer' in row, false);
  assert.equal('image_urls' in row, false);
  for (const key of Object.keys(row)) {
    assert.equal(PARTS_CATALOG_COLUMNS.includes(key as (typeof PARTS_CATALOG_COLUMNS)[number]), true);
  }
  assert.equal(partsCatalogManufacturerLabel({ brand: 'Candela' }), 'Candela');
});

test('explicit brand wins over a manufacturer alias', () => {
  const row = partsCatalogWritePayload({ brand: 'Lumenis', manufacturer: 'Candela', name: 'Head' });
  assert.equal(row.brand, 'Lumenis');
  assert.equal('manufacturer' in row, false);
});

test('supplier catalog select uses brand, not parts_catalog.manufacturer', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const home = readFileSync(join(here, '../components/home/HomeDashboard.tsx'), 'utf8');
  assert.match(home, /from\('parts_catalog'\)\.select\('id, brand'/);
  assert.doesNotMatch(home, /parts_catalog'\)\.select\([^)]*manufacturer/);
  const modal = readFileSync(join(here, '../components/AddPartModal.tsx'), 'utf8');
  assert.match(modal, /partsCatalogWritePayload/);
  assert.doesNotMatch(modal, /manufacturer: resolvedBrand/);
});
