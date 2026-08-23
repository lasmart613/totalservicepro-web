import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ORG_TYPES,
  isManufacturerOrgType,
  isOwnerOrgType,
  isServiceOrgType,
  isSupplierOrgType,
} from './org-types.ts';
import { orgTypeLabel } from './labels.ts';

test('manufacturer is a first-class type, not a service_company tag', () => {
  assert.ok((ORG_TYPES as readonly string[]).includes('manufacturer'));
  assert.ok((ORG_TYPES as readonly string[]).includes('service_company'));
  assert.ok((ORG_TYPES as readonly string[]).includes('customer'));
  assert.ok((ORG_TYPES as readonly string[]).includes('parts_supplier'));
  assert.ok((ORG_TYPES as readonly string[]).includes('laser_clinic'));
  assert.ok((ORG_TYPES as readonly string[]).includes('laser_rental'));
  assert.ok((ORG_TYPES as readonly string[]).includes('laser_reseller'));
  assert.equal(isManufacturerOrgType('manufacturer'), true);
  assert.equal(isManufacturerOrgType('service_company'), false);
  assert.equal(isServiceOrgType('manufacturer'), false);
  assert.equal(isOwnerOrgType('manufacturer'), false);
  assert.equal(isSupplierOrgType('manufacturer'), false);
  assert.equal(orgTypeLabel('manufacturer'), 'Manufacturer');
  const here = dirname(fileURLToPath(import.meta.url));
  const schemas = readFileSync(join(here, './schemas.ts'), 'utf8');
  assert.match(schemas, /orgTypeSchema = z\.enum\(ORG_TYPES\)/);
});

test('role helpers treat manufacturer as its own persona', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const roles = readFileSync(join(here, './roles.ts'), 'utf8');
  assert.match(roles, /isManufacturer/);
  assert.match(roles, /isOwnerish\(role, orgType\) \|\| isSupplier\(role, orgType\) \|\| isManufacturer\(role, orgType\)/);
  assert.match(roles, /if \(isManufacturer\(role, orgType\)\) return 'manufacturer'/);
  assert.doesNotMatch(roles, /manufacturer.*service_company/);
});
