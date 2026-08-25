import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('parts catalog can add a part with photo, price, and multiple vendors', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, '../app/parts/page.tsx'), 'utf8');
  const modal = readFileSync(join(here, '../components/AddPartModal.tsx'), 'utf8');
  assert.match(page, /\+ Add Part/);
  assert.match(page, /AddPartModal/);
  assert.match(page, /part_vendors/);
  assert.match(modal, /type="file"/);
  assert.match(modal, /Sale price/);
  assert.match(modal, /\+ Add vendor/);
  assert.match(modal, /from\('parts_catalog'\)/);
  assert.match(modal, /from\('part_vendors'\)/);
  assert.match(modal, /storage\.from/);
});

test('catalog cards open a part detail page that can edit the record', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, '../app/parts/page.tsx'), 'utf8');
  const detail = readFileSync(join(here, '../app/parts/[id]/page.tsx'), 'utf8');
  assert.match(page, /href=\{`\/parts\/\$\{part\.id\}`\}/);
  assert.match(detail, /Edit part/);
  assert.match(detail, /from\('parts_catalog'\)\.update/);
  assert.match(detail, /Vendors/);
  assert.match(detail, /AddVendorModal/);
});

test('sale price and vendor cost are stored separately and hidden by default', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, '../app/parts/page.tsx'), 'utf8');
  const detail = readFileSync(join(here, '../app/parts/[id]/page.tsx'), 'utf8');
  const modal = readFileSync(join(here, '../components/AddPartModal.tsx'), 'utf8');
  assert.match(page, /Show sale prices/);
  assert.match(page, /useState\(false\)/);
  assert.match(page, /showSalePrices/);
  assert.match(detail, /Show prices/);
  assert.match(detail, /useState\(false\)/);
  assert.match(detail, /showPrices/);
  assert.match(detail, /Sale price/);
  assert.match(detail, /showPrices \? money\(v\.unit_cost\) : '•••'/);
  assert.match(modal, /sale_price:/);
  assert.match(modal, /Vendor cost/);
  assert.doesNotMatch(modal, /unit_cost:\s*salePrice/);
  assert.doesNotMatch(detail, /unit_cost:\s*\n\s*form\.sale_price/);
});
