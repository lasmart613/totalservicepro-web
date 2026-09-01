import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessRepairAi,
  canAccessServiceManuals,
  canAssignShopTestEquipment,
  canSeeAllShopTickets,
  isAdmin,
  isFieldEngineer,
} from './roles.ts';

test('Larry Admin / Owner map to existing admin and owner roles', () => {
  assert.equal(isAdmin('admin'), true);
  assert.equal(isAdmin('company_admin'), true);
  assert.equal(isAdmin('Company_Admin'), true);
  assert.equal(canSeeAllShopTickets('admin'), true);
  assert.equal(canSeeAllShopTickets('company_admin'), true);
  assert.equal(canSeeAllShopTickets('owner'), true);
});

test('Larry Scheduler / Dispatcher map to existing roster roles', () => {
  assert.equal(canSeeAllShopTickets('scheduler'), true);
  assert.equal(canSeeAllShopTickets('dispatcher'), true);
  assert.equal(canSeeAllShopTickets('service_manager'), true);
  assert.equal(canSeeAllShopTickets('billing_manager'), true);
});

test('Larry FSE maps to fse / engineer / technician only', () => {
  assert.equal(isFieldEngineer('fse'), true);
  assert.equal(isFieldEngineer('engineer'), true);
  assert.equal(isFieldEngineer('technician'), true);
  assert.equal(isFieldEngineer('FSE'), true);
  assert.equal(isFieldEngineer('dispatcher'), false);
  assert.equal(isFieldEngineer('admin'), false);
  assert.equal(canSeeAllShopTickets('fse'), false);
  assert.equal(canSeeAllShopTickets('engineer'), false);
  assert.equal(canSeeAllShopTickets('technician'), false);
});

test('unknown or empty role does not get the full shop schedule', () => {
  assert.equal(canSeeAllShopTickets(''), false);
  assert.equal(canSeeAllShopTickets(null), false);
  assert.equal(canSeeAllShopTickets('viewer'), false);
  assert.equal(canSeeAllShopTickets('crm'), false);
});

test('service manuals and repair AI are service-company only', () => {
  assert.equal(canAccessServiceManuals('fse', 'service_company'), true);
  assert.equal(canAccessRepairAi('admin', 'service_company'), true);
  assert.equal(canAccessServiceManuals('owner', 'laser_clinic'), false);
  assert.equal(canAccessRepairAi('owner', 'laser_clinic'), false);
  assert.equal(canAccessServiceManuals('parts_supplier', 'parts_supplier'), false);
  assert.equal(canAccessRepairAi('supplier', 'vendor'), false);
});

test('admin and owner can assign shop test equipment', () => {
  assert.equal(canAssignShopTestEquipment('admin'), true);
  assert.equal(canAssignShopTestEquipment('company_admin'), true);
  assert.equal(canAssignShopTestEquipment('owner'), true);
  assert.equal(canAssignShopTestEquipment('service_manager'), true);
  assert.equal(canAssignShopTestEquipment('fse'), false);
  assert.equal(canAssignShopTestEquipment('technician'), false);
});
