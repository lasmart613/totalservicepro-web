import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleGodOrgs, filterGodOrgs, pickAdminEmail, selectedOrgIds } from './god-orgs.ts';

const members = [
  {
    id: 'u1',
    email: 'owner@glow.test',
    firstName: 'Alex',
    lastName: 'Lee',
    role: 'admin',
    organizationId: 12,
  },
  {
    id: 'u2',
    email: 'tony@glow.test',
    firstName: 'Tony',
    lastName: 'Martin',
    role: 'fse',
    organizationId: 12,
  },
  {
    id: 'u3',
    email: 'clinic@lakeview.test',
    firstName: 'Pat',
    lastName: 'Kim',
    role: 'owner',
    organizationId: 44,
  },
];

const orgs = [
  {
    id: 12,
    name: 'Glow Repair',
    type: 'service_company',
    email: 'shop@glow.test',
    is_premium: true,
    subscription_tier: 'premium',
    created_at: '2026-01-02T00:00:00Z',
  },
  {
    id: 44,
    name: 'Lakeview Aesthetics',
    type: 'customer',
    plan: 'free',
    created_at: '2026-03-01T00:00:00Z',
  },
  {
    id: 90,
    name: 'Parts Co',
    type: 'parts_supplier',
    subscription_tier: 'unpaid',
    created_at: '2026-04-01T00:00:00Z',
  },
];

test('assemble rows include type, plan, seats, admin email, users', () => {
  const rows = assembleGodOrgs({ orgs, members });
  assert.equal(rows.length, 3);
  const shop = rows.find((r) => r.id === 12);
  assert.ok(shop);
  assert.equal(shop?.typeLabel, 'Repair company');
  assert.equal(shop?.planLabel, 'Premium');
  assert.equal(shop?.seats, 2);
  assert.equal(shop?.adminEmail, 'owner@glow.test');
  assert.equal(shop?.users.some((u) => u.email === 'tony@glow.test'), true);
  const unpaid = rows.find((r) => r.id === 90);
  assert.equal(unpaid?.planLabel, 'Unpaid');
  assert.equal(unpaid?.typeLabel, 'Parts Supplier');
});

test('filters by type, plan, and name/email search', () => {
  const rows = assembleGodOrgs({ orgs, members });
  assert.equal(filterGodOrgs(rows, { type: 'service_company' }).length, 1);
  assert.equal(filterGodOrgs(rows, { plan: 'premium' })[0]?.id, 12);
  assert.equal(filterGodOrgs(rows, { q: 'tony@glow.test' })[0]?.id, 12);
  assert.equal(filterGodOrgs(rows, { q: 'lakeview' })[0]?.id, 44);
  assert.equal(filterGodOrgs(rows, { plan: 'unpaid' })[0]?.id, 90);
});

test('admin email prefers admin role over org email', () => {
  assert.equal(
    pickAdminEmail({
      orgEmail: 'shop@glow.test',
      members: members.filter((m) => m.organizationId === 12),
    }),
    'owner@glow.test'
  );
  assert.equal(pickAdminEmail({ orgEmail: 'solo@shop.test', members: [] }), 'solo@shop.test');
});

test('selected org ids never imply all orgs', () => {
  assert.deepEqual(selectedOrgIds(undefined), []);
  assert.deepEqual(selectedOrgIds('all'), []);
  assert.deepEqual(selectedOrgIds([12, '12', 44, null, '']), [12, 44]);
});
