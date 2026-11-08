import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('parts catalog can add a part with photo and multiple vendors', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, '../app/parts/page.tsx'), 'utf8');
  const modal = readFileSync(join(here, '../components/AddPartModal.tsx'), 'utf8');
  assert.match(page, /\+ Add Part/);
  assert.match(page, /AddPartModal/);
  assert.match(page, /part_vendors/);
  assert.match(modal, /type="file"/);
  assert.match(modal, /Parts inventory/);
  assert.match(modal, /\+ Add vendor/);
  assert.match(modal, /from\('parts_catalog'\)/);
  assert.match(modal, /\/api\/parts\/vendors/);
  assert.match(modal, /\/api\/parts\/photos/);
  assert.doesNotMatch(modal, /sale_price:/);
});

test('catalog cards open a part detail page that can edit the record', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, '../app/parts/page.tsx'), 'utf8');
  const detail = readFileSync(join(here, '../app/parts/[id]/page.tsx'), 'utf8');
  assert.match(page, /href=\{`\/parts\/\$\{part\.id\}`\}/);
  assert.match(detail, /Edit part/);
  assert.match(detail, /\/api\/parts\/catalog/);
  assert.doesNotMatch(detail, /from\('parts_catalog'\)\.update/);
  assert.match(detail, /Vendors/);
  assert.match(detail, /AddVendorModal/);
});

test('part detail can mark in stock and set quantity on hand', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const detail = readFileSync(join(here, '../app/parts/[id]/page.tsx'), 'utf8');
  assert.match(detail, /In stock/);
  assert.match(detail, /Quantity in stock/);
  assert.match(detail, /in_stock/);
  assert.match(detail, /quantity_on_hand/);
  assert.match(detail, /persistStock/);
});

test('sale price is shown; vendor names and costs stay hidden until revealed', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, '../app/parts/page.tsx'), 'utf8');
  const detail = readFileSync(join(here, '../app/parts/[id]/page.tsx'), 'utf8');
  const modal = readFileSync(join(here, '../components/AddPartModal.tsx'), 'utf8');
  assert.match(page, /Show vendors/);
  assert.match(page, /showVendors/);
  assert.match(page, /useState\(false\)/);
  assert.match(page, /Prices stay in your inventory/);
  assert.match(detail, /Show vendors/);
  assert.match(detail, /showVendors/);
  assert.match(detail, /Names are hidden/);
  assert.match(detail, /Parts inventory/);
  assert.doesNotMatch(modal, /sale_price:/);
  assert.doesNotMatch(modal, /Vendor cost/);
  assert.doesNotMatch(page, /sale_price/);
  assert.doesNotMatch(detail, /unit_cost/);
});
