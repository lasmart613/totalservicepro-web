import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureEquipment } from './equipment-ensure.ts';

function equipmentClient(opts?: { serialRows?: any[]; modelRow?: any | null; insertId?: number }) {
  const inserts: any[] = [];
  const updates: any[] = [];

  function builder(kind: 'query' | 'write') {
    const b: any = {
      select() {
        return b;
      },
      ilike() {
        return b;
      },
      eq() {
        return b;
      },
      limit(n: number) {
        if (n === 5) {
          return Promise.resolve({ data: opts?.serialRows ?? [], error: null });
        }
        return b;
      },
      maybeSingle() {
        if (kind === 'write') {
          return Promise.resolve({ data: { id: opts?.insertId ?? 42 }, error: null });
        }
        return Promise.resolve({ data: opts?.modelRow ?? null, error: null });
      },
      insert(rows: any) {
        inserts.push(rows);
        return builder('write');
      },
      update(patch: any) {
        updates.push(patch);
        return b;
      },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      },
    };
    return b;
  }

  return {
    inserts,
    updates,
    client: {
      from() {
        return builder('query');
      },
    },
  };
}

test('ensureEquipment skips insert when make, model, and serial are all blank', async () => {
  const blank = equipmentClient();
  const id = await ensureEquipment({
    client: blank.client,
    customerOrgId: 9,
    manufacturer: '   ',
    model: '',
    serial: '  ',
    name: 'Lobby laser',
    pulseCount: '1000',
  });
  assert.equal(id, null);
  assert.equal(blank.inserts.length, 0);

  const nameOnly = equipmentClient();
  const named = await ensureEquipment({
    client: nameOnly.client,
    customerOrgId: '12',
    name: 'Unnamed handpiece',
  });
  assert.equal(named, null);
  assert.equal(nameOnly.inserts.length, 0);
});

test('ensureEquipment still inserts when any of make, model, or serial is present', async () => {
  const serialOnly = equipmentClient();
  const serialId = await ensureEquipment({
    client: serialOnly.client,
    customerOrgId: 9,
    serial: 'SN-100',
  });
  assert.equal(serialId, 42);
  assert.equal(serialOnly.inserts.length, 1);
  assert.equal(serialOnly.inserts[0][0].serial_number, 'SN-100');
  assert.equal(serialOnly.inserts[0][0].customer_organization_id, 9);

  const modelOnly = equipmentClient();
  const modelId = await ensureEquipment({
    client: modelOnly.client,
    customerOrgId: 4,
    manufacturer: 'Candela',
    model: 'GentleMax',
  });
  assert.equal(modelId, 42);
  assert.equal(modelOnly.inserts[0][0].manufacturer, 'Candela');
  assert.equal(modelOnly.inserts[0][0].model, 'GentleMax');
  assert.equal(modelOnly.inserts[0][0].serial_number, null);
});

test('ensureEquipment reuses a serial match instead of inserting a blank duplicate', async () => {
  const db = equipmentClient({
    serialRows: [
      {
        id: 77,
        customer_organization_id: 9,
        manufacturer: 'Candela',
        model: 'GentleMax',
        serial_number: 'SN-100',
      },
    ],
  });
  const id = await ensureEquipment({
    client: db.client,
    customerOrgId: 9,
    manufacturer: 'Candela',
    model: 'GentleMax',
    serial: 'SN-100',
  });
  assert.equal(id, 77);
  assert.equal(db.inserts.length, 0);
});
