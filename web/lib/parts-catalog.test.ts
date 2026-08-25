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
  assert.match(modal, /Your price/);
  assert.match(modal, /\+ Add vendor/);
  assert.match(modal, /from\('parts_catalog'\)/);
  assert.match(modal, /from\('part_vendors'\)/);
  assert.match(modal, /storage\.from/);
});
