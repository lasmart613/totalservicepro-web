/** get-manual-url's AI catalog gate uses the shared Repair AI rule (service-company owners allowed). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canAccessRepairAi } from '../../supabase/functions/_shared/repair-ai.ts';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../../supabase/functions/get-manual-url/index.ts'), 'utf8');

function extractIsRepairAiCaller(): (role: unknown, orgType: unknown) => boolean {
  const start = src.indexOf('function isRepairAiCaller(');
  const end = src.indexOf('\nfunction mayViewAiCatalog');
  const body = src.slice(start, end).replace(/\(role: unknown, orgType: unknown\): boolean/, '(role, orgType)');
  return new Function('canAccessRepairAi', `${body}; return isRepairAiCaller;`)(canAccessRepairAi);
}

test('get-manual-url imports the shared rule instead of its own copy', () => {
  assert.match(src, /import \{ canAccessRepairAi \} from "\.\.\/_shared\/repair-ai\.ts";/);
  assert.doesNotMatch(src, /r === "owner" \|\|/);
});

test('isRepairAiCaller: service-company owner allowed; other owners, suppliers, customers denied', () => {
  const f = extractIsRepairAiCaller();
  assert.equal(f('owner', 'service_company'), true);
  assert.equal(f('owner', 'Service Company'), true, 'spacing normalized like before');
  assert.equal(f('company_admin', 'service_company'), true);
  assert.equal(f('fse', 'service_company'), true);
  for (const t of ['customer', 'laser_clinic', 'laser_rental', 'laser_reseller', 'parts_supplier', 'vendor', '']) {
    assert.equal(f('owner', t), false, `owner/${t}`);
  }
  assert.equal(f('parts_supplier', 'parts_supplier'), false);
  assert.equal(f('customer', 'service_company'), false);
  assert.equal(f(null, null), false);
});
