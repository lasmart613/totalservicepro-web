import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureEquipment } from './equipment-ensure.ts';

const here = dirname(fileURLToPath(import.meta.url));

function equipmentClient(opts?: {
  serialRows?: any[];
  modelRow?: any | null;
  insertId?: number;
  failFirstInsert?: boolean;
}) {
  const inserts: any[] = [];
  const updates: any[] = [];
  let insertAttempts = 0;

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
          if (opts?.failFirstInsert && insertAttempts === 1) {
            return Promise.resolve({
              data: null,
              error: { message: "Could not find the 'name' column of 'equipment' in the schema cache" },
            });
          }
          return Promise.resolve({ data: { id: opts?.insertId ?? 42 }, error: null });
        }
        return Promise.resolve({ data: opts?.modelRow ?? null, error: null });
      },
      insert(rows: any) {
        inserts.push(rows);
        insertAttempts += 1;
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

test('ensureEquipment inserts only when manufacturer, model, and serial are all present', async () => {
  const partials = [
    { serial: 'SN-100' },
    { manufacturer: 'Candela', model: 'GentleMax' },
    { manufacturer: 'Candela', serial: 'SN-100' },
    { model: 'GentleMax', serial: 'SN-100' },
    { name: 'Lobby laser' },
  ];
  for (const fields of partials) {
    const db = equipmentClient();
    const id = await ensureEquipment({ client: db.client, customerOrgId: 9, ...fields });
    assert.equal(id, null, JSON.stringify(fields));
    assert.equal(db.inserts.length, 0, JSON.stringify(fields));
  }

  const db = equipmentClient();
  const id = await ensureEquipment({
    client: db.client,
    customerOrgId: 9,
    manufacturer: 'Candela',
    model: 'GentleMax',
    serial: 'SN-100',
    name: 'Lobby laser',
    pulseCount: '1200',
  });
  assert.equal(id, 42);
  assert.equal(db.inserts.length, 1);
  const row = db.inserts[0][0];
  assert.equal(row.manufacturer, 'Candela');
  assert.equal(row.model, 'GentleMax');
  assert.equal(row.serial_number, 'SN-100');
  assert.equal(row.customer_organization_id, 9);
  assert.equal(row.pulse_count, '1200');
  assert.equal(Object.hasOwn(row, 'name'), false);
  assert.equal(Object.hasOwn(row, 'status'), false);
});

test('equipment insert retry never sends name or status', async () => {
  const db = equipmentClient({ failFirstInsert: true });
  const id = await ensureEquipment({
    client: db.client,
    customerOrgId: 3,
    manufacturer: 'Candela',
    model: 'GentleMax',
    serial: 'SN-9',
    name: 'Should not be a column',
  });
  assert.equal(id, 42);
  assert.equal(db.inserts.length, 2);
  for (const rows of db.inserts) {
    assert.equal(Object.hasOwn(rows[0], 'name'), false);
    assert.equal(Object.hasOwn(rows[0], 'status'), false);
    assert.equal(rows[0].manufacturer, 'Candela');
    assert.equal(rows[0].serial_number, 'SN-9');
  }
});

test('service report does not use the equipment name as the model', () => {
  const src = readFileSync(join(here, '../app/reports/new/NewServiceReportClient.tsx'), 'utf8');
  const start = src.indexOf('async function ensureLinkedEquipment');
  const end = src.indexOf('async function saveReport');
  const fn = src.slice(start, end);
  assert.match(fn, /currentModel\?\.label \|\| selectedDbModel \|\| selectedModelKey \|\| ''/);
  assert.doesNotMatch(fn, /selectedModelKey\s*\|\|\s*equipName/);
  assert.match(fn, /model:\s*modelName/);
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
