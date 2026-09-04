import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GOD_DEFAULT_EMAILS,
  godAllowlistEmails,
  godAllowlistUserIds,
  isGodIdentity,
  isGodPlanName,
  normalizeGodEmail,
} from './god.ts';
import { PLAN_OFFERS, PLAN_SKUS } from './billing/plan-catalog.ts';
import { PLAN_TILE_COPY } from './billing/plan-tiles.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('default God allowlist is Larry’s existing admin email', () => {
  assert.deepEqual(GOD_DEFAULT_EMAILS, ['larrysmart@gmail.com']);
  assert.deepEqual(godAllowlistEmails({}), ['larrysmart@gmail.com']);
  assert.equal(normalizeGodEmail('  LarrySmart@Gmail.com '), 'larrysmart@gmail.com');
});

test('env allowlist replaces the default and ignores junk', () => {
  assert.deepEqual(godAllowlistEmails({ GOD_ADMIN_EMAILS: 'larry@shop.test, not-an-email' }), [
    'larry@shop.test',
  ]);
  assert.deepEqual(godAllowlistUserIds({ GOD_ADMIN_USER_IDS: 'abc-1 abc-1, xyz' }), ['abc-1', 'xyz']);
});

test('only the allowlisted identity is God', () => {
  assert.equal(isGodIdentity({ email: 'larrysmart@gmail.com' }, {}), true);
  assert.equal(isGodIdentity({ profileEmail: 'LarrySmart@gmail.com' }, {}), true);
  assert.equal(isGodIdentity({ email: 'tony@shop.test' }, {}), false);
  assert.equal(isGodIdentity({ email: 'admin@example.com', id: 'u1' }, {}), false);
  assert.equal(isGodIdentity({ id: 'larry-id' }, { GOD_ADMIN_USER_IDS: 'larry-id' }), true);
  assert.equal(isGodIdentity(null, {}), false);
});

test('God is not a Stripe plan or /plans tile', () => {
  assert.equal(isGodPlanName('god'), true);
  assert.equal(isGodPlanName('premium'), false);
  assert.ok(!PLAN_SKUS.includes('god' as never));
  for (const sku of PLAN_SKUS) {
    assert.notEqual(PLAN_OFFERS[sku].plan, 'god');
  }
  assert.deepEqual(Object.keys(PLAN_TILE_COPY), ['company', 'owner', 'supplier']);
  const plans = readFileSync(join(here, '../app/plans/page.tsx'), 'utf8');
  assert.doesNotMatch(plans, /\bgod\b/i);
  const catalog = readFileSync(join(here, './billing/plan-catalog.ts'), 'utf8');
  assert.doesNotMatch(catalog, /\bgod\b/i);
});

test('God chrome is API-gated and the allowlist stays server-side', () => {
  const header = readFileSync(join(here, '../components/Header.tsx'), 'utf8');
  const layout = readFileSync(join(here, '../app/admin/layout.tsx'), 'utf8');
  const god = readFileSync(join(here, './god.ts'), 'utf8');
  assert.match(header, /fetchGodMe/);
  assert.match(header, /GOD_DASHBOARD_PATH/);
  assert.match(header, /\{isGod &&/);
  assert.doesNotMatch(header, /larrysmart@gmail\.com/);
  assert.match(layout, /fetchGodMe/);
  assert.match(layout, /deniedReason === 'god'/);
  assert.match(layout, /GOD_EQUIPMENT_PATH|God Equipment/);
  assert.match(god, /GOD_ADMIN_EMAILS/);
  assert.match(god, /larrysmart@gmail\.com/);
  assert.doesNotMatch(god, /NEXT_PUBLIC_/);
});
