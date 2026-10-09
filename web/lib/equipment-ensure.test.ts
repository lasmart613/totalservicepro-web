import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exactTextImatch } from './email-match.ts';
import {
  ensureEquipment,
  loadServiceHistoryForLaser,
  loadServiceRequestsForLaser,
} from './equipment-ensure.ts';

const here = dirname(fileURLToPath(import.meta.url));

function equipmentClient(opts?: {
  serialRows?: any[];
  modelRow?: any | null;
  modelRows?: any[] | null;
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
      filter() {
        return b;
      },
      eq() {
        return b;
      },
      limit(n: number) {
        if (n === 5) {
          return Promise.resolve({ data: opts?.serialRows ?? [], error: null });
        }
        if (n === 200) {
          modelLookups += 1;
          const rows =
            opts?.modelRows ??
            (opts?.modelRow ? [opts.modelRow] : []);
          return Promise.resolve({ data: rows, error: null });
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
  assert.equal(db.updates.length, 0);
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
    modelRow: {
      id: 88,
      customer_organization_id: 9,
      manufacturer: 'Alma Lasers',
      model: 'Soprano Titanium',
    },
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
  assert.equal(db.updates.length, 0);
});

test('ensureEquipment reuses make and model stored as Coherent or Coherent / Lumenis', async () => {
  for (const stored of ['Coherent', 'Coherent / Lumenis']) {
    const db = equipmentClient({
      modelRows: [
        { id: 1, customer_organization_id: 9, manufacturer: 'Candela', model: 'AcuPulse Duo' },
        { id: 44, customer_organization_id: 9, manufacturer: stored, model: 'AcuPulse Duo' },
      ],
    });
    const id = await ensureEquipment({
      client: db.client,
      customerOrgId: 9,
      manufacturer: 'Lumenis',
      model: 'AcuPulse Duo',
      serial: '',
    });
    assert.equal(id, 44, stored);
    assert.equal(db.inserts.length, 0, stored);
    assert.equal(db.updates.length, 0, stored);
  }
});

test('ensureEquipment does not overwrite a matched laser with a display manufacturer', async () => {
  const db = equipmentClient({
    serialRows: [
      {
        id: 44,
        customer_organization_id: 9,
        manufacturer: 'Coherent / Lumenis',
        model: 'AcuPulse Duo',
        serial_number: 'SN-1',
      },
    ],
  });
  const id = await ensureEquipment({
    client: db.client,
    customerOrgId: 9,
    manufacturer: 'Lumenis (Coherent)',
    model: 'AcuPulse Duo',
    serial: 'SN-1',
  });
  assert.equal(id, 44);
  assert.equal(db.inserts.length, 0);
  assert.equal(db.updates.length, 0);
});

test('serial match keeps stored model and manufacturer, including BioLitec capitalization', async () => {
  const cases = [
    {
      stored: { manufacturer: 'Candela', model: 'GENTLELASE' },
      incoming: { manufacturer: 'Candela', model: 'GentleLase' },
    },
    {
      stored: { manufacturer: 'Candela', model: 'MGLASE' },
      incoming: { manufacturer: 'Candela', model: 'MGL ASE' },
    },
    {
      stored: { manufacturer: 'Candela', model: 'GL-VPYAG' },
      incoming: { manufacturer: 'Candela', model: 'GL VPYAG' },
    },
    {
      stored: { manufacturer: 'Candela', model: 'GL-YAG' },
      incoming: { manufacturer: 'Candela', model: 'GL YAG' },
    },
    {
      stored: { manufacturer: 'biolitec', model: 'D-15' },
      incoming: { manufacturer: 'BioLitec', model: 'Diode D-15' },
    },
  ];
  for (const row of cases) {
    const db = equipmentClient({
      serialRows: [
        {
          id: 19,
          customer_organization_id: 9,
          manufacturer: row.stored.manufacturer,
          model: row.stored.model,
          serial_number: 'SN-KEEP',
        },
      ],
    });
    const id = await ensureEquipment({
      client: db.client,
      customerOrgId: 9,
      manufacturer: row.incoming.manufacturer,
      model: row.incoming.model,
      serial: 'SN-KEEP',
    });
    assert.equal(id, 19, row.stored.model);
    assert.equal(db.inserts.length, 0, row.stored.model);
    assert.equal(db.updates.length, 0, row.stored.model);
  }
});

test('serial match updates only the customer on a transfer and fills blank make or model', async () => {
  const transfer = equipmentClient({
    serialRows: [
      {
        id: 19,
        customer_organization_id: 4,
        manufacturer: 'Candela',
        model: 'GENTLELASE',
        serial_number: 'SN-KEEP',
      },
    ],
  });
  const transferred = await ensureEquipment({
    client: transfer.client,
    customerOrgId: 9,
    manufacturer: 'Candela',
    model: 'GentleLase',
    serial: 'SN-KEEP',
  });
  assert.equal(transferred, 19);
  assert.equal(transfer.updates.length, 1);
  assert.deepEqual(transfer.updates[0], { customer_organization_id: 9 });

  const blanks = equipmentClient({
    serialRows: [
      {
        id: 21,
        customer_organization_id: 9,
        manufacturer: '   ',
        model: '',
        serial_number: 'SN-BLANK',
      },
    ],
  });
  const filled = await ensureEquipment({
    client: blanks.client,
    customerOrgId: 9,
    manufacturer: 'Candela',
    model: 'GentleLase',
    serial: 'SN-BLANK',
  });
  assert.equal(filled, 21);
  assert.equal(blanks.updates.length, 1);
  assert.deepEqual(blanks.updates[0], { manufacturer: 'Candela', model: 'GentleLase' });

  const modelOnly = equipmentClient({
    serialRows: [
      {
        id: 22,
        customer_organization_id: 9,
        manufacturer: 'Candela',
        model: '',
        serial_number: 'SN-MODEL',
      },
    ],
  });
  const modeled = await ensureEquipment({
    client: modelOnly.client,
    customerOrgId: 9,
    manufacturer: 'Alma Lasers',
    model: 'GentleLase',
    serial: 'SN-MODEL',
  });
  assert.equal(modeled, 22);
  assert.deepEqual(modelOnly.updates[0], { model: 'GentleLase' });
});

test('blank serial reuses equipment whose model differs only by case or punctuation', async () => {
  const storedModels = ['GENTLELASE', 'MGLASE', 'GL-VPYAG', 'GL-YAG'];
  const picked = ['GentleLase', 'MGL ASE', 'GL VPYAG', 'GL YAG'];
  for (let i = 0; i < storedModels.length; i++) {
    const db = equipmentClient({
      modelRows: [
        { id: 1, customer_organization_id: 9, manufacturer: 'Candela', model: 'GentleMax' },
        { id: 30 + i, customer_organization_id: 9, manufacturer: 'Candela', model: storedModels[i] },
      ],
    });
    const id = await ensureEquipment({
      client: db.client,
      customerOrgId: 9,
      manufacturer: 'Candela',
      model: picked[i],
      serial: '',
    });
    assert.equal(id, 30 + i, storedModels[i]);
    assert.equal(db.inserts.length, 0, storedModels[i]);
    assert.equal(db.updates.length, 0, storedModels[i]);
  }
});

test('loose model comparison does not treat a plus model as the base model', async () => {
  const pairs = [
    ['Excel V', 'Excel V+'],
    ['Apogee', 'Apogee+'],
    ['Elite', 'Elite+'],
  ];
  for (const [plain, plus] of pairs) {
    const db = equipmentClient({
      modelRows: [
        { id: 8, customer_organization_id: 9, manufacturer: 'Cutera', model: plus },
      ],
    });
    const id = await ensureEquipment({
      client: db.client,
      customerOrgId: 9,
      manufacturer: 'Cutera',
      model: plain,
      serial: '',
    });
    assert.equal(id, null, `${plain} must not reuse ${plus}`);
    assert.equal(db.inserts.length, 0, plain);
    assert.equal(db.updates.length, 0, plain);
  }

  const plusWord = equipmentClient({
    modelRows: [
      { id: 9, customer_organization_id: 9, manufacturer: 'Cutera', model: 'Excel V Plus' },
    ],
  });
  const matched = await ensureEquipment({
    client: plusWord.client,
    customerOrgId: 9,
    manufacturer: 'Cutera',
    model: 'Excel V+',
    serial: '',
  });
  assert.equal(matched, 9);
  assert.equal(plusWord.updates.length, 0);
});

function serialLookupClient(rows: any[]) {
  const filters: Array<{ column: string; operator: string; value: unknown }> = [];
  const inserts: any[] = [];
  function builder(kind: 'query' | 'write') {
    const b: any = {
      select() {
        return b;
      },
      filter(column: string, operator: string, value: unknown) {
        filters.push({ column, operator, value });
        return b;
      },
      eq() {
        return b;
      },
      limit(n: number) {
        if (kind === 'query' && n === 5) return Promise.resolve({ data: rows, error: null });
        return b;
      },
      maybeSingle() {
        return Promise.resolve({ data: { id: 42 }, error: null });
      },
      insert(body: any) {
        inserts.push(body);
        return builder('write');
      },
      update() {
        return b;
      },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return {
    filters,
    inserts,
    client: {
      from() {
        return builder('query');
      },
    },
  };
}

test('equipment serial lookup does not treat star, percent, or underscore as wildcards', async () => {
  const cases = [
    ['SN*100', 'SNXX100'],
    ['SN%100', 'SNXX100'],
    ['SN_100', 'SNX100'],
  ];
  for (const [serial, decoy] of cases) {
    const miss = serialLookupClient([
      {
        id: 8,
        customer_organization_id: 9,
        manufacturer: 'Candela',
        model: 'GentleMax',
        serial_number: decoy,
      },
    ]);
    const missed = await ensureEquipment({
      client: miss.client,
      customerOrgId: 9,
      manufacturer: 'Candela',
      model: 'GentleMax',
      serial,
    });
    assert.equal(missed, 42, serial);
    assert.equal(miss.inserts.length, 1, serial);
    assert.equal(miss.inserts[0][0].serial_number, serial);
    assert.equal(miss.filters[0]?.operator, 'imatch', serial);
    assert.equal(miss.filters[0]?.value, exactTextImatch(serial), serial);

    const hit = serialLookupClient([
      {
        id: 8,
        customer_organization_id: 9,
        manufacturer: 'Candela',
        model: 'GentleMax',
        serial_number: decoy,
      },
      {
        id: 3,
        customer_organization_id: 4,
        manufacturer: 'Candela',
        model: 'GentleMax',
        serial_number: serial.toLowerCase(),
      },
    ]);
    const found = await ensureEquipment({
      client: hit.client,
      customerOrgId: 9,
      manufacturer: 'Candela',
      model: 'GentleMax',
      serial,
    });
    assert.equal(found, 3, serial);
    assert.equal(hit.inserts.length, 0, serial);
    assert.equal(hit.filters[0]?.value, exactTextImatch(serial), serial);
  }
});

test('duplicate serial race does not adopt a wildcard neighbor', async () => {
  const filters: Array<{ column: string; operator: string; value: unknown }> = [];
  let inserts = 0;
  const client = {
    from() {
      let filtered = false;
      const b: any = {
        select() {
          return b;
        },
        filter(column: string, operator: string, value: unknown) {
          filters.push({ column, operator, value });
          filtered = true;
          return b;
        },
        eq() {
          return b;
        },
        limit(n: number) {
          if (n === 5) return Promise.resolve({ data: [], error: null });
          return b;
        },
        insert() {
          inserts += 1;
          return b;
        },
        update() {
          return b;
        },
        maybeSingle() {
          if (inserts === 1 && !filtered) {
            return Promise.resolve({
              data: null,
              error: { message: 'duplicate key value violates unique constraint' },
            });
          }
          if (filtered && inserts === 1) {
            return Promise.resolve({ data: { id: 99, serial_number: 'SNXX100' }, error: null });
          }
          return Promise.resolve({ data: { id: 42 }, error: null });
        },
      };
      return b;
    },
  };
  const id = await ensureEquipment({
    client,
    customerOrgId: 9,
    manufacturer: 'Candela',
    model: 'GentleMax',
    serial: 'SN*100',
  });
  assert.equal(id, 42);
  assert.equal(inserts, 2);
  assert.ok(filters.every((row) => row.value === exactTextImatch('SN*100')));
});

function splitLookupClient(idRows: any[], serialRows: any[]) {
  const filters: Array<{ column: string; operator: string; value: unknown }> = [];
  return {
    filters,
    client: {
      from() {
        let filtered = false;
        const b: any = {
          select() {
            return b;
          },
          eq() {
            return b;
          },
          filter(column: string, operator: string, value: unknown) {
            filters.push({ column, operator, value });
            filtered = true;
            return b;
          },
          order() {
            return b;
          },
          limit() {
            return b;
          },
          then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
            return Promise.resolve({ data: filtered ? serialRows : idRows, error: null }).then(
              resolve,
              reject
            );
          },
        };
        return b;
      },
    },
  };
}

test('service history and requests keep an exact serial and drop wildcard neighbors', async () => {
  const cases = [
    ['SN*100', 'SNXX100'],
    ['SN%100', 'SNXX100'],
    ['SN_100', 'SNX100'],
  ];
  for (const [serial, decoy] of cases) {
    const history = splitLookupClient(
      [{ id: 'by-id', serial_number: 'OTHER', created_at: '2024-01-01' }],
      [
        { id: 'wild', serial_number: decoy, created_at: '2024-02-01' },
        { id: 'exact', serial_number: serial.toLowerCase(), created_at: '2024-03-01' },
      ]
    );
    const reports = await loadServiceHistoryForLaser({
      client: history.client,
      equipmentId: 9,
      serial,
    });
    assert.deepEqual(
      reports.map((row) => row.id).sort(),
      ['by-id', 'exact'],
      serial
    );
    assert.equal(history.filters[0]?.value, exactTextImatch(serial), serial);

    const requests = splitLookupClient(
      [{ id: 'by-id', serial_number: 'OTHER', created_at: '2024-01-01' }],
      [
        { id: 'wild', serial_number: decoy, created_at: '2024-02-01' },
        { id: 'exact', serial_number: serial.toLowerCase(), created_at: '2024-03-01' },
      ]
    );
    const reqs = await loadServiceRequestsForLaser({
      client: requests.client,
      equipmentId: 9,
      serial,
    });
    assert.deepEqual(
      reqs.map((row) => row.id).sort(),
      ['by-id', 'exact'],
      serial
    );
    assert.equal(requests.filters[0]?.value, exactTextImatch(serial), serial);
  }
});
