import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onboardingOrgUpdatePayload } from './onboarding-org-update';

const base = { name: 'Acme', address: null, list_in_directory: true };

test('000919 rev 2: an unchanged type is never sent on update', () => {
  for (const [existing, sent] of [
    ['service_company', 'service_company'],
    ['laser_clinic', 'laser_clinic'],
    ['customer', 'customer'],
    ['parts_supplier', 'parts_supplier'],
    ['service', 'service_company'], // legacy alias, same product
    ['vendor', 'parts_supplier'],
  ]) {
    const r = onboardingOrgUpdatePayload({ ...base, type: sent }, existing);
    assert.equal(r.ok, true, `${existing} -> ${sent}`);
    assert.ok(r.ok && !('type' in r.payload));
    assert.ok(r.ok && r.payload.name === 'Acme' && r.payload.list_in_directory === true);
  }
});

test('000919 rev 2: a real type change is refused before writing (QA H1 flip)', () => {
  for (const [existing, sent] of [
    ['customer', 'service_company'],
    ['laser_clinic', 'service_company'],
    ['service_company', 'customer'],
    ['parts_supplier', 'service_company'],
    ['customer', 'parts_supplier'],
  ]) {
    const r = onboardingOrgUpdatePayload({ ...base, type: sent }, existing);
    assert.equal(r.ok, false, `${existing} -> ${sent}`);
    assert.match(r.ok ? '' : r.error, /contact support/);
  }
});

test('unknown existing type: type is still omitted, never changed', () => {
  const r = onboardingOrgUpdatePayload({ ...base, type: 'service_company' }, null);
  assert.equal(r.ok, true);
  assert.ok(r.ok && !('type' in r.payload));
});

test('created_by / creator_shop_org_id / id are never sent on update', () => {
  const r = onboardingOrgUpdatePayload(
    { ...base, type: 'customer', created_by: 'x', creator_shop_org_id: 1, id: 9 },
    'customer'
  );
  assert.ok(r.ok);
  if (r.ok) {
    for (const k of ['created_by', 'creator_shop_org_id', 'id']) assert.ok(!(k in r.payload), k);
  }
});
