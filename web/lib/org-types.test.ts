import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ORG_TYPES,
  isManufacturerOrgType,
  isOwnerOrgType,
  isServiceOrgType,
  isSupplierOrgType,
} from './org-types.ts';
import { getDashboardPersona, isManufacturer, isServiceCompany } from './roles.ts';
import { orgTypeLabel } from './labels.ts';
import { orgTypeSchema } from './schemas.ts';

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
  assert.equal(isServiceCompany('manufacturer', 'manufacturer'), false);
  assert.equal(isServiceCompany('company_admin', 'manufacturer'), false);
  assert.equal(isManufacturer('manufacturer', 'manufacturer'), true);
  assert.equal(getDashboardPersona('manufacturer', 'manufacturer'), 'manufacturer');
  assert.equal(getDashboardPersona('company_admin', 'service_company'), 'service');
  assert.equal(orgTypeLabel('manufacturer'), 'Manufacturer');
  assert.equal(orgTypeSchema.parse('manufacturer'), 'manufacturer');
  assert.throws(() => orgTypeSchema.parse('service_company_oem'));
});
