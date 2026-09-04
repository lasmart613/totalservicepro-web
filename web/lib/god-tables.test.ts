import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deleteConfirmAccepted,
  deleteConfirmHint,
  featuredGodTables,
  getGodTable,
  GOD_AUTH_PATH,
  GOD_EQUIPMENT_PATH,
  GOD_OMITTED_TABLES,
  GOD_TABLES,
  GOD_TABLES_PATH,
  GOD_USERS_PATH,
  godTableHref,
  isOmittedDiscoveredTable,
  isSecretColumn,
  parseRowId,
  redactRow,
  sanitizeWritePayload,
} from './god-tables.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('God table registry covers Equipment, Users, Auth, and business tables', () => {
  const keys = GOD_TABLES.map((t) => t.key);
  for (const key of [
    'equipment',
    'equipment_serials',
    'manufacturers',
    'laser_models',
    'test_equipment',
    'user_profiles',
    'organization_memberships',
    'auth_users',
    'organizations',
    'service_requests',
    'service_tickets',
    'service_reports',
    'manuals',
    'clinic_service_leads',
    'subscriptions',
    'engineer_invitations',
    'marketplace_upload_batches',
    'marketplace_upload_rows',
  ]) {
    assert.ok(keys.includes(key), `missing ${key}`);
  }
  assert.equal(getGodTable('auth_users')?.virtual, true);
  assert.equal(getGodTable('god_email_sends')?.canUpdate, false);
  assert.equal(getGodTable('invented_table'), null);
});

test('featured nav is Equipment, Users, and Auth / Users', () => {
  const featured = featuredGodTables();
  assert.deepEqual(
    featured.map((t) => t.key).sort(),
    ['auth_users', 'equipment', 'user_profiles']
  );
  assert.equal(godTableHref('equipment'), GOD_EQUIPMENT_PATH);
  assert.equal(godTableHref('user_profiles'), GOD_USERS_PATH);
  assert.equal(godTableHref('auth_users'), GOD_AUTH_PATH);
  assert.equal(godTableHref('service_tickets'), `${GOD_TABLES_PATH}/service_tickets`);
});

test('secret columns are redacted and not writable', () => {
  assert.equal(isSecretColumn('encrypted_password'), true);
  assert.equal(isSecretColumn('password'), true);
  assert.equal(isSecretColumn('unsubscribe_token'), true);
  assert.equal(isSecretColumn('purchase_token'), true);
  assert.equal(isSecretColumn('customer_action_token'), true);
  assert.equal(isSecretColumn('recovery_token'), true);
  assert.equal(isSecretColumn('email'), false);
  assert.equal(isSecretColumn('ticket_number'), false);
  const row = redactRow({
    id: 1,
    email: 'a@b.co',
    encrypted_password: 'HASH',
    unsubscribe_token: 'tok',
  });
  assert.deepEqual(row, { id: 1, email: 'a@b.co' });
  const write = sanitizeWritePayload(getGodTable('user_profiles')!, {
    email: 'pat@clinic.test',
    role: 'admin',
    encrypted_password: 'nope',
    id: 'should-strip-on-update',
  }, 'update');
  assert.equal(write.ok, true);
  if (write.ok) {
    assert.equal(write.payload.email, 'pat@clinic.test');
    assert.equal(write.payload.role, 'admin');
    assert.equal('encrypted_password' in write.payload, false);
    assert.equal('id' in write.payload, false);
  }
});

test('Auth create keeps write-only password and still redacts it from rows', () => {
  const auth = getGodTable('auth_users')!;
  const created = sanitizeWritePayload(
    auth,
    { email: 'new@shop.test', password: 'temp-pass-1', first_name: 'New' },
    'create'
  );
  assert.equal(created.ok, true);
  if (created.ok) {
    assert.equal(created.payload.password, 'temp-pass-1');
    assert.equal(created.payload.email, 'new@shop.test');
  }
  assert.equal(redactRow({ id: 'u1', email: 'a@b.co', password: 'HASH' })?.password, undefined);
});

test('user_profiles create requires an Auth user id', () => {
  const missing = sanitizeWritePayload(getGodTable('user_profiles')!, { email: 'x@y.z', role: 'fse' }, 'create');
  assert.equal(missing.ok, false);
  const ok = sanitizeWritePayload(
    getGodTable('user_profiles')!,
    { id: '11111111-1111-1111-1111-111111111111', email: 'x@y.z', role: 'fse' },
    'create'
  );
  assert.equal(ok.ok, true);
});

test('destructive deletes need explicit confirmation text', () => {
  const users = getGodTable('user_profiles')!;
  const auth = getGodTable('auth_users')!;
  const orgs = getGodTable('organizations')!;
  const equipment = getGodTable('equipment')!;
  const row = { id: 9, email: 'pat@clinic.test' };
  assert.equal(deleteConfirmAccepted(users, row, { confirm: true, confirmText: 'pat@clinic.test' }), true);
  assert.equal(deleteConfirmAccepted(users, row, { confirm: true, confirmText: 'DELETE' }), false);
  assert.equal(deleteConfirmAccepted(auth, row, { confirm: true, confirmText: 'PAT@CLINIC.TEST' }), true);
  assert.equal(deleteConfirmAccepted(orgs, { id: 12 }, { confirm: true, confirmText: '12' }), true);
  assert.equal(deleteConfirmAccepted(equipment, { id: 3 }, { confirm: true, confirmText: 'DELETE' }), true);
  assert.equal(deleteConfirmAccepted(equipment, { id: 3 }, { confirm: false, confirmText: 'DELETE' }), false);
  assert.match(deleteConfirmHint(auth, row), /pat@clinic.test/i);
});

test('omitted system tables stay out of the picker', () => {
  assert.equal(isOmittedDiscoveredTable('schema_migrations'), true);
  assert.equal(isOmittedDiscoveredTable('storage'), true);
  assert.equal(isOmittedDiscoveredTable('vault'), true);
  assert.equal(isOmittedDiscoveredTable('equipment'), false);
  assert.ok(GOD_OMITTED_TABLES.some((t) => /password hash/i.test(t.reason)));
});

test('parseRowId keeps UUIDs as strings', () => {
  assert.equal(parseRowId('12'), 12);
  assert.equal(parseRowId('11111111-1111-1111-1111-111111111111'), '11111111-1111-1111-1111-111111111111');
  assert.equal(parseRowId(''), null);
});

test('God table APIs and pages stay behind requireGodCaller / admin god gate', () => {
  const files = [
    '../app/api/god/tables/route.ts',
    '../app/api/god/tables/[table]/route.ts',
    '../app/api/god/tables/[table]/[id]/route.ts',
    '../app/admin/god/layout.tsx',
    '../app/admin/god/tables/page.tsx',
    '../app/admin/god/equipment/page.tsx',
    '../app/admin/god/users/page.tsx',
    '../app/admin/god/auth/page.tsx',
  ];
  for (const rel of files) {
    const src = readFileSync(join(here, rel), 'utf8');
    if (rel.includes('/api/')) {
      assert.match(src, /requireGodCaller/);
    } else {
      assert.match(src, /GodSubnav|GodTableBrowser|god-tables/);
    }
  }
  const nav = readFileSync(join(here, '../components/god/GodSubnav.tsx'), 'utf8');
  assert.match(nav, /Equipment/);
  assert.match(nav, /Users/);
  assert.match(nav, /Auth \/ Users/);
});
