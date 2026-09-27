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
  let modelLookups = 0;

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
        modelLookups += 1;
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
    get modelLookups() {
      return modelLookups;
    },
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

test('service report saves the selected manufacturer and model, not another brand', () => {
  const src = readFileSync(join(here, '../app/reports/new/NewServiceReportClient.tsx'), 'utf8');
  assert.match(src, /modelsForReportManufacturer/);
  assert.doesNotMatch(src, /modelKeys\.map/);
  const start = src.indexOf('async function ensureLinkedEquipment');
  const end = src.indexOf('async function saveReport');
  const fn = src.slice(start, end);
  assert.match(fn, /catalogManufacturerName/);
  assert.match(fn, /manufacturerValue/);
  assert.match(fn, /selectedDbModel \|\| selectedModelKey \|\| currentModel\?\.label \|\| ''/);
  assert.doesNotMatch(fn, /currentModel\?\.mfg/);
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
    name: 'Lobby laser',
    pulseCount: '1200',
  });
  assert.equal(id, 77);
  assert.equal(db.inserts.length, 0);
  assert.equal(db.updates.length, 1);
  assert.equal(Object.hasOwn(db.updates[0], 'name'), false);
  assert.equal(Object.hasOwn(db.updates[0], 'pulse_count'), false);
  assert.equal(db.updates[0].manufacturer, 'Candela');
  assert.equal(db.updates[0].model, 'GentleMax');
});

test('ensureEquipment ignores a lookup row whose serial is not the one typed', async () => {
  const db = equipmentClient({
    serialRows: [
      {
        id: 77,
        customer_organization_id: 9,
        manufacturer: 'Alma Lasers',
        model: 'Soprano Titanium',
        serial_number: 'OTHER-SN',
      },
    ],
    modelRow: { id: 88, customer_organization_id: 9 },
  });
  const id = await ensureEquipment({
    client: db.client,
    customerOrgId: 9,
    manufacturer: 'Alma Lasers',
    model: 'Soprano Titanium',
    serial: 'NEW-SN',
  });
  assert.equal(id, 42);
  assert.equal(db.inserts.length, 1);
  assert.equal(db.inserts[0][0].serial_number, 'NEW-SN');
  assert.equal(db.updates.length, 0);
});

test('ensureEquipment does not reuse make and model when the typed serial is new', async () => {
  const db = equipmentClient({
    serialRows: [],
    modelRow: { id: 88, customer_organization_id: 9 },
  });
  const id = await ensureEquipment({
    client: db.client,
    customerOrgId: 9,
    manufacturer: 'Alma Lasers',
    model: 'Soprano Titanium',
    serial: 'NEW-SN',
    name: 'Wrong laser',
    pulseCount: '50',
  });
  assert.equal(id, 42);
  assert.equal(db.modelLookups, 0);
  assert.equal(db.updates.length, 0);
  assert.equal(db.inserts.length, 1);
  const row = db.inserts[0][0];
  assert.equal(row.manufacturer, 'Alma Lasers');
  assert.equal(row.model, 'Soprano Titanium');
  assert.equal(row.serial_number, 'NEW-SN');
  assert.equal(Object.hasOwn(row, 'name'), false);
});

test('ensureEquipment reuses make and model only when no serial was typed', async () => {
  const db = equipmentClient({
    serialRows: [],
    modelRow: { id: 88, customer_organization_id: 9 },
  });
  const id = await ensureEquipment({
    client: db.client,
    customerOrgId: 9,
    manufacturer: 'Alma Lasers',
    model: 'Soprano Titanium',
    serial: '   ',
    name: 'Lobby laser',
    pulseCount: '50',
  });
  assert.equal(id, 88);
  assert.equal(db.modelLookups, 1);
  assert.equal(db.inserts.length, 0);
  assert.equal(db.updates.length, 1);
  assert.equal(Object.hasOwn(db.updates[0], 'name'), false);
  assert.equal(Object.hasOwn(db.updates[0], 'pulse_count'), false);
});
