import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assignTestEquipmentToFse,
  isMissingTableError,
  isSchemaDriftError,
  loadShopTestEquipment,
  saveShopTestEquipment,
  testEquipmentLabel,
} from './test-equipment.ts';

test('missing table and CHAR/schema drift are detected without treating them as unknown errors', () => {
  assert.equal(isMissingTableError('relation "public.test_equipment" does not exist'), true);
  assert.equal(isSchemaDriftError("Could not find the 'assigned_to_fse' column of 'test_equipment'"), true);
  assert.equal(isSchemaDriftError('value too long for type character(3)'), true);
  assert.equal(isSchemaDriftError('invalid input syntax for type uuid'), false);
});

test('equipment label prefers make/model then type', () => {
  assert.equal(testEquipmentLabel({ id: '1', make: 'Ophir', model: 'Nova II', type: 'Power Meter' }), 'Ophir Nova II');
  assert.equal(testEquipmentLabel({ id: '2', type: 'Multimeter' }), 'Multimeter');
});

test('shop load keeps only the active organization id', async () => {
  const rows = [
    { id: 'a', organization_id: 10, type: 'Meter', is_active: true },
    { id: 'b', organization_id: 99, type: 'Scope', is_active: true },
  ];
  const supabase = {
    from() {
      return {
        select() {
          return this;
        },
        or() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return Promise.resolve({ data: rows, error: null });
        },
      };
    },
  };
  const loaded = await loadShopTestEquipment(supabase, { orgId: 10, userId: 'me' });
  assert.equal(loaded.unavailable, false);
  assert.deepEqual(
    loaded.rows.map((r) => r.id),
    ['a']
  );
});

test('missing test_equipment table is unavailable, not a thrown SQL error', async () => {
  const supabase = {
    from() {
      return {
        select() {
          return this;
        },
        or() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return Promise.resolve({
            data: null,
            error: { message: 'relation "test_equipment" does not exist' },
          });
        },
      };
    },
  };
  const loaded = await loadShopTestEquipment(supabase, { orgId: 10, userId: 'me' });
  assert.equal(loaded.unavailable, true);
  assert.deepEqual(loaded.rows, []);
});

test('assign uses assigned_to_fse and reports schema lag instead of throwing', async () => {
  const supabase = {
    from() {
      return {
        update() {
          return this;
        },
        eq() {
          return Promise.resolve({
            error: { message: "Could not find the 'assigned_to_fse' column" },
          });
        },
      };
    },
  };
  const result = await assignTestEquipmentToFse(supabase, 'eq-1', 'fse-1');
  assert.equal(result.ok, false);
  assert.equal(result.schemaLag, true);
});

test('save uses writeWithColumnRetry (omit missing columns / CHAR drift)', async () => {
  let inserted: Record<string, unknown> | null = null;
  const supabase = {
    from() {
      return {
        insert(body: Record<string, unknown>) {
          inserted = body;
          return {
            select() {
              return Promise.resolve({
                data: [{ id: 'new-1' }],
                error: null,
              });
            },
          };
        },
        update() {
          return this;
        },
        eq() {
          return {
            select() {
              return Promise.resolve({ data: [{ id: 'new-1' }], error: null });
            },
          };
        },
      };
    },
  };
  const result = await saveShopTestEquipment(
    supabase,
    { type: 'Power Meter', user_id: 'me', organization_id: 10, assigned_to_fse: 'fse-1' },
    null
  );
  assert.equal(result.unavailable, false);
  assert.ok(inserted);
  assert.equal((inserted as any).assigned_to_fse, 'fse-1');
});

test('Team Management lists shop test equipment and assigns to an FSE', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../app/admin/team/page.tsx'), 'utf8');
  assert.match(src, /TestEquipmentRoster|test equipment/i);
  assert.match(src, /assigned_to_fse|assignTestEquipmentToFse|Assign/);
});
